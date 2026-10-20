// Native document rendering (D2, AD-8): pandoc in a disposable container beside the tenant's agent
// script (M15.6's verify item chose the sidecar). This module is the pure half: what may be asked,
// the request pandoc's server takes, and what its answer must be before it is called a render.
// `renderer.ts` is the Durable Object that holds the container and only delegates here.

/** The public image the container runs, by exact tag; `generate.ts` holds the deployed config to it. */
export const RENDER_IMAGE = "docker.io/pandoc/minimal:3.11.0";
/** pandoc's own HTTP server inside the container; no internet, no other process. */
export const RENDER_ENTRYPOINT = ["pandoc", "server", "--port", "8080"];
export const RENDER_PORT = 8080;
/** Markdown in; office and web formats out. A format outside this list is refused, never guessed. */
export const RENDER_FORMATS = ["docx", "odt", "html"] as const;
export type RenderFormat = (typeof RENDER_FORMATS)[number];
export const RENDER_MAX_CHARS = 200_000;

export interface RenderInput {
  markdown: string;
  to: RenderFormat;
}

export type RenderResult =
  | { ok: true; to: RenderFormat; bytes: number; base64: string; mediaType: string }
  | { ok: false; code: RenderCode; reason: string };

export type RenderCode = "RENDER_INPUT_INVALID" | "RENDER_FORMAT_REFUSED" | "RENDER_TOO_LARGE" | "RENDER_UNAVAILABLE" | "RENDER_FAILED" | "RENDER_OUTPUT_INVALID";

const MEDIA: Record<RenderFormat, string> = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  odt: "application/vnd.oasis.opendocument.text",
  html: "text/html",
};

const refuse = (code: RenderCode, reason: string): RenderResult => ({ ok: false, code, reason });

/** Checks an untrusted render request; the caller's text is data and only its size and format matter. */
export function parseRenderInput(raw: unknown): { ok: true; input: RenderInput } | Extract<RenderResult, { ok: false }> {
  const r = raw as { markdown?: unknown; to?: unknown } | null;
  if (!r || typeof r.markdown !== "string") return refuse("RENDER_INPUT_INVALID", "markdown must be a string") as Extract<RenderResult, { ok: false }>;
  if (!(RENDER_FORMATS as readonly unknown[]).includes(r.to)) return refuse("RENDER_FORMAT_REFUSED", `to must be one of ${RENDER_FORMATS.join(", ")}`) as Extract<RenderResult, { ok: false }>;
  if (r.markdown.length > RENDER_MAX_CHARS) return refuse("RENDER_TOO_LARGE", `markdown is over ${RENDER_MAX_CHARS} characters`) as Extract<RenderResult, { ok: false }>;
  return { ok: true, input: { markdown: r.markdown, to: r.to as RenderFormat } };
}

/** The body pandoc's server takes: standalone output, no raw passthrough, no file or URL reads. */
export function renderRequest(input: RenderInput): Request {
  const body = { text: input.markdown, from: "markdown-raw_html-raw_attribute", to: input.to, standalone: true, sandbox: true };
  return new Request(`http://render.internal:${RENDER_PORT}/`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify(body) });
}

const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04];

function decode(base64: string): Uint8Array | null {
  try {
    return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

/**
 * pandoc's answer as a render, or a code with the reason. A binary format comes back base64 and must
 * be a zip (docx and odt are); html comes back as text. An error, an empty output or a wrong shape is
 * never passed on as a document.
 */
export async function readRenderResponse(res: Response, to: RenderFormat): Promise<RenderResult> {
  const text = await res.text();
  if (!res.ok) return refuse("RENDER_FAILED", `pandoc answered ${res.status}: ${text.slice(0, 200)}`);
  let parsed: { output?: unknown; error?: unknown };
  try {
    parsed = JSON.parse(text) as typeof parsed;
  } catch {
    return refuse("RENDER_OUTPUT_INVALID", "pandoc's answer is not JSON");
  }
  if (typeof parsed.error === "string") return refuse("RENDER_FAILED", parsed.error.slice(0, 200));
  if (typeof parsed.output !== "string" || !parsed.output) return refuse("RENDER_OUTPUT_INVALID", "pandoc's answer has no output");
  if (to === "html") {
    const bytes = new TextEncoder().encode(parsed.output);
    return { ok: true, to, bytes: bytes.length, base64: btoa(String.fromCharCode(...bytes)), mediaType: MEDIA.html };
  }
  const bytes = decode(parsed.output);
  if (!bytes || !ZIP_MAGIC.every((b, i) => bytes[i] === b)) return refuse("RENDER_OUTPUT_INVALID", `the ${to} output is not a zip package`);
  return { ok: true, to, bytes: bytes.length, base64: parsed.output, mediaType: MEDIA[to] };
}

/** Waits for the container's port: a fetch that fails while pandoc starts is retried until the deadline. */
export async function untilReady(fetchOnce: () => Promise<Response>, opts: { attempts: number; pause: (ms: number) => Promise<void>; pauseMs: number }): Promise<Response | null> {
  for (let i = 0; i < opts.attempts; i++) {
    try {
      return await fetchOnce();
    } catch {
      if (i < opts.attempts - 1) await opts.pause(opts.pauseMs);
    }
  }
  return null;
}

export async function render(raw: unknown, port: { fetch(req: Request): Promise<Response> }, pause: (ms: number) => Promise<void>): Promise<RenderResult> {
  const parsed = parseRenderInput(raw);
  if (!parsed.ok) return parsed;
  const res = await untilReady(() => port.fetch(renderRequest(parsed.input)), { attempts: 40, pause, pauseMs: 500 });
  if (!res) return refuse("RENDER_UNAVAILABLE", "the render container did not answer within 20 s");
  return readRenderResponse(res, parsed.input.to);
}
