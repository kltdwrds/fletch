// The person's home tree (AD-5): standing files, daily notes, people and group pages and their
// indexes, under the person's prefix in the tenant bucket. Paths the tools take are relative to
// the home (`memory/2026-10-12.md`); keys in R2 are `person/<person>/<path>`. Every object carries
// `sha256`, `writer` and `updated_at` metadata.

export const STANDING_FILES = ["AGENTS.md", "SOUL.md", "IDENTITY.md", "USER.md", "TOOLS.md", "MEMORY.md"] as const;
export type StandingName = (typeof STANDING_FILES)[number];
/** Files injected with the standing files every turn, when they exist (M24.1); the assembler's table caps them. */
export const HOISTED_FILES = ["memory/SYNTHESIS.md", "memory/people/INDEX.md", "memory/groups/INDEX.md"] as const;
export type HoistedName = (typeof HOISTED_FILES)[number];
export type EntityKind = "people" | "groups";

export type HomePath =
  | { kind: "standing"; name: StandingName }
  | { kind: "daily"; date: string }
  | { kind: "page"; entity: EntityKind; slug: string }
  | { kind: "index"; entity: EntityKind }
  | { kind: "reflection"; date: string }
  | { kind: "synthesis" };

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/;

/** Parses a home-relative path; anything outside the tree is null, so no tool reaches another key. */
export function parseHomePath(path: string): HomePath | null {
  if ((STANDING_FILES as readonly string[]).includes(path)) return { kind: "standing", name: path as StandingName };
  const daily = /^memory\/(\d{4}-\d{2}-\d{2})\.md$/.exec(path);
  if (daily?.[1] && DATE.test(daily[1]) && !Number.isNaN(Date.parse(daily[1]))) return { kind: "daily", date: daily[1] };
  if (path === SYNTHESIS_PATH) return { kind: "synthesis" };
  const reflection = /^memory\/reflections\/(\d{4}-\d{2}-\d{2})\.md$/.exec(path);
  if (reflection?.[1] && !Number.isNaN(Date.parse(reflection[1]))) return { kind: "reflection", date: reflection[1] };
  const page = /^memory\/(people|groups)\/([^/]+)\.md$/.exec(path);
  if (page?.[1] && page[2] === "INDEX") return { kind: "index", entity: page[1] as EntityKind };
  if (page?.[1] && page[2] && SLUG.test(page[2])) return { kind: "page", entity: page[1] as EntityKind, slug: page[2] };
  return null;
}

export const dailyPath = (date: string) => `memory/${date}.md`;
export const pagePath = (entity: EntityKind, slug: string) => `memory/${entity}/${slug}.md`;
export const indexPath = (entity: EntityKind) => `memory/${entity}/INDEX.md`;
/** The nightly reflection's dated note and the synthesis it refreshes (M12). */
export const reflectionPath = (date: string) => `memory/reflections/${date}.md`;
export const SYNTHESIS_PATH = "memory/SYNTHESIS.md";

/** The R2 key of a home path; the person is encoded so no name can climb out of its prefix. */
export const homeKey = (person: string, path: string) => `person/${encodeURIComponent(person)}/${path}`;

/** `memory/<date>.md#L<n>`, the citation every search result and claim carries. */
export const citation = (path: string, line: number) => `${path}#L${line}`;

export function parseCitation(text: string): { path: string; line: number } | null {
  const m = /^(.+)#L(\d+)$/.exec(text);
  if (!m?.[1] || !m[2] || !parseHomePath(m[1])) return null;
  return { path: m[1], line: Number(m[2]) };
}

/** The calendar day of `now` in `timeZone`, as `YYYY-MM-DD`. */
export function dayOf(now: number, timeZone = "UTC"): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63);
}

/** One line of memory: newlines and surrounding space collapsed, so line numbers stay load-bearing. */
export const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();

/** The seeded standing files; the person and their agent edit them from here. */
export function defaultStanding(person: string): Record<StandingName, string> {
  return {
    "AGENTS.md":
      "# AGENTS.md\n\nSearch memory before asserting anything about prior work, decisions, dates or people, and cite what you found.\n" +
      "Save durable facts, preferences and decisions when you learn them; say what you saved only after the save succeeded.\n",
    "SOUL.md": "# SOUL.md\n\nDirect, warm and brief.\n",
    "IDENTITY.md": "# IDENTITY.md\n\nName: not chosen yet.\n",
    "USER.md": `# USER.md\n\nYou work for ${person}.\n`,
    "TOOLS.md": "# TOOLS.md\n\nNotes on the tools and how this person likes them used.\n",
    "MEMORY.md": "# MEMORY.md\n\n## Facts\n\n## Preferences\n\n## Commitments\n",
  };
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export interface HomeObject {
  text: string;
  sha256: string;
  writer: string;
  updatedAt: number;
  etag: string;
}

export type WriteResult = { ok: true; sha256: string } | { ok: false; code: "MEMORY_STALE" };

/** The person's prefix of the tenant bucket. */
export class HomeBucket {
  private readonly bucket: R2Bucket;
  private readonly person: string;

  constructor(bucket: R2Bucket, person: string) {
    this.bucket = bucket;
    this.person = person;
  }

  async read(path: string): Promise<HomeObject | null> {
    const obj = await this.bucket.get(homeKey(this.person, path));
    if (!obj) return null;
    const text = await obj.text();
    const meta = obj.customMetadata ?? {};
    return { text, sha256: meta.sha256 ?? (await sha256Hex(text)), writer: meta.writer ?? "unknown", updatedAt: Number(meta.updated_at ?? 0), etag: obj.etag };
  }

  /** Writes `text` with its metadata; with `ifEtag`, only over that exact version. */
  async write(path: string, text: string, writer: string, now: number, ifEtag?: string): Promise<WriteResult> {
    const sha256 = await sha256Hex(text);
    const put = await this.bucket.put(homeKey(this.person, path), text, {
      httpMetadata: { contentType: "text/markdown; charset=utf-8" },
      customMetadata: { sha256, writer, updated_at: String(now) },
      ...(ifEtag ? { onlyIf: { etagMatches: ifEtag } } : {}),
    });
    if (!put) return { ok: false, code: "MEMORY_STALE" };
    return { ok: true, sha256 };
  }
}
