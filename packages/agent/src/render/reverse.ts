// The Renderer's reverse direction (M24.3, spec P3): a document in, Markdown out, on the same pandoc
// container (`pandoc/minimal:3.11.0` has the readers; no image change). Only pandoc's readers named
// here are asked: docx, odt, epub and rtf. PDF, xlsx, pptx, ods and odp are parsed in the Worker
// (`files/convert/`). The pure half, as `render.ts` is for the forward direction: what may be asked,
// the request pandoc's server takes, and what its answer must be before it is called Markdown.
import { RENDER_PORT, type RenderCode, untilReady } from "./render.ts";

export const REVERSE_FORMATS = ["docx", "odt", "epub", "rtf"] as const;
export type ReverseFormat = (typeof REVERSE_FORMATS)[number];
/** The largest document sent: its base64 stays under the 32 MiB a Durable Object RPC message carries. */
export const REVERSE_MAX_BYTES = 16 * 1024 * 1024;
/** The most Markdown accepted back; more is refused, never cut and passed on. */
export const REVERSE_MAX_CHARS = 4 * 1024 * 1024;

export interface ReverseInput {
  from: ReverseFormat;
  to: "markdown";
  /** The document's bytes, base64. */
  base64: string;
}

export type MarkdownResult = { ok: true; to: "markdown"; from: ReverseFormat; markdown: string; chars: number } | { ok: false; code: RenderCode; reason: string };
type Refusal = Extract<MarkdownResult, { ok: false }>;

const refuse = (code: RenderCode, reason: string): Refusal => ({ ok: false, code, reason });
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

/** Checks an untrusted reverse request: the document is data, and only its format and size matter. */
export function parseReverseInput(raw: unknown): { ok: true; input: ReverseInput } | Refusal {
  const r = raw as { from?: unknown; to?: unknown; base64?: unknown } | null;
  if (r?.to !== "markdown") return refuse("RENDER_FORMAT_REFUSED", "the reverse direction renders to markdown only");
  if (!(REVERSE_FORMATS as readonly unknown[]).includes(r.from)) return refuse("RENDER_FORMAT_REFUSED", `from must be one of ${REVERSE_FORMATS.join(", ")}`);
  if (typeof r.base64 !== "string" || !r.base64 || r.base64.length % 4 !== 0 || !BASE64.test(r.base64)) return refuse("RENDER_INPUT_INVALID", "base64 must be the document's bytes in base64");
  if ((r.base64.length / 4) * 3 > REVERSE_MAX_BYTES + 2) return refuse("RENDER_TOO_LARGE", `the document is over ${REVERSE_MAX_BYTES} bytes`);
  return { ok: true, input: { from: r.from as ReverseFormat, to: "markdown", base64: r.base64 } };
}

/**
 * The body pandoc's server takes: a binary reader gets the base64 itself (pandoc-server.md, "text"),
 * RTF its text. A fragment, sandboxed, tracked changes accepted, wrapped at pandoc's default so the
 * Markdown pages by line.
 */
export function reverseRequest(input: ReverseInput): Request {
  // RTF is 7-bit text with escapes; `atob` gives its bytes one character each, as Latin-1 reads them.
  const text = input.from === "rtf" ? atob(input.base64) : input.base64;
  const body = { text, from: input.from, to: "markdown", standalone: false, sandbox: true, ...(input.from === "docx" ? { "track-changes": "accept" } : {}) };
  return new Request(`http://render.internal:${RENDER_PORT}/`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify(body) });
}

/** pandoc's answer as Markdown, or a code: an error, a binary answer or an empty or oversized output is never Markdown. */
export async function readMarkdownResponse(res: Response, from: ReverseFormat): Promise<MarkdownResult> {
  const text = await res.text();
  if (!res.ok) return refuse("RENDER_FAILED", `pandoc answered ${res.status}: ${text.slice(0, 200)}`);
  let parsed: { output?: unknown; error?: unknown; base64?: unknown };
  try {
    parsed = JSON.parse(text) as typeof parsed;
  } catch {
    return refuse("RENDER_OUTPUT_INVALID", "pandoc's answer is not JSON");
  }
  if (typeof parsed.error === "string") return refuse("RENDER_FAILED", parsed.error.slice(0, 200));
  if (typeof parsed.output !== "string" || !parsed.output.trim()) return refuse("RENDER_OUTPUT_INVALID", "pandoc's answer has no markdown");
  if (parsed.base64 === true) return refuse("RENDER_OUTPUT_INVALID", "pandoc answered binary output for markdown");
  if (parsed.output.length > REVERSE_MAX_CHARS) return refuse("RENDER_OUTPUT_INVALID", `the markdown is over ${REVERSE_MAX_CHARS} characters`);
  return { ok: true, to: "markdown", from, markdown: parsed.output, chars: parsed.output.length };
}

/** One document to Markdown on the container's port, waiting for pandoc as the forward direction does. */
export async function renderToMarkdown(raw: unknown, port: { fetch(req: Request): Promise<Response> }, pause: (ms: number) => Promise<void>): Promise<MarkdownResult> {
  const parsed = parseReverseInput(raw);
  if (!parsed.ok) return parsed;
  const res = await untilReady(() => port.fetch(reverseRequest(parsed.input)), { attempts: 40, pause, pauseMs: 500 });
  if (!res) return refuse("RENDER_UNAVAILABLE", "the render container did not answer within 20 s");
  return readMarkdownResponse(res, parsed.input.from);
}
