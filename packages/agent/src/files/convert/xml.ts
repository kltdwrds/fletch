// Just enough XML for the package parts the Worker reads (M24.3): elements by qualified name, an
// attribute, entity decoding. The parts are machine-written OOXML and ODF; the elements read here do
// not nest in themselves, so a non-greedy match finds each one.

const ENTITIES: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };

export function decodeXml(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|lt|gt|amp|quot|apos);/g, (_, e: string) => {
    if (e.startsWith("#x")) return String.fromCodePoint(Number.parseInt(e.slice(2), 16));
    if (e.startsWith("#")) return String.fromCodePoint(Number.parseInt(e.slice(1), 10));
    return ENTITIES[e] ?? "";
  });
}

const quote = (tag: string) => tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Every `<tag ...>body</tag>` and `<tag .../>` in `xml`, in document order. */
export function elements(xml: string, tag: string): Array<{ attrs: string; body: string }> {
  const t = quote(tag);
  const re = new RegExp(`<${t}(\\s[^>]*?)?(?:/>|>([\\s\\S]*?)</${t}>)`, "g");
  return [...xml.matchAll(re)].map((m) => ({ attrs: m[1] ?? "", body: m[2] ?? "" }));
}

export function attr(attrs: string, name: string): string | undefined {
  const m = attrs.match(new RegExp(`(?:^|\\s)${quote(name)}\\s*=\\s*"([^"]*)"`));
  return m ? decodeXml(m[1] as string) : undefined;
}

/** The text of a fragment: tags dropped, entities decoded. */
export const textOf = (fragment: string): string => decodeXml(fragment.replace(/<[^>]+>/g, ""));

/** A cell for a Markdown table: one line, pipes escaped. */
export const cell = (s: string): string => s.replace(/\s*\n\s*/g, " ").replace(/\|/g, "\\|").trim();

export function table(rows: string[][]): string {
  const width = Math.max(1, ...rows.map((r) => r.length));
  const line = (r: string[]) => `| ${Array.from({ length: width }, (_, i) => cell(r[i] ?? "")).join(" | ")} |`;
  const [head = [], ...rest] = rows;
  return [line(head), `| ${Array.from({ length: width }, () => "---").join(" | ")} |`, ...rest.map(line)].join("\n");
}
