// What the model reads of an attachment (M24.3, spec P3 "What the model reads"). Called once per
// upload or mail attachment after its bytes are stored in R2: the attachment becomes something in the
// owner's working tree under `work/uploads/<attachmentId>/` that the model reaches with `file_read`.
// - An image is stored as itself. Where the chat route's model takes image input (model/routes.ts)
//   and the image fits a turn, `file_read` shows it; otherwise the caption step (model/caption.ts)
//   writes `caption_text`, kept beside it as `<name>.caption.md`.
// - docx, odt, epub and rtf become Markdown on the Renderer's reverse direction (render/reverse.ts);
//   PDF, xlsx, pptx, ods and odp in the Worker (convert/); the Markdown sits at `<name>.md`.
// - A zip is unpacked under `<name>/` with caps on entries, bytes and paths (convert/zip.ts).
// - Text is stored as itself.
// Every page of what is written is a `file_read` page, so nothing over the spill threshold reaches
// the model whole; the model is given one line per attachment (`describeForModel`) with the pointer.
// The tree decides the owner on every write: an `owner` that is not the tree's is refused.
import type { HostFailure } from "@qyvr/host";
import type { MarkdownResult, ReverseFormat } from "../render/reverse.ts";
import { IMAGE_INPUT_MAX, IMAGE_TYPES, pageCount, safeSegment, TREE_BYTES_MAX, type TreeWriteResult } from "../tree/tree.ts";
import { odpToMarkdown, odsToMarkdown } from "./convert/odf.ts";
import { pptxToMarkdown, xlsxToMarkdown } from "./convert/ooxml.ts";
import { pdfToMarkdown } from "./convert/pdf.ts";
import type { Converted } from "./convert/types.ts";
import { readZip } from "./convert/zip.ts";

export type IngestInput = { owner: string; attachmentId: string; name: string; mime: string; bytes: Uint8Array };
export type IngestResult =
  | { ok: true; kind: "image" | "document" | "archive" | "text"; treePath: string; pages: number; captionText?: string; entries?: number }
  | { ok: false; code: string; reason: string };

export interface IngestDeps {
  /** The owner's working tree (`PersonTree`, or `directTreeApi`'s write over RPC); it decides the owner. */
  tree: { write(input: { path: string; text?: string; bytes?: Uint8Array }, requester: string): Promise<TreeWriteResult> };
  /** The renderer's reverse direction: the host's (`hostOf(env).render.toMarkdown`), or its refusal where it has none. */
  renderer: { toMarkdown(input: unknown): Promise<MarkdownResult | HostFailure> };
  /** The caption step through the model adapter (`captionImage`); absent, an image the model cannot be shown is refused. */
  caption?: (image: { bytes: Uint8Array; mimeType: string; attachmentId: string; owner: string }) => Promise<{ ok: true; text: string } | { ok: false; code: string; reason: string }>;
  /** `acceptsImages("chat")`: the chat route's model takes image input. */
  imageInput: boolean;
}

type Kind = "image" | "pdf" | "xlsx" | "pptx" | "ods" | "odp" | "zip" | "text" | ReverseFormat;

const MIME: Record<string, Kind> = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "application/vnd.oasis.opendocument.text": "odt",
  "application/vnd.oasis.opendocument.spreadsheet": "ods",
  "application/vnd.oasis.opendocument.presentation": "odp",
  "application/epub+zip": "epub",
  "application/rtf": "rtf",
  "text/rtf": "rtf",
  "application/zip": "zip",
  "application/x-zip-compressed": "zip",
  "application/json": "text",
  "application/xml": "text",
};
const EXT: Record<string, Kind> = { pdf: "pdf", docx: "docx", xlsx: "xlsx", pptx: "pptx", odt: "odt", ods: "ods", odp: "odp", epub: "epub", rtf: "rtf", zip: "zip" };
const TEXT_EXT = new Set(["txt", "md", "markdown", "csv", "tsv", "json", "xml", "yaml", "yml", "html", "htm", "log", "ics", "vcf", "toml", "ini", "ts", "js", "py", "sql", "sh"]);
const PANDOC: ReadonlySet<Kind> = new Set<Kind>(["docx", "odt", "epub", "rtf"]);

const extOf = (name: string) => (name.includes(".") ? (name.split(".").pop() ?? "").toLowerCase() : "");

function kindOf(name: string, mime: string): Kind | null {
  const ext = extOf(name);
  const m = mime.toLowerCase().split(";")[0]?.trim() ?? "";
  if (IMAGE_TYPES[ext] || Object.values(IMAGE_TYPES).includes(m)) return "image";
  return EXT[ext] ?? MIME[m] ?? (TEXT_EXT.has(ext) || m.startsWith("text/") ? "text" : null);
}

const fail = (code: string, reason: string): IngestResult => ({ ok: false, code, reason });

function base64Of(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

async function toMarkdown(deps: IngestDeps, kind: Kind, name: string, bytes: Uint8Array): Promise<Converted> {
  if (PANDOC.has(kind)) {
    const r = await deps.renderer.toMarkdown({ from: kind, to: "markdown", base64: base64Of(bytes) });
    return r.ok ? { ok: true, markdown: `# ${name}\n\n${r.markdown.trimEnd()}\n`, units: 1 } : r;
  }
  if (kind === "pdf") return pdfToMarkdown(name, bytes);
  if (kind === "xlsx") return xlsxToMarkdown(name, bytes);
  if (kind === "pptx") return pptxToMarkdown(name, bytes);
  if (kind === "ods") return odsToMarkdown(name, bytes);
  if (kind === "odp") return odpToMarkdown(name, bytes);
  return { ok: false, code: "INGEST_TYPE_UNSUPPORTED", reason: `no conversion for ${kind}` };
}

async function write(deps: IngestDeps, owner: string, path: string, content: { text: string } | { bytes: Uint8Array }): Promise<IngestResult | null> {
  const w = await deps.tree.write({ path, ...content }, owner);
  return w.ok ? null : fail(w.code, `${path} was not written: ${w.reason}`);
}

export async function ingestAttachment(deps: IngestDeps, input: IngestInput): Promise<IngestResult> {
  const { owner, bytes } = input;
  if (!(bytes instanceof Uint8Array)) return fail("INGEST_INPUT_INVALID", "the attachment has no bytes");
  if (bytes.byteLength > TREE_BYTES_MAX) return fail("INGEST_TOO_LARGE", `${bytes.byteLength} bytes; the tree takes ${TREE_BYTES_MAX}`);
  const kind = kindOf(input.name, input.mime);
  if (!kind) return fail("INGEST_TYPE_UNSUPPORTED", `${input.mime || "an unknown type"} is not a type the model reads (images, PDF, Word, Excel, PowerPoint, OpenDocument, EPUB, RTF, zip, text)`);
  const dir = `work/uploads/${safeSegment(input.attachmentId)}`;
  const base = safeSegment(input.name);

  if (kind === "image") {
    const ext = extOf(base);
    const mimeType = IMAGE_TYPES[ext] ?? input.mime.toLowerCase();
    const path = IMAGE_TYPES[ext] ? `${dir}/${base}` : `${dir}/${base}.${Object.entries(IMAGE_TYPES).find(([, m]) => m === mimeType)?.[0] ?? "img"}`;
    const failed = await write(deps, owner, path, { bytes });
    if (failed) return failed;
    if (deps.imageInput && bytes.byteLength <= IMAGE_INPUT_MAX) return { ok: true, kind: "image", treePath: path, pages: 1 };
    if (!deps.caption) return fail("INGEST_CAPTION_UNAVAILABLE", `the image is stored at ${path}, but the model cannot be shown it and no caption step is available`);
    const c = await deps.caption({ bytes, mimeType, attachmentId: input.attachmentId, owner });
    if (!c.ok) return fail(c.code, `the image is stored at ${path}, but it could not be described: ${c.reason}`);
    const sidecar = await write(deps, owner, `${path}.caption.md`, { text: c.text });
    if (sidecar) return sidecar;
    return { ok: true, kind: "image", treePath: path, pages: 1, captionText: c.text };
  }

  if (kind === "text") {
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes);
    } catch {
      return fail("INGEST_NOT_TEXT", `${input.name} is not UTF-8 text`);
    }
    const path = `${dir}/${base}`;
    return (await write(deps, owner, path, { text })) ?? { ok: true, kind: "text", treePath: path, pages: pageCount(text) };
  }

  if (kind === "zip") {
    const zip = readZip(bytes);
    if (!zip.ok) return zip;
    const root = `${dir}/${base.replace(/\.zip$/i, "") || "archive"}`;
    const seen = new Set<string>();
    let written = 0;
    for (const e of zip.entries) {
      let path = `${root}/${e.path.split("/").map(safeSegment).join("/")}`;
      for (let n = 2; seen.has(path); n++) path = `${root}/${e.path.split("/").map(safeSegment).join("/")}-${n}`;
      seen.add(path);
      const w = await deps.tree.write({ path, bytes: e.bytes }, owner);
      if (!w.ok) return fail(w.code, `the archive was unpacked only in part (${written} of ${zip.entries.length} files under ${root}): ${w.reason}`);
      written++;
    }
    return { ok: true, kind: "archive", treePath: root, pages: 0, entries: written };
  }

  const converted = await toMarkdown(deps, kind, input.name, bytes);
  if (!converted.ok) return converted;
  const path = `${dir}/${base}.md`;
  return (await write(deps, owner, path, { text: converted.markdown })) ?? { ok: true, kind: "document", treePath: path, pages: pageCount(converted.markdown) };
}

/** An attachment's name as the model is shown it: one line, quoted, bounded; it is data, never an instruction. */
// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what this strips from a name.
const shown = (name: string) => JSON.stringify(name.replace(/[\u0000-\u001f\u007f]+/g, " ").slice(0, 120));
const pagesOf = (n: number) => `${n} page${n === 1 ? "" : "s"}`;

/** The one line the model sees for one attachment: what it is, where it sits in the tree and how to read it, or the failure in words. */
export function describeForModel(name: string, result: IngestResult): string {
  const n = shown(name);
  if (!result.ok) return `Attachment ${n} could not be read: ${result.reason} (${result.code}).`;
  const read = (p: string) => `file_read {"path":"${p}","from":1}`;
  switch (result.kind) {
    case "image":
      return result.captionText !== undefined
        ? `Attachment ${n}: an image stored at ${result.treePath}; you cannot be shown it, so it was described: ${JSON.stringify(result.captionText)}.`
        : `Attachment ${n}: an image stored at ${result.treePath}; ${read(result.treePath)} shows it to you.`;
    case "document":
      return `Attachment ${n}: a document converted to Markdown at ${result.treePath}, ${pagesOf(result.pages)} of file_read; read it with ${read(result.treePath)}.`;
    case "text":
      return `Attachment ${n}: text stored at ${result.treePath}, ${pagesOf(result.pages)} of file_read; read it with ${read(result.treePath)}.`;
    case "archive":
      return `Attachment ${n}: an archive unpacked into ${result.treePath}/ (${result.entries ?? 0} files); file_find {"path":"${result.treePath}","pattern":"**/*"} lists them.`;
  }
}
