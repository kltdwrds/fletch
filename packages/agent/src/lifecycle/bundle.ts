// The personal scope as portable Markdown (memory-and-learning.md "Offboarding", "Memory import"):
// one document holding every file of the person's home tree, daily notes rebuilt from their rows (the
// rows are the record; a rendered object may lag), and the claims with their citations, so a restore
// rebuilds the same notes at the same line numbers and every citation still resolves. Export, the
// standalone conversion and memory import all read this one shape. From M11.2 it carries the person's
// file store too (`files/<path>`), since the purge removes it. `purgePersonal` empties the person's
// memory tables and their whole prefix in the tenant bucket.
import { type EntityKind, homeKey, pagePath } from "../memory/home.ts";
import { renderIndex } from "../memory/entities.ts";
import { MEMORY_SCHEMA, type PersonMemory } from "../memory/store.ts";

export const BUNDLE_HEADER = "<!-- qyvr:export v1 -->";
const FILE_MARK = /^<!-- qyvr:file (\S+) -->$/;
const ESCAPED = /^\\(<!-- qyvr:)/;

export interface BundleFile {
  path: string;
  text: string;
}

type LineRow = { date: string; line: number; text: string; scope: string; audience: string | null; source: string; writer: string; created_at: number };
type ClaimRow = { id: string; kind: string; salience: number; confidence: number; quote: string; speaker: string; supersedes: string | null; status: string; source_path: string; source_line: number; scope: string; source: string; audience: string | null; created_at: number; valid_until?: number | null };
type EntityRow = { kind: EntityKind; slug: string; display_name: string; summary: string; rank: number; names: string; updated_at: number };

/** Where in the bundle the structured rows travel; Markdown with one JSON object per line. */
export const ROWS_PATH = "qyvr/rows.md";

export interface ExportOptions {
  /** Entity slugs whose pages stay out (the company policy on pages about members). */
  excludePages?: (e: { kind: EntityKind; slug: string; names: string[] }) => boolean;
  /** The person's file store, each file whole, carried under `files/` (M11.2). */
  files?: BundleFile[];
}

/** Where a person's own files travel in the bundle. */
export const FILES_PREFIX = "files/";

export interface Exported {
  markdown: string;
  files: string[];
  excluded: string[];
  claims: number;
}

const escapeMarks = (text: string) => text.split("\n").map((l) => (l.startsWith("<!-- qyvr:") ? `\\${l}` : l)).join("\n");

/** Every object under the person's prefix, by its home path. */
async function homeObjects(mem: PersonMemory, bucket: R2Bucket): Promise<string[]> {
  const prefix = homeKey(mem.owner, "");
  const out: string[] = [];
  let cursor: string | undefined;
  do {
    const page = (await bucket.list({ prefix, ...(cursor ? { cursor } : {}) })) as R2Objects & { cursor?: string };
    for (const o of page.objects) out.push(o.key.slice(prefix.length));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return out.sort();
}

export async function exportPersonal(mem: PersonMemory, bucket: R2Bucket, options: ExportOptions = {}): Promise<Exported> {
  const entities = mem.rows<EntityRow>("SELECT * FROM entities ORDER BY kind, slug");
  const excludedEntities = entities.filter((e) => options.excludePages?.({ kind: e.kind, slug: e.slug, names: JSON.parse(e.names) as string[] }));
  const excluded = excludedEntities.map((e) => pagePath(e.kind, e.slug));
  const lines = mem.rows<LineRow>("SELECT date, line, text, scope, audience, source, writer, created_at FROM daily_lines ORDER BY date, line");
  const dates = [...new Set(lines.map((l) => l.date))];
  const files: BundleFile[] = [];
  await mem.standingFiles(); // the standing files exist from first read; an export carries them either way
  for (const path of await homeObjects(mem, bucket)) {
    if (excluded.includes(path) || /^memory\/(people|groups)\/INDEX\.md$/.test(path) || /^memory\/\d{4}-\d{2}-\d{2}\.md$/.test(path) || path.startsWith("files/")) continue;
    const obj = await bucket.get(homeKey(mem.owner, path));
    if (obj) files.push({ path, text: await obj.text() });
  }
  for (const f of options.files ?? []) files.push({ path: `${FILES_PREFIX}${f.path}`, text: f.text });
  for (const date of dates) {
    const rows = lines.filter((l) => l.date === date);
    files.push({ path: `memory/${date}.md`, text: [`# ${date}`, "", ...rows.map((r) => `- ${r.text}`)].join("\n").concat("\n") });
  }
  const claims = mem.rows<ClaimRow>("SELECT * FROM claims ORDER BY created_at, id");
  const rows = [
    "# Rows",
    "",
    ...lines.map((l) => JSON.stringify({ t: "line", ...l })),
    ...claims.map((c) => JSON.stringify({ t: "claim", ...c })),
    ...entities.filter((e) => !excludedEntities.includes(e)).map((e) => JSON.stringify({ t: "entity", ...e })),
  ].join("\n");
  files.push({ path: ROWS_PATH, text: rows });
  const markdown = [BUNDLE_HEADER, `# Memory export: ${mem.owner}`, "", ...files.flatMap((f) => [`<!-- qyvr:file ${f.path} -->`, escapeMarks(f.text)])].join("\n");
  return { markdown, files: files.map((f) => f.path), excluded, claims: claims.length };
}

/** The files of a bundle; null when the text is not one. */
export function parseBundle(markdown: string): BundleFile[] | null {
  if (!markdown.startsWith(BUNDLE_HEADER)) return null;
  const out: BundleFile[] = [];
  let current: { path: string; lines: string[] } | null = null;
  for (const line of markdown.split("\n")) {
    const m = FILE_MARK.exec(line);
    if (m?.[1]) {
      if (current) out.push({ path: current.path, text: current.lines.join("\n") });
      current = { path: m[1], lines: [] };
    } else if (current) current.lines.push(line.replace(ESCAPED, "$1"));
  }
  if (current) out.push({ path: current.path, text: current.lines.join("\n") });
  return out;
}

/**
 * Rebuilds a person's scope from a bundle into an empty store: files, then rows at their own line
 * numbers, the index and the INDEX pages. Refused over a store that already holds memory.
 */
export async function restorePersonal(
  mem: PersonMemory,
  markdown: string,
  writer: string,
  /** Puts one of the person's own files back into their file store; without it a bundle holding files is refused. */
  writeFile?: (path: string, text: string) => Promise<{ ok: boolean; code?: string }>,
): Promise<{ ok: true; files: number; lines: number; claims: number; stored: number } | { ok: false; code: string; reason: string }> {
  const files = parseBundle(markdown);
  if (!files) return { ok: false, code: "BUNDLE_INVALID", reason: "not a qyvr memory export" };
  if (mem.rows<{ n: number }>("SELECT COUNT(*) AS n FROM daily_lines")[0]?.n) return { ok: false, code: "RESTORE_NOT_EMPTY", reason: "the destination already holds memory" };
  const stored = files.filter((f) => f.path.startsWith(FILES_PREFIX));
  if (stored.length && !writeFile) return { ok: false, code: "RESTORE_FILES_UNSUPPORTED", reason: "the bundle holds files and this destination has no file store" };
  const rowsFile = files.find((f) => f.path === ROWS_PATH);
  const rows = (rowsFile?.text ?? "").split("\n").filter((l) => l.startsWith("{")).map((l) => JSON.parse(l) as Record<string, unknown> & { t: string });
  const now = mem.now();
  for (const f of files) {
    if (f.path === ROWS_PATH || /^memory\/\d{4}-\d{2}-\d{2}\.md$/.test(f.path) || f.path.includes("..") || f.path.startsWith(FILES_PREFIX)) continue;
    await mem.home.write(f.path, f.text, writer, now);
  }
  for (const f of stored) {
    const put = await (writeFile as NonNullable<typeof writeFile>)(f.path.slice(FILES_PREFIX.length), f.text);
    if (!put.ok) return { ok: false, code: put.code ?? "RESTORE_FILE_FAILED", reason: `${f.path} could not be stored` };
  }
  const lines = rows.filter((r) => r.t === "line") as unknown as LineRow[];
  const claims = rows.filter((r) => r.t === "claim") as unknown as ClaimRow[];
  const entities = rows.filter((r) => r.t === "entity") as unknown as EntityRow[];
  mem.transaction(() => {
    for (const l of lines) {
      mem.sql.exec("INSERT INTO daily_lines (date, line, text, scope, audience, source, writer, dedupe, created_at, rendered) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, 0)", l.date, l.line, l.text, l.scope, l.audience, l.source, l.writer, l.created_at);
      mem.indexLine(`memory/${l.date}.md`, l.line, l.text, l.scope, l.audience);
    }
    for (const c of claims) {
      mem.sql.exec(
        "INSERT INTO claims (id, kind, salience, confidence, quote, speaker, supersedes, status, source_path, source_line, scope, source, audience, created_at, valid_until) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        c.id, c.kind, c.salience, c.confidence, c.quote, c.speaker, c.supersedes, c.status, c.source_path, c.source_line, c.scope, c.source, c.audience, c.created_at, c.valid_until ?? null,
      );
    }
    for (const e of entities) mem.sql.exec("INSERT INTO entities (kind, slug, display_name, summary, rank, names, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)", e.kind, e.slug, e.display_name, e.summary, e.rank, e.names, e.updated_at);
  });
  for (const f of files) if (/^(MEMORY|USER|AGENTS|SOUL|IDENTITY|TOOLS)\.md$|^memory\/(people|groups)\/[^/]+\.md$/.test(f.path)) mem.reindexFile(f.path, f.text);
  await mem.renderPending();
  for (const kind of ["people", "groups"] as const) if (entities.some((e) => e.kind === kind)) await renderIndex(mem, kind);
  return { ok: true, files: files.length, lines: lines.length, claims: claims.length, stored: stored.length };
}

/** Empties the person's memory tables and deletes their whole prefix in the tenant bucket. */
export async function purgePersonal(mem: PersonMemory, bucket: R2Bucket): Promise<{ objects: number; claims: number; lines: number }> {
  const claims = mem.rows<{ n: number }>("SELECT COUNT(*) AS n FROM claims")[0]?.n ?? 0;
  const lines = mem.rows<{ n: number }>("SELECT COUNT(*) AS n FROM daily_lines")[0]?.n ?? 0;
  const tables = [...MEMORY_SCHEMA.matchAll(/CREATE (?:VIRTUAL )?TABLE IF NOT EXISTS (\w+)/g)].map((m) => m[1] as string);
  mem.transaction(() => {
    for (const t of tables) mem.sql.exec(`DELETE FROM ${t}`);
  });
  const keys = (await homeObjects(mem, bucket)).map((p) => homeKey(mem.owner, p));
  for (const key of keys) await bucket.delete(key);
  return { objects: keys.length, claims, lines };
}
