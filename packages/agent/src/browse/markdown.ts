// Page text for the model (M9): markdown whose links are `[text](url_id:N)`, so the model addresses a
// link by number and never retypes an address. A page longer than the cap is cut at a line and says
// so, with how much was shown: a partial read is never presented as the whole page.
import { type UrlTable, validUrl } from "./urls.ts";

export const PAGE_MAX_CHARS = 20_000;
const IMAGE = /!\[([^\]]*)\]\([^)]*\)/g;
const LINK = /\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\)/g;

export interface Numbered {
  text: string;
  /** How many characters of the page were dropped, 0 for the whole page. */
  truncated: number;
  links: number;
}

export function numberLinks(markdown: string, base: string, table: UrlTable): Numbered {
  let body = markdown.replace(IMAGE, (_m, alt: string) => (alt.trim() ? `[image: ${alt.trim()}]` : "[image]"));
  let truncated = 0;
  if (body.length > PAGE_MAX_CHARS) {
    const cut = body.lastIndexOf("\n", PAGE_MAX_CHARS);
    const at = cut > PAGE_MAX_CHARS / 2 ? cut : PAGE_MAX_CHARS;
    truncated = body.length - at;
    body = body.slice(0, at);
  }
  let links = 0;
  const text = body.replace(LINK, (whole, label: string, href: string) => {
    let abs: string;
    try {
      abs = new URL(href, base).href;
    } catch {
      return label;
    }
    if (!validUrl(abs)) return label ? `${label} (${href.split(":")[0]} link)` : whole;
    const [id] = table.add([abs]);
    links++;
    return `[${label}](url_id:${id})`;
  });
  return { text, truncated, links };
}
