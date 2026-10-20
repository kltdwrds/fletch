// OpenDocument spreadsheets and presentations to Markdown in the Worker (M24.3): pandoc reads odt
// but has no ods or odp reader, so these two are parsed from `content.xml` as xlsx and pptx are.
// Repeated rows and columns are expanded only where they hold text, so a sheet whose trailing
// cells repeat sixteen thousand times stays small.
import type { Converted } from "./types.ts";
import { attr, elements, table, textOf } from "./xml.ts";
import { partText, readZip } from "./zip.ts";

const MAX_REPEAT = 100;

const paragraphs = (body: string): string[] => elements(body, "text:p").map((p) => textOf(p.body).trim());
const repeat = (attrs: string, name: string): number => Math.max(1, Math.min(MAX_REPEAT, Number(attr(attrs, name) ?? "1") || 1));

export function odsToMarkdown(name: string, bytes: Uint8Array): Converted {
  const zip = readZip(bytes);
  if (!zip.ok) return zip;
  const content = partText(zip.entries, "content.xml");
  if (!content) return { ok: false, code: "INGEST_ODS_INVALID", reason: "the spreadsheet has no content.xml" };
  const sheets = elements(content, "table:table");
  const parts = [`# ${name}`];
  for (const s of sheets) {
    const rows: string[][] = [];
    for (const row of elements(s.body, "table:table-row")) {
      const cells: string[] = [];
      for (const c of elements(row.body, "table:table-cell")) {
        const text = paragraphs(c.body).join(" ");
        // An empty run of repeated cells is padding, not columns.
        const n = text ? repeat(c.attrs, "table:number-columns-repeated") : Number(attr(c.attrs, "table:number-columns-repeated") ?? "1") || 1;
        for (let i = 0; i < n && cells.length < 1000; i++) cells.push(text);
      }
      while (cells.length && !cells.at(-1)) cells.pop();
      const times = cells.length ? repeat(row.attrs, "table:number-rows-repeated") : 1;
      for (let i = 0; i < times; i++) rows.push(cells);
    }
    while (rows.length && !rows.at(-1)?.length) rows.pop();
    parts.push(`## Sheet: ${attr(s.attrs, "table:name") ?? "Sheet"}`, rows.length ? table(rows) : "(an empty sheet)");
  }
  return { ok: true, markdown: `${parts.join("\n\n")}\n`, units: sheets.length };
}

export function odpToMarkdown(name: string, bytes: Uint8Array): Converted {
  const zip = readZip(bytes);
  if (!zip.ok) return zip;
  const content = partText(zip.entries, "content.xml");
  if (!content) return { ok: false, code: "INGEST_ODP_INVALID", reason: "the presentation has no content.xml" };
  const pages = elements(content, "draw:page");
  const parts = [`# ${name}`];
  for (const [i, p] of pages.entries()) {
    const title = attr(p.attrs, "draw:name");
    const paras = paragraphs(p.body).filter(Boolean);
    parts.push(`## Slide ${i + 1}${title ? `: ${title}` : ""}`, paras.length ? paras.join("\n\n") : "(no text on this slide)");
  }
  return { ok: true, markdown: `${parts.join("\n\n")}\n`, units: pages.length };
}
