// xlsx and pptx to Markdown in the Worker (M24.3, spec open question 7): the package is a zip
// (`zip.ts`) of XML parts (`xml.ts`); a workbook becomes one Markdown table per sheet, a deck one
// section per slide in the presentation's order. No container and no native code.
import type { Converted } from "./types.ts";
import { attr, decodeXml, elements, table } from "./xml.ts";
import { partText, readZip } from "./zip.ts";

const MAX_COLUMNS = 200;

/** A package part's relationships: id to the part path it targets, resolved from `base`. */
function relationships(xml: string | null, base: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const r of elements(xml ?? "", "Relationship")) {
    const id = attr(r.attrs, "Id");
    const target = attr(r.attrs, "Target");
    if (id && target) out.set(id, target.startsWith("/") ? target.slice(1) : `${base}${target}`);
  }
  return out;
}

/** A cell reference's zero-based column: A is 0, AA is 26. */
export function columnOf(ref: string): number {
  let n = 0;
  for (const ch of ref.replace(/\d+$/, "").toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

export function xlsxToMarkdown(name: string, bytes: Uint8Array): Converted {
  const zip = readZip(bytes);
  if (!zip.ok) return zip;
  const workbook = partText(zip.entries, "xl/workbook.xml");
  if (!workbook) return { ok: false, code: "INGEST_XLSX_INVALID", reason: "the workbook has no xl/workbook.xml" };
  const rels = relationships(partText(zip.entries, "xl/_rels/workbook.xml.rels"), "xl/");
  const shared = elements(partText(zip.entries, "xl/sharedStrings.xml") ?? "", "si").map((si) => elements(si.body, "t").map((t) => decodeXml(t.body)).join(""));
  const sheets = elements(workbook, "sheet");
  const parts = [`# ${name}`];
  for (const s of sheets) {
    const title = attr(s.attrs, "name") ?? "Sheet";
    const target = rels.get(attr(s.attrs, "r:id") ?? "");
    const xml = target ? partText(zip.entries, target) : null;
    if (xml === null) return { ok: false, code: "INGEST_XLSX_INVALID", reason: `sheet ${JSON.stringify(title)} has no part in the package` };
    const rows: string[][] = [];
    let wide = false;
    for (const row of elements(xml, "row")) {
      const cells: string[] = [];
      for (const c of elements(row.body, "c")) {
        const col = columnOf(attr(c.attrs, "r") ?? "A1");
        if (col >= MAX_COLUMNS) {
          wide = true;
          continue;
        }
        const type = attr(c.attrs, "t");
        const v = elements(c.body, "v")[0]?.body;
        cells[col] =
          type === "s" ? (shared[Number(v)] ?? "") : type === "inlineStr" ? elements(c.body, "t").map((t) => decodeXml(t.body)).join("") : type === "b" ? (v === "1" ? "TRUE" : "FALSE") : decodeXml(v ?? "");
      }
      rows.push(Array.from(cells, (x) => x ?? ""));
    }
    parts.push(`## Sheet: ${title}`, rows.length ? table(rows) : "(an empty sheet)");
    if (wide) parts.push(`(columns past ${MAX_COLUMNS} are not shown)`);
  }
  return { ok: true, markdown: `${parts.join("\n\n")}\n`, units: sheets.length };
}

export function pptxToMarkdown(name: string, bytes: Uint8Array): Converted {
  const zip = readZip(bytes);
  if (!zip.ok) return zip;
  const presentation = partText(zip.entries, "ppt/presentation.xml");
  if (!presentation) return { ok: false, code: "INGEST_PPTX_INVALID", reason: "the deck has no ppt/presentation.xml" };
  const rels = relationships(partText(zip.entries, "ppt/_rels/presentation.xml.rels"), "ppt/");
  const ids = elements(presentation, "p:sldId");
  const parts = [`# ${name}`];
  for (const [i, id] of ids.entries()) {
    const target = rels.get(attr(id.attrs, "r:id") ?? "");
    const xml = target ? partText(zip.entries, target) : null;
    if (xml === null) return { ok: false, code: "INGEST_PPTX_INVALID", reason: `slide ${i + 1} has no part in the package` };
    const paras = elements(xml, "a:p").map((p) => elements(p.body, "a:t").map((t) => decodeXml(t.body)).join("").trim()).filter(Boolean);
    parts.push(`## Slide ${i + 1}`, paras.length ? paras.join("\n\n") : "(no text on this slide)");
  }
  return { ok: true, markdown: `${parts.join("\n\n")}\n`, units: ids.length };
}
