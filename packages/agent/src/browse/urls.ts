// The url_id table (M9, muse-reference section 3): a page's links reach the model as small integers,
// and a URL it passes to `browse_open` must be one the person wrote or a page handed over, character
// for character (the verbatim rule). A URL the model composed, completed or "fixed" is refused, so a
// page cannot steer the browser to an address the person never saw by suggesting one in prose.

/** Chat-meta key holding the table as JSON. */
export const URLS_KEY = "browse:urls";
const MAX_ENTRIES = 400;
const URL_IN_TEXT = /https?:\/\/[^\s<>"'`]+/gi;
const TRAILING = /[.,;:!?)\]}>]+$/;

export interface UrlEntry {
  id: number;
  url: string;
}

/** The meta cell the table lives in; the chat's store in production, a map in a test. */
export interface UrlStore {
  get(): string | null;
  set(value: string): void;
}

/** The addresses written in a message, trailing punctuation dropped. */
export function extractUrls(text: string): string[] {
  const out: string[] = [];
  for (const m of text.match(URL_IN_TEXT) ?? []) {
    const url = m.replace(TRAILING, "");
    if (validUrl(url) && !out.includes(url)) out.push(url);
  }
  return out;
}

/** An http(s) address with no userinfo, which is all the browser tool will open. */
export function validUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return (u.protocol === "https:" || u.protocol === "http:") && !u.username && !u.password && u.hostname.includes(".");
  } catch {
    return false;
  }
}

export class UrlTable {
  private readonly store: UrlStore;

  constructor(store: UrlStore) {
    this.store = store;
  }

  private entries(): { next: number; list: UrlEntry[] } {
    try {
      const raw = JSON.parse(this.store.get() ?? "null") as { next?: number; list?: UrlEntry[] } | null;
      if (raw && Array.isArray(raw.list)) return { next: Number(raw.next) || raw.list.length + 1, list: raw.list };
    } catch {
      // a damaged cell is an empty table: nothing resolves, so nothing opens
    }
    return { next: 1, list: [] };
  }

  list(): UrlEntry[] {
    return this.entries().list;
  }

  resolve(id: number): string | undefined {
    return this.entries().list.find((e) => e.id === id)?.url;
  }

  /** Whether `url` is, character for character, an address this table already holds. */
  holds(url: string): boolean {
    return this.entries().list.some((e) => e.url === url);
  }

  /** Adds addresses, giving each new one the next id; ids are never reused. Returns the ids in order. */
  add(urls: readonly string[]): number[] {
    const t = this.entries();
    const ids: number[] = [];
    for (const url of urls) {
      const have = t.list.find((e) => e.url === url);
      if (have) {
        ids.push(have.id);
        continue;
      }
      t.list.push({ id: t.next, url });
      ids.push(t.next++);
    }
    if (t.list.length > MAX_ENTRIES) t.list.splice(0, t.list.length - MAX_ENTRIES);
    this.store.set(JSON.stringify(t));
    return ids;
  }
}
