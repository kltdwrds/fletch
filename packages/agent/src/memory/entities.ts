// People and group pages with their `INDEX.md` (muse-reference section 5): each entity has a rank,
// its page carries frontmatter and fixed sections, and the index is rendered from rank, closest
// first, never edited by hand. Pages are personal scope and chunk-indexed like every home file.
import { type EntityKind, indexPath, oneLine, pagePath, slugify } from "./home.ts";
import { type PersonMemory, type Refusal, refuse } from "./store.ts";

export const PAGE_SECTIONS = ["Facts", "History", "The relationship", "In common", "Strengthening", "Open threads"] as const;

export interface EntityInput {
  kind: EntityKind;
  displayName: string;
  summary: string;
  /** Higher is closer; the index lists the closest first. */
  rank: number;
  names?: string[];
  slug?: string;
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
  // An existing page keeps its body; only the frontmatter is rewritten.
  const body = existing ? existing.text.replace(/^---\n[\s\S]*?\n---\n/, "") : `\n# ${oneLine(input.displayName)}\n\n${PAGE_SECTIONS.map((s) => `## ${s}\n`).join("\n")}`;
  const text = `${frontmatter(row, today)}\n${body}`;
  await mem.home.write(path, text, writer, now, existing?.etag);
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
