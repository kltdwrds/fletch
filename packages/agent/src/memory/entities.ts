// People and group pages with their `INDEX.md` (muse-reference section 5): each entity has a rank,
// its page carries frontmatter and fixed sections, and the index is rendered from rank, closest
// first, never edited by hand. Pages are personal scope and chunk-indexed like every home file.
// The chat reaches a person page through `memory_write` target person (F44, delta 7): `notePerson` saves the stated
// relationship as a daily line and writes the page citing it, refused by code for a name that is not a person's or
// that the person did not write in their own message.
import { type EntityKind, indexPath, oneLine, pagePath, slugify } from "./home.ts";
import { type DailyWrite, type PersonMemory, type Refusal, refuse, type Written } from "./store.ts";

export const PAGE_SECTIONS = ["Facts", "History", "The relationship", "In common", "Strengthening", "Open threads"] as const;

export interface EntityInput {
  kind: EntityKind;
  displayName: string;
  summary: string;
  /** Higher is closer; the index lists the closest first. */
  rank: number;
  names?: string[];
  slug?: string;
  /** A cited line added under each of `sections` (page sections), once: a fact on a page carries its source (B-P6-11). */
  cite?: { line: string; sections: ReadonlyArray<(typeof PAGE_SECTIONS)[number]> };
}

/** `body` with `- <line>` at the end of each named section's list, unless that section already holds it. */
function withLine(body: string, line: string, sections: readonly string[]): string {
  const rows = body.split("\n");
  for (const section of sections) {
    const at = rows.indexOf(`## ${section}`);
    if (at < 0) continue;
    let end = at + 1;
    while (end < rows.length && !rows[end]!.startsWith("## ")) end++;
    if (rows.slice(at + 1, end).includes(`- ${line}`)) continue;
    // After the section's last non-blank row, so the list stays one block and the blank before the next heading stays.
    let last = end - 1;
    while (last > at && !rows[last]!.trim()) last--;
    rows.splice(last + 1, 0, `- ${line}`);
  }
  return rows.join("\n");
}

type EntityRow = { kind: EntityKind; slug: string; display_name: string; summary: string; rank: number; names: string; updated_at: number };

function frontmatter(e: EntityRow, today: string): string {
  return [
    "---",
    `display_name: ${oneLine(e.display_name)}`,
    `summary: ${oneLine(e.summary)}`,
    `rank: ${e.rank}`,
    `updated: ${today}`,
    `names: ${JSON.stringify(JSON.parse(e.names))}`,
    "---",
  ].join("\n");
}

/** Creates or updates an entity and its page, then re-renders the kind's index. */
export async function upsertEntity(mem: PersonMemory, input: EntityInput, writer: string): Promise<{ ok: true; path: string } | Refusal> {
  const slug = input.slug ?? slugify(input.displayName);
  if (!slug) return refuse("MEMORY_ENTITY_NAME", "the entity needs a name");
  if (!Number.isInteger(input.rank)) return refuse("MEMORY_ENTITY_RANK", "rank is an integer");
  const now = mem.now();
  const row: EntityRow = {
    kind: input.kind,
    slug,
    display_name: input.displayName,
    summary: input.summary,
    rank: input.rank,
    names: JSON.stringify(input.names ?? [input.displayName]),
    updated_at: now,
  };
  mem.sql.exec(
    `INSERT INTO entities (kind, slug, display_name, summary, rank, names, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (kind, slug) DO UPDATE SET display_name = excluded.display_name, summary = excluded.summary, rank = excluded.rank,
       names = excluded.names, updated_at = excluded.updated_at`,
    row.kind,
    row.slug,
    row.display_name,
    row.summary,
    row.rank,
    row.names,
    row.updated_at,
  );
  const path = pagePath(input.kind, slug);
  const today = new Date(now).toISOString().slice(0, 10);
  const existing = await mem.home.read(path);
  // An existing page keeps its body; only the frontmatter is rewritten, and a cited line added.
  const kept = existing ? existing.text.replace(/^---\n[\s\S]*?\n---\n/, "") : `\n# ${oneLine(input.displayName)}\n\n${PAGE_SECTIONS.map((s) => `## ${s}\n`).join("\n")}`;
  const body = input.cite ? withLine(kept, oneLine(input.cite.line), input.cite.sections) : kept;
  const text = `${frontmatter(row, today)}\n${body}`;
  const put = await mem.home.write(path, text, writer, now, existing?.etag);
  if (!put.ok) return refuse("MEMORY_STALE", `${path} changed during the write; write it again`);
  mem.reindexFile(path, text);
  await renderIndex(mem, input.kind);
  return { ok: true, path };
}

/** `INDEX.md` from the entity rows, closest first; ties by name. */
export async function renderIndex(mem: PersonMemory, kind: EntityKind): Promise<string> {
  const rows = mem.rows<EntityRow>("SELECT * FROM entities WHERE kind = ? ORDER BY rank DESC, display_name", kind);
  const title = kind === "people" ? "People" : "Groups";
  const text = [`# ${title}`, "", "Rendered from rank, closest first. Do not edit by hand.", "", ...rows.map((r) => `- [${oneLine(r.display_name)}](${r.slug}.md) (rank ${r.rank}): ${oneLine(r.summary)}`)]
    .join("\n")
    .concat("\n");
  await mem.home.write(indexPath(kind), text, "qyvr:render", mem.now());
  mem.reindexFile(indexPath(kind), text);
  return text;
}

/** Words that name an organisation, a group or a thing, never a person: a name holding one is refused. */
const NOT_PERSON_WORDS = new Set(
  "inc ltd llc plc gmbh corp corporation company co team group club bank university college school committee department agency foundation society council board project meeting standup app channel family band".split(" "),
);
/** A person's name: one to five words of letters (with ' . -), the first and the last capitalised, no digits. */
const PERSON_NAME = /^\p{Lu}[\p{L}'’.-]*(?:(?: [\p{L}'’.-]+){0,3} \p{Lu}[\p{L}'’.-]*)?$/u;
const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Why `name` is not a person's name, or null when it reads as one. */
export function notAPerson(name: string): string | null {
  if (!PERSON_NAME.test(name)) return `"${name}" does not read as a person's name`;
  const word = name.toLowerCase().split(/[\s.]+/).find((w) => NOT_PERSON_WORDS.has(w));
  return word ? `"${name}" names a ${word}, not a person` : null;
}

/** Whether `said` holds `name` as whole words, in any case. */
export function namedIn(said: string, name: string): boolean {
  return new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegex(name).replace(/ /g, "\\s+")}(?![\\p{L}\\p{N}])`, "iu").test(said);
}

export interface PersonNote {
  name: string;
  relationship: string;
}

/**
 * A stated relationship, from the chat (F44, delta 7): refused by code unless the name reads as a person's, the person
 * wrote it in their own message this turn (`said`, from the chat's code) and it is no group page; then the
 * relationship is one daily line through the same write as any fact (idempotent by `dedupe`), and the person's page is
 * created or updated with that line cited under Facts and The relationship, its summary the relationship, so the index
 * lists the person with it. A page is never written from a name the person did not type, nor for anything not a person.
 */
export async function notePerson(mem: PersonMemory, input: PersonNote, ctx: Omit<DailyWrite, "text"> & { requester: string; said?: string }): Promise<(Written & { page: string }) | Refusal> {
  if (ctx.requester !== mem.owner) return refuse("MEMORY_NOT_OWNER", "only the person's own agent writes their people pages");
  const name = oneLine(input.name ?? "");
  const relationship = oneLine(input.relationship ?? "").replace(/[.;,\s]+$/, "");
  const why = notAPerson(name);
  if (why) return refuse("MEMORY_PERSON_NOT_A_PERSON", `${why}; a person page is for someone the person named`);
  if (!ctx.said || !namedIn(ctx.said, name)) return refuse("MEMORY_PERSON_NOT_NAMED", `the person did not name "${name}" in their message; a page is written only for someone they named`);
  if (!relationship) return refuse("MEMORY_PERSON_NO_RELATIONSHIP", "say what they are to the person; a page is written only on a stated relationship");
  const slug = slugify(name);
  if (mem.rows("SELECT slug FROM entities WHERE kind = 'groups' AND slug = ?", slug).length) return refuse("MEMORY_PERSON_NOT_A_PERSON", `"${name}" is a group page, not a person`);
  const line = await mem.appendDaily({ ...ctx, text: `${name}: ${relationship}` });
  if (!line.ok) return line;
  const prior = mem.rows<{ rank: number; names: string }>("SELECT rank, names FROM entities WHERE kind = 'people' AND slug = ?", slug)[0];
  const names = [...new Set([...(prior ? (JSON.parse(prior.names) as string[]) : []), name])];
  const page = await upsertEntity(
    mem,
    { kind: "people", slug, displayName: name, summary: relationship, rank: prior?.rank ?? 1, names, cite: { line: `${relationship} — ${line.citation}`, sections: ["Facts", "The relationship"] } },
    `agent:${mem.owner}`,
  );
  if (!page.ok) return refuse(page.code, `the line was saved at ${line.citation}, but the page was not written: ${page.reason}`);
  return { ...line, page: page.path };
}
