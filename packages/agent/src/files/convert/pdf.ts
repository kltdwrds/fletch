// PDF to Markdown in the Worker (M24.3, spec open question 7): unpdf, pdf.js's serverless build, pure
// JavaScript that runs in workerd; one section per page. A PDF with pages but no text layer (a scan)
// is refused with its code rather than passed on as an empty document.
import { extractText, getDocumentProxy } from "unpdf";
import type { Converted } from "./types.ts";

export const PDF_MAX_PAGES = 500;

export async function pdfToMarkdown(name: string, bytes: Uint8Array): Promise<Converted> {
  let pages: string[];
  let total: number;
  try {
    // pdf.js may detach the buffer it is given, so it reads a copy.
    const doc = await getDocumentProxy(new Uint8Array(bytes));
    if (doc.numPages > PDF_MAX_PAGES) return { ok: false, code: "INGEST_PDF_TOO_LARGE", reason: `the PDF has ${doc.numPages} pages; at most ${PDF_MAX_PAGES} are read` };
    const r = await extractText(doc, { mergePages: false });
    pages = r.text;
    total = r.totalPages;
  } catch (err) {
    return { ok: false, code: "INGEST_PDF_INVALID", reason: `not a readable PDF: ${String(err instanceof Error ? err.message : err).slice(0, 120)}` };
  }
  if (pages.length !== total) return { ok: false, code: "INGEST_PDF_INVALID", reason: `read ${pages.length} of ${total} pages` };
  if (!pages.some((p) => p.trim())) return { ok: false, code: "INGEST_PDF_NO_TEXT", reason: `the PDF has ${total} page${total === 1 ? "" : "s"} and no text layer (a scan?)` };
  const parts = [`# ${name}`, ...pages.flatMap((p, i) => [`## Page ${i + 1}`, p.trim() || "(no text on this page)"])];
  return { ok: true, markdown: `${parts.join("\n\n")}\n`, units: total };
}
