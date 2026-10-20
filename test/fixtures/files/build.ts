// Builds the M24.3 conversion fixtures deterministically: one small file of each type the model reads
// (PDF, docx, xlsx, pptx, odt, ods, odp, epub, rtf, zip, png), fictional content only (Ada and Bo Wren
// of Solo Sam, from test/fixtures/people.json). `node test/fixtures/files/build.ts` writes them beside
// this file; the hermetic tests read those files and hold them equal to what this module builds.
import { writeFileSync } from "node:fs";
import { zipSync } from "fflate";

const MTIME = new Date("2026-10-16T00:00:00Z");
const enc = new TextEncoder();
const zip = (files: Record<string, string | Uint8Array>, stored: string[] = []): Uint8Array =>
  zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, [typeof v === "string" ? enc.encode(v) : v, { mtime: MTIME, level: stored.includes(k) ? 0 : 6 }]])));

/** A two-page PDF with a text layer, its xref offsets computed. */
export function pdf(): Uint8Array {
  const page = (text: string) => `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
  const streams = [page("Henley handover, page one: Sam Solo hands the file to Bo Wren."), page("Page two: Bo Wren confirms receipt for Solo Sam.")];
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 5 0 R /Resources << /Font << /F1 7 0 R >> >> >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 6 0 R /Resources << /Font << /F1 7 0 R >> >> >>",
    `<< /Length ${streams[0]?.length} >>\nstream\n${streams[0]}\nendstream`,
    `<< /Length ${streams[1]?.length} >>\nstream\n${streams[1]}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return enc.encode(out);
}

const CT = (overrides: string) => `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${overrides}</Types>`;
const RELS = (target: string, type: string) => `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${type}" Target="${target}"/></Relationships>`;
const OFFICE_DOC = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument";

export function docx(): Uint8Array {
  return zip({
    "[Content_Types].xml": CT('<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'),
    "_rels/.rels": RELS("word/document.xml", OFFICE_DOC),
    "word/document.xml": '<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Sam Solo hands the Henley file to Bo Wren.</w:t></w:r></w:p></w:body></w:document>',
  });
}

export function xlsx(): Uint8Array {
  const S = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
  const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  return zip({
    "[Content_Types].xml": CT('<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'),
    "_rels/.rels": RELS("xl/workbook.xml", OFFICE_DOC),
    "xl/workbook.xml": `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="${S}" xmlns:r="${R}"><sheets><sheet name="Budget" sheetId="1" r:id="rId1"/><sheet name="Owners &amp; dates" sheetId="2" r:id="rId2"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${R}/worksheet" Target="/xl/worksheets/sheet2.xml"/><Relationship Id="rId3" Type="${R}/sharedStrings" Target="sharedStrings.xml"/></Relationships>`,
    "xl/sharedStrings.xml": `<?xml version="1.0" encoding="UTF-8"?><sst xmlns="${S}" count="5" uniqueCount="5"><si><t>Item</t></si><si><t>Cost</t></si><si><t>Henley venue</t></si><si><r><t>Owner</t></r></si><si><t xml:space="preserve">Ada | Wren</t></si></sst>`,
    "xl/worksheets/sheet1.xml": `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="${S}"><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>1250</v></c></row><row r="3"><c r="A3" t="inlineStr"><is><t>Catering</t></is></c><c r="C3"><v>400</v></c></row></sheetData></worksheet>`,
    "xl/worksheets/sheet2.xml": `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="${S}"><sheetData><row r="1"><c r="A1" t="s"><v>3</v></c></row><row r="2"><c r="A2" t="s"><v>4</v></c></row></sheetData></worksheet>`,
  });
}

export function pptx(): Uint8Array {
  const P = "http://schemas.openxmlformats.org/presentationml/2006/main";
  const A = "http://schemas.openxmlformats.org/drawingml/2006/main";
  const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const slide = (paras: string[]) => `<?xml version="1.0" encoding="UTF-8"?><p:sld xmlns:p="${P}" xmlns:a="${A}"><p:cSld><p:spTree><p:sp><p:txBody>${paras.map((t) => `<a:p><a:r><a:t>${t}</a:t></a:r></a:p>`).join("")}</p:txBody></p:sp></p:spTree></p:cSld></p:sld>`;
  return zip({
    "[Content_Types].xml": CT('<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>'),
    "_rels/.rels": RELS("ppt/presentation.xml", OFFICE_DOC),
    "ppt/presentation.xml": `<?xml version="1.0" encoding="UTF-8"?><p:presentation xmlns:p="${P}" xmlns:r="${R}"><p:sldIdLst><p:sldId id="256" r:id="rId2"/><p:sldId id="257" r:id="rId1"/></p:sldIdLst></p:presentation>`,
    "ppt/_rels/presentation.xml.rels": `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}/slide" Target="slides/slide1.xml"/><Relationship Id="rId2" Type="${R}/slide" Target="slides/slide2.xml"/></Relationships>`,
    "ppt/slides/slide2.xml": slide(["Henley offsite", "Sam Solo &amp; Bo Wren"]),
    "ppt/slides/slide1.xml": slide(["Agenda", "Budget review for Solo Sam"]),
  });
}

const ODF_MANIFEST = (mime: string) => `<?xml version="1.0" encoding="UTF-8"?><manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0"><manifest:file-entry manifest:full-path="/" manifest:media-type="${mime}"/><manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/></manifest:manifest>`;
const ODF_NS = 'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0"';
const odf = (mime: string, body: string) =>
  zip({ mimetype: mime, "META-INF/manifest.xml": ODF_MANIFEST(mime), "content.xml": `<?xml version="1.0" encoding="UTF-8"?><office:document-content ${ODF_NS}><office:body>${body}</office:body></office:document-content>` }, ["mimetype"]);

export const odt = () => odf("application/vnd.oasis.opendocument.text", "<office:text><text:p>Bo Wren drafts the Henley minutes for Solo Sam.</text:p></office:text>");
export const ods = () =>
  odf(
    "application/vnd.oasis.opendocument.spreadsheet",
    '<office:spreadsheet><table:table table:name="Rota"><table:table-row><table:table-cell><text:p>Day</text:p></table:table-cell><table:table-cell><text:p>Who</text:p></table:table-cell></table:table-row><table:table-row><table:table-cell><text:p>Monday</text:p></table:table-cell><table:table-cell><text:p>Sam Solo</text:p></table:table-cell><table:table-cell table:number-columns-repeated="16000"/></table:table-row><table:table-row table:number-rows-repeated="3"><table:table-cell table:number-columns-repeated="2"><text:p>Bo</text:p></table:table-cell></table:table-row></table:table></office:spreadsheet>',
  );
export const odp = () =>
  odf(
    "application/vnd.oasis.opendocument.presentation",
    '<office:presentation><draw:page draw:name="Welcome"><draw:frame><draw:text-box><text:p>Welcome to Solo Sam</text:p><text:p><text:span>Sam Solo</text:span> presents</text:p></draw:text-box></draw:frame></draw:page><draw:page draw:name="Next"><draw:frame><draw:text-box><text:p>Bo Wren closes</text:p></draw:text-box></draw:frame></draw:page></office:presentation>',
  );

export function epub(): Uint8Array {
  return zip(
    {
      mimetype: "application/epub+zip",
      "META-INF/container.xml": '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
      "content.opf": '<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">solo-sam-guide</dc:identifier><dc:title>Solo Sam guide</dc:title><dc:language>en</dc:language></metadata><manifest><item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c1"/></spine></package>',
      "c1.xhtml": '<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>One</title></head><body><p>Sam Solo welcomes Bo Wren.</p></body></html>',
    },
    ["mimetype"],
  );
}

export const rtf = (): Uint8Array => enc.encode("{\\rtf1\\ansi{\\fonttbl\\f0\\fswiss Helvetica;}\\f0\\pard Sam Solo writes to Bo Wren about the Henley file.\\par}\n");

/** A zip holding a note and a nested folder: what an archive upload unpacks to. */
export const archive = (): Uint8Array => zip({ "notes/plan.md": "# Plan\n\nSam Solo and Bo Wren meet on Monday.\n", "notes/sub/budget.csv": "item,cost\nvenue,1250\n", "readme.txt": "Solo Sam bundle\n" });

/** A 1x1 PNG, the smallest real image. */
export const png = (): Uint8Array =>
  Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0));

export const FIXTURES = { "henley.pdf": pdf, "handover.docx": docx, "budget.xlsx": xlsx, "offsite.pptx": pptx, "minutes.odt": odt, "rota.ods": ods, "welcome.odp": odp, "guide.epub": epub, "letter.rtf": rtf, "bundle.zip": archive, "pixel.png": png } as const;

if (import.meta.url === `file://${process.argv[1]}`) {
  for (const [name, build] of Object.entries(FIXTURES)) writeFileSync(decodeURIComponent(new URL(name, import.meta.url).pathname), build());
  console.log(`wrote ${Object.keys(FIXTURES).length} fixtures`);
}
