// Personal memory in the `Person` object (AD-5, memory-and-learning.md): daily lines buffered as
// rows and rendered to R2, claims with provenance, the FTS5 chunk index, and the standing files.
// This is the owning store: every read decides here who may see what, on every call. Every row here
// is personal scope; a row learned in a shared setting also carries its audience, and the disclosure
// gate (M10.1) shows it to the owner or to someone in that audience, and to every reader of a turn
// only when each of them may see it. Company and team scope live in the `Company` (`company.ts`).
import {
  citation,
  dailyPath,
  dayOf,
  defaultStanding,
  HomeBucket,
  oneLine,
  parseCitation,
  parseHomePath,
  STANDING_FILES,
  sha256Hex,
  type StandingName,
  HOISTED_FILES,
  type HoistedName,
} from "./home.ts";
import { disclosesToAll } from "./disclosure.ts";
import { enqueueVector, fuse, type Match, type SemanticDegraded, type SemanticLeg, VECTOR_QUEUE_SCHEMA } from "./semantic.ts";

export const MEMORY_SCHEMA = `
CREATE TABLE IF NOT EXISTS memory_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS daily_lines (
  date TEXT NOT NULL, line INTEGER NOT NULL, text TEXT NOT NULL, scope TEXT NOT NULL, audience TEXT,
  source TEXT NOT NULL, writer TEXT NOT NULL, dedupe TEXT UNIQUE, created_at INTEGER NOT NULL,
  rendered INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (date, line)
);
CREATE TABLE IF NOT EXISTS claims (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, salience INTEGER NOT NULL, confidence REAL NOT NULL,
  quote TEXT NOT NULL, speaker TEXT NOT NULL, supersedes TEXT, status TEXT NOT NULL,
  source_path TEXT NOT NULL, source_line INTEGER NOT NULL, scope TEXT NOT NULL, source TEXT NOT NULL,
  audience TEXT, created_at INTEGER NOT NULL, valid_until INTEGER
);
CREATE INDEX IF NOT EXISTS claims_source ON claims (source_path, source_line);
CREATE TABLE IF NOT EXISTS chunks (
  id INTEGER PRIMARY KEY AUTOINCREMENT, path TEXT NOT NULL, line_start INTEGER NOT NULL,
  line_end INTEGER NOT NULL, text TEXT NOT NULL, scope TEXT NOT NULL, audience TEXT
);
CREATE INDEX IF NOT EXISTS chunks_path ON chunks (path, line_start);
CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(text, tokenize = 'porter unicode61');
CREATE TABLE IF NOT EXISTS entities (
  kind TEXT NOT NULL, slug TEXT NOT NULL, display_name TEXT NOT NULL, summary TEXT NOT NULL,
  rank INTEGER NOT NULL, names TEXT NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (kind, slug)
);
CREATE TABLE IF NOT EXISTS forget_plans (
  id TEXT PRIMARY KEY, claims TEXT NOT NULL, lines TEXT NOT NULL, status TEXT NOT NULL,
  created_at INTEGER NOT NULL, confirmed_at INTEGER, executed_at INTEGER
);
${VECTOR_QUEUE_SCHEMA}`;

/** Daily notes open with a heading and a blank line; the first entry is line 3. */
export const FIRST_ENTRY_LINE = 3;
export const MAX_LINE_CHARS = 1000;
export const CLAIM_KINDS = ["fact", "event", "preference", "correction", "boundary"] as const;
export type ClaimKind = (typeof CLAIM_KINDS)[number];

/** Where something was learned. `audience` lists the people present in a shared setting. */
export interface Setting {
  scope: "personal";
  audience?: string[];
}

/**
 * A claim the hourly upkeep mints from one daily line (Muse spec §17.3): the upkeep is the only
 * minter, so `run` is its run id. The line's setting rides with the claim.
 */
export interface ClaimMint {
  run: string;
  kind: ClaimKind;
  text: string;
  path: string;
  line: number;
  salience?: 1 | 2 | 3;
  confidence?: 0.5 | 0.7 | 0.9;
  speaker?: "user" | "observed";
  supersedes?: string | null;
}
/** The prefix of every memory upkeep run id (`LoopRun`), the one writer `mintClaim` accepts. */
export const UPKEEP_RUN_PREFIX = "loop:memory-upkeep:";

export interface DailyWrite {
  text: string;
  setting: Setting;
  /** Who wrote it, e.g. `agent:<person>`; stored with the line and on the rendered object. */
  writer: string;
  /** Where it came from, e.g. `chat:<id>`. */
  source: string;
  /** A key that makes the write idempotent, such as the tool call id. */
  dedupe?: string;
  timeZone?: string;
}

export type Refusal = { ok: false; code: string; reason: string };
export type Written = { ok: true; path: string; line: number; citation: string };

export interface HitClaim {
  id: string;
  kind: string;
  status: string;
  supersedes: string | null;
  supersededBy: string | null;
  /** When a dated event's claim ends (the end of its UTC day); null for a claim with no date. */
  validUntil: number | null;
}
export interface SearchHit {
  citation: string;
  uri: string;
  path: string;
  line: number;
  text: string;
  /** `personal`, `company` or `team:<id>`: the store the line lives in and the gate it passed. */
  scope: string;
  audience: string[] | null;
  claims: HitClaim[];
  /** Present whenever a claim on this line has been superseded or has expired; never dropped from a hit. */
  marker?: string;
  /** Which index found it, when the semantic half ran (M12.2). */
  match?: Match;
}
/** `semantic` is present when the semantic half failed: the hits are keyword matches only. */
export type SearchResult = { ok: true; hits: SearchHit[]; more: number; semantic?: SemanticDegraded } | Refusal;

type ChunkRow = { id: number; path: string; line_start: number; text: string; audience: string | null; score: number };
type ClaimRow = {
  id: string;
  kind: string;
  salience: number;
  confidence: number;
  quote: string;
  speaker: string;
  supersedes: string | null;
  status: string;
  source_path: string;
  source_line: number;
  scope: string;
  source: string;
  audience: string | null;
  created_at: number;
  valid_until: number | null;
};

export const refuse = (code: string, reason: string): Refusal => ({ ok: false, code, reason });
/** Results one search returns: 8 unless asked, between 1 and 25. */
export const maxOf = (input: { maxResults?: number }) => Math.min(Math.max(input.maxResults ?? 8, 1), 25);
/**
 * The end of a dated event: the first YYYY-MM-DD in the claim's text that is a real day, ending at that
 * UTC day's close (Muse spec §17.6). An event with no such date stays active.
 */
export function eventEnd(text: string): number | null {
  for (const m of text.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) {
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    const day = Date.UTC(y, mo - 1, d);
    if (new Date(day).toISOString().slice(0, 10) === m[0]) return day + 86_400_000;
  }
  return null;
}

const audienceOf = (raw: string | null): string[] | null => (raw ? (JSON.parse(raw) as string[]) : null);

export class PersonMemory {
  readonly owner: string;
  readonly home: HomeBucket;
  readonly now: () => number;
  private readonly storage: Pick<DurableObjectStorage, "sql" | "transactionSync">;

  constructor(storage: Pick<DurableObjectStorage, "sql" | "transactionSync">, bucket: R2Bucket, owner: string, now: () => number = Date.now) {
    this.storage = storage;
    this.owner = owner;
    this.home = new HomeBucket(bucket, owner);
    this.now = now;
  }

  get sql(): SqlStorage {
    return this.storage.sql;
  }

  rows<T>(query: string, ...bindings: unknown[]): T[] {
    return this.sql.exec(query, ...bindings).toArray() as T[];
  }

  transaction<R>(fn: () => R): R {
    this.sql;
    return this.storage.transactionSync(fn);
  }

  /**
   * The disclosure gate over a personal row: the owner, or someone in the audience of a shared-setting
   * row, may see it; with several readers (a request turn answers a colleague), each must.
   */
  visible(audience: string | null, readers: string | readonly string[]): boolean {
    const who = (typeof readers === "string" ? [readers] : readers).map((email) => ({ email, member: true, teams: [] }));
    return disclosesToAll({ scope: "personal", owner: this.owner, audience: audienceOf(audience) }, who);
  }

  // Daily notes ---------------------------------------------------------------------------------

  /** Appends one line to today's note; idempotent by `dedupe`. Its claim, if any, is the upkeep's to mint. */
  async appendDaily(input: DailyWrite): Promise<Written | Refusal> {
    const text = oneLine(input.text);
    if (!text) return refuse("MEMORY_EMPTY", "the line is empty");
    if (text.length > MAX_LINE_CHARS) return refuse("MEMORY_TOO_LONG", `a line holds at most ${MAX_LINE_CHARS} characters`);
    if (input.dedupe) {
      const prior = this.rows<{ date: string; line: number }>("SELECT date, line FROM daily_lines WHERE dedupe = ?", input.dedupe)[0];
      if (prior) return { ok: true, path: dailyPath(prior.date), line: prior.line, citation: citation(dailyPath(prior.date), prior.line) };
    }
    const now = this.now();
    const date = dayOf(now, input.timeZone);
    // Rollover: earlier days still buffered are rendered before today's first line lands.
    for (const { date: d } of this.rows<{ date: string }>("SELECT DISTINCT date FROM daily_lines WHERE rendered = 0 AND date < ?", date)) await this.renderDate(d);
    const audience = input.setting.audience?.length ? JSON.stringify([...new Set(input.setting.audience)].sort()) : null;
    const path = dailyPath(date);
    return this.transaction(() => {
      const count = this.rows<{ n: number }>("SELECT COUNT(*) AS n FROM daily_lines WHERE date = ?", date)[0]?.n ?? 0;
      const line = FIRST_ENTRY_LINE + count;
      this.sql.exec(
        "INSERT INTO daily_lines (date, line, text, scope, audience, source, writer, dedupe, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        date,
        line,
        text,
        input.setting.scope,
        audience,
        input.source,
        input.writer,
        input.dedupe ?? null,
        now,
      );
      this.indexLine(path, line, text, input.setting.scope, audience);
      return { ok: true as const, path, line, citation: citation(path, line) };
    });
  }

  /**
   * One claim on one daily line, minted by the hourly upkeep alone and decided here: the line exists, it
   * carries no claim yet (a line is claimed once, whatever the wording), a superseded claim is active,
   * and a dated event ends with its day. The line's scope and audience ride with the claim.
   */
  mintClaim(c: ClaimMint): { ok: true; id: string; validUntil: number | null } | Refusal {
    if (!c.run.startsWith(UPKEEP_RUN_PREFIX)) return refuse("MEMORY_CLAIM_BY_UPKEEP", "claims are minted by the hourly memory upkeep from daily lines");
    if (!CLAIM_KINDS.includes(c.kind)) return refuse("MEMORY_CLAIM_KIND", `kind must be one of ${CLAIM_KINDS.join(", ")}`);
    const text = oneLine(c.text);
    if (!text || text.length > MAX_LINE_CHARS) return refuse("MEMORY_CLAIM_INVALID", `a claim is 1-${MAX_LINE_CHARS} characters`);
    const at = parseHomePath(c.path);
    const line = at?.kind === "daily" ? this.rows<{ scope: string; audience: string | null }>("SELECT scope, audience FROM daily_lines WHERE date = ? AND line = ?", at.date, c.line)[0] : undefined;
    if (!line) return refuse("LOOP_CITATION_UNRESOLVED", `${citation(c.path, c.line)} is not a daily line`);
    if (this.rows("SELECT id FROM claims WHERE source_path = ? AND source_line = ? LIMIT 1", c.path, c.line).length) return refuse("LOOP_CLAIM_EXISTS", `${citation(c.path, c.line)} already carries a claim`);
    if (c.supersedes) {
      const old = this.rows<{ status: string }>("SELECT status FROM claims WHERE id = ?", c.supersedes)[0];
      if (!old) return refuse("MEMORY_SUPERSEDES_UNKNOWN", `no claim ${c.supersedes}`);
      if (old.status !== "active") return refuse("MEMORY_SUPERSEDES_INACTIVE", `claim ${c.supersedes} is ${old.status}`);
    }
    const id = `c_${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
    const validUntil = c.kind === "event" ? eventEnd(text) : null;
    // Two writes with no await between them commit together; the upkeep also calls this inside its batch's transaction.
    this.sql.exec(
      `INSERT INTO claims (id, kind, salience, confidence, quote, speaker, supersedes, status, source_path, source_line, scope, source, audience, created_at, valid_until)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?)`,
      id, c.kind, c.salience ?? 2, c.confidence ?? 0.7, text, c.speaker ?? "observed", c.supersedes ?? null, c.path, c.line, line.scope, c.run, line.audience, this.now(), validUntil,
    );
    if (c.supersedes) this.sql.exec("UPDATE claims SET status = 'superseded' WHERE id = ?", c.supersedes);
    return { ok: true, id, validUntil };
  }

  /** Active claims whose day has ended become `expired` (Muse spec §17.6); returns their ids. */
  expireDue(): string[] {
    const due = this.rows<{ id: string }>("SELECT id FROM claims WHERE status = 'active' AND valid_until IS NOT NULL AND valid_until <= ? ORDER BY id", this.now()).map((r) => r.id);
    if (due.length) this.sql.exec("UPDATE claims SET status = 'expired' WHERE status = 'active' AND valid_until IS NOT NULL AND valid_until <= ?", this.now());
    return due;
  }

  /** Dates with lines not yet in R2. */
  pendingDates(): string[] {
    return this.rows<{ date: string }>("SELECT DISTINCT date FROM daily_lines WHERE rendered = 0 ORDER BY date").map((r) => r.date);
  }

  /** Renders every buffered day; the timer and the rollover call this. */
  async renderPending(): Promise<string[]> {
    const dates = this.pendingDates();
    for (const d of dates) await this.renderDate(d);
    return dates;
  }

  /** Writes the whole day from its rows, so line n of the object is row n. */
  async renderDate(date: string): Promise<void> {
    const rows = this.rows<{ line: number; text: string }>("SELECT line, text FROM daily_lines WHERE date = ? ORDER BY line", date);
    const last = rows.at(-1)?.line ?? 0;
    const text = [`# ${date}`, "", ...rows.map((r) => `- ${r.text}`)].join("\n").concat("\n");
    await this.home.write(dailyPath(date), text, "qyvr:render", this.now());
    this.sql.exec("UPDATE daily_lines SET rendered = 1 WHERE date = ? AND line <= ?", date, last);
  }

  // The chunk index -----------------------------------------------------------------------------

  indexLine(path: string, line: number, text: string, scope: string, audience: string | null): void {
    const id = this.rows<{ id: number }>("INSERT INTO chunks (path, line_start, line_end, text, scope, audience) VALUES (?, ?, ?, ?, ?, ?) RETURNING id", path, line, line, text, scope, audience)[0]?.id;
    this.sql.exec("INSERT INTO chunks_fts (rowid, text) VALUES (?, ?)", id ?? null, text);
    if (id !== undefined) enqueueVector(this.sql, id, "upsert");
  }

  dropIndex(path: string, line?: number): void {
    const where = line === undefined ? "path = ?" : "path = ? AND line_start = ?";
    const args = line === undefined ? [path] : [path, line];
    for (const { id } of this.rows<{ id: number }>(`SELECT id FROM chunks WHERE ${where}`, ...args)) {
      this.sql.exec("DELETE FROM chunks_fts WHERE rowid = ?", id);
      enqueueVector(this.sql, id, "delete");
    }
    this.sql.exec(`DELETE FROM chunks WHERE ${where}`, ...args);
  }

  /** Re-indexes a whole file (standing files and pages), one chunk per non-blank line. */
  reindexFile(path: string, text: string): void {
    this.transaction(() => {
      this.dropIndex(path);
      text.split("\n").forEach((l, i) => {
        if (l.trim() && !/^#+\s*$/.test(l)) this.indexLine(path, i + 1, l, "personal", null);
      });
    });
  }

  /** Two or three phrasings over the keyword index alone, merged by best rank, filtered to what `requester` may see. */
  search(input: { queries: string[]; maxResults?: number }, requester: string | readonly string[]): SearchResult {
    const ranked = this.ranked(input, requester);
    if (!ranked.ok) return ranked;
    const max = maxOf(input);
    return { ok: true, hits: ranked.rows.slice(0, max).map((r) => this.hit(r, requester)), more: Math.max(ranked.rows.length - max, 0) };
  }

  /**
   * Keyword and semantic search fused (M12.2): the semantic leg proposes row ids of this store, and
   * this store resolves each and applies the same gate as the keyword hits. When the semantic half
   * fails the keyword hits come back with the reason, never as a complete answer.
   */
  async searchHybrid(input: { queries: string[]; maxResults?: number }, requester: string | readonly string[], leg: SemanticLeg): Promise<SearchResult> {
    const ranked = this.ranked(input, requester);
    if (!ranked.ok) return ranked;
    const max = maxOf(input);
    // An empty index makes no embedding call: there is nothing the semantic half could find.
    if (!this.rows("SELECT id FROM chunks LIMIT 1").length) return { ok: true, hits: [], more: 0 };
    const near = await leg.recall(ranked.queries);
    if (!near.ok) {
      const hits = ranked.rows.slice(0, max).map((r) => ({ ...this.hit(r, requester), match: "keyword" as const }));
      return { ok: true, hits, more: Math.max(ranked.rows.length - max, 0), semantic: { code: near.code, reason: near.reason } };
    }
    const rows = new Map(ranked.rows.map((r) => [r.id, r]));
    for (const r of this.chunksByIds(near.ids.filter((id) => !rows.has(id)), requester)) rows.set(r.id, r);
    const fused = fuse(ranked.rows.map((r) => r.id), near.ids.filter((id) => rows.has(id)));
    const hits = fused.slice(0, max).map((f) => ({ ...this.hit(rows.get(f.id) as ChunkRow, requester), match: f.match }));
    return { ok: true, hits, more: Math.max(fused.length - max, 0) };
  }

  /** Chunk rows by id that `requester` may see; ids that are gone resolve to nothing. */
  chunksByIds(ids: readonly number[], requester: string | readonly string[]): ChunkRow[] {
    if (!ids.length) return [];
    return this.rows<ChunkRow>(`SELECT id, path, line_start, text, audience, 0 AS score FROM chunks WHERE id IN (${ids.map(() => "?").join(", ")})`, ...ids).filter((r) => this.visible(r.audience, requester));
  }

  /** Every chunk id in the index, for the purge of the person's vectors. */
  chunkIds(): number[] {
    return this.rows<{ id: number }>("SELECT id FROM chunks ORDER BY id").map((r) => r.id);
  }

  /** Chunk texts by id, for the semantic leg's sync; rows that are gone are left out. */
  chunkTexts(ids: readonly number[]): Map<number, string> {
    if (!ids.length) return new Map();
    return new Map(this.rows<{ id: number; text: string }>(`SELECT id, text FROM chunks WHERE id IN (${ids.map(() => "?").join(", ")})`, ...ids).map((r) => [r.id, r.text]));
  }

  /** The keyword ranking: every visible row any phrasing matched, best first. */
  private ranked(input: { queries: string[] }, requester: string | readonly string[]): { ok: true; rows: ChunkRow[]; queries: string[] } | Refusal {
    const queries = input.queries.map((q) => q.trim()).filter(Boolean);
    if (!queries.length) return refuse("MEMORY_QUERY_EMPTY", "give at least one phrasing");
    // A dated event past its day reads `expired` on every hit, whether or not the upkeep has run since.
    this.expireDue();
    const best = new Map<number, ChunkRow>();
    for (const q of queries) {
      const terms = [...new Set(q.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])].filter((t) => t.length > 1).slice(0, 16);
      if (!terms.length) continue;
      // Each term is quoted, so nothing in a query is FTS syntax.
      const match = terms.map((t) => `"${t}"`).join(" OR ");
      const rows = this.rows<ChunkRow>(
        `SELECT c.id, c.path, c.line_start, c.text, c.audience, bm25(chunks_fts) AS score
         FROM chunks_fts JOIN chunks c ON c.id = chunks_fts.rowid WHERE chunks_fts MATCH ? ORDER BY score LIMIT 100`,
        match,
      );
      for (const r of rows) if (!best.has(r.id) || (best.get(r.id)?.score ?? 0) > r.score) best.set(r.id, r);
    }
    const rows = [...best.values()].filter((r) => this.visible(r.audience, requester)).sort((a, b) => a.score - b.score || a.id - b.id);
    return { ok: true, rows, queries };
  }

  private hit(r: ChunkRow, requester: string | readonly string[]): SearchHit {
    const claims = this.rows<ClaimRow>("SELECT * FROM claims WHERE source_path = ? AND source_line = ? ORDER BY created_at, id", r.path, r.line_start)
      .filter((c) => this.visible(c.audience, requester))
      .map((c) => ({ id: c.id, kind: c.kind, status: c.status, supersedes: c.supersedes, supersededBy: this.successor(c.id), validUntil: c.valid_until ?? null }));
    const superseded = claims.filter((c) => c.status === "superseded");
    const expired = claims.filter((c) => c.status === "expired");
    const hit: SearchHit = {
      citation: citation(r.path, r.line_start),
      uri: `memory://md:${r.path}:${r.line_start}`,
      path: r.path,
      line: r.line_start,
      text: r.text,
      scope: "personal",
      audience: audienceOf(r.audience),
      claims,
    };
    const marks = [
      ...superseded.map((c) => `SUPERSEDED: claim ${c.id} was replaced by ${c.supersededBy ?? "a later claim"}`),
      ...expired.map((c) => `EXPIRED: claim ${c.id} ended ${new Date((c.validUntil ?? 1) - 1).toISOString().slice(0, 10)}`),
    ];
    if (marks.length) hit.marker = marks.join("; ");
    return hit;
  }

  successor(id: string): string | null {
    return this.rows<{ id: string }>("SELECT id FROM claims WHERE supersedes = ? ORDER BY created_at LIMIT 1", id)[0]?.id ?? null;
  }

  // Files ---------------------------------------------------------------------------------------

  /** The standing files, seeding any that are missing; MEMORY.md is indexed when seeded. */
  async standingFiles(): Promise<Array<{ name: StandingName | HoistedName; text: string; sha256: string }>> {
    const defaults = defaultStanding(this.owner);
    const out: Array<{ name: StandingName | HoistedName; text: string; sha256: string }> = [];
    for (const name of STANDING_FILES) {
      let obj = await this.home.read(name);
      if (!obj) {
        await this.writeStanding(name, defaults[name], "qyvr:seed");
        obj = await this.home.read(name);
      }
      if (obj) out.push({ name, text: obj.text, sha256: obj.sha256 });
    }
    // The nightly synthesis and the people and groups indexes ride with them (M24.1); they are not seeded.
    for (const name of HOISTED_FILES) {
      const obj = await this.home.read(name);
      if (obj) out.push({ name, text: obj.text, sha256: obj.sha256 });
    }
    return out;
  }

  async writeStanding(name: StandingName, text: string, writer: string): Promise<void> {
    await this.home.write(name, text, writer, this.now());
    if (name === "MEMORY.md") this.reindexFile(name, text);
  }

  /** Line-addressed edits of MEMORY.md against the numbered copy whose sha256 the caller read. */
  async editMemory(input: { sha256: string; edits: Array<{ op: "replace" | "insert" | "delete"; line: number; text?: string }> }, writer: string, requester: string) {
    if (requester !== this.owner) return refuse("MEMORY_NOT_OWNER", "only the owner's agent edits MEMORY.md");
    if (!input.edits.length) return refuse("MEMORY_EDIT_EMPTY", "no edits given");
    await this.standingFiles();
    const current = await this.home.read("MEMORY.md");
    if (!current) return refuse("MEMORY_NOT_FOUND", "MEMORY.md is missing");
    if (current.sha256 !== input.sha256) return { ...refuse("MEMORY_STALE", "MEMORY.md changed since it was read; read it again"), sha256: current.sha256 };
    const lines = current.text.replace(/\n$/, "").split("\n");
    // Where each replaced or inserted line ends up (0-based), moved by every later edit above it, so the result cites
    // each line the edit wrote as a daily write cites its line (F44, delta 1: the reply quotes the citation returned).
    let written: number[] = [];
    // Highest line first, so every edit addresses the numbered copy the caller read.
    for (const e of [...input.edits].sort((a, b) => b.line - a.line)) {
      const text = oneLine(e.text ?? "");
      if (e.op === "insert" ? e.line < 0 || e.line > lines.length : e.line < 1 || e.line > lines.length) return refuse("MEMORY_EDIT_LINE", `line ${e.line} is outside 1..${lines.length}`);
      if (e.op !== "delete" && !text) return refuse("MEMORY_EDIT_EMPTY", `edit at line ${e.line} has no text`);
      if (e.op === "replace") {
        lines[e.line - 1] = text;
        written = [...written.filter((w) => w !== e.line - 1), e.line - 1];
      } else if (e.op === "insert") {
        lines.splice(e.line, 0, text);
        written = [...written.map((w) => (w >= e.line ? w + 1 : w)), e.line];
      } else {
        lines.splice(e.line - 1, 1);
        written = written.filter((w) => w !== e.line - 1).map((w) => (w > e.line - 1 ? w - 1 : w));
      }
    }
    const text = `${lines.join("\n")}\n`;
    const put = await this.home.write("MEMORY.md", text, writer, this.now(), current.etag);
    if (!put.ok) return refuse("MEMORY_STALE", "MEMORY.md changed during the edit; read it again");
    this.reindexFile("MEMORY.md", text);
    return { ok: true as const, sha256: put.sha256, lines: lines.length, citations: written.sort((a, b) => a - b).map((w) => citation("MEMORY.md", w + 1)) };
  }

  /** Pages through a home file; daily notes are rendered first, so the page is what R2 holds. */
  async get(input: { path: string; from?: number; limit?: number }, requester: string) {
    if (requester !== this.owner) return refuse("MEMORY_NOT_OWNER", "memory files are read by their owner only");
    const parsed = parseHomePath(input.path);
    if (!parsed) return refuse("MEMORY_PATH_INVALID", `${input.path} is not a path in the home tree`);
    if (parsed.kind === "standing") await this.standingFiles();
    if (parsed.kind === "daily" && this.pendingDates().includes(parsed.date)) await this.renderDate(parsed.date);
    const obj = await this.home.read(input.path);
    if (!obj) return refuse("MEMORY_NOT_FOUND", `${input.path} does not exist`);
    const all = obj.text.replace(/\n$/, "").split("\n");
    const from = Math.max(input.from ?? 1, 1);
    const limit = Math.min(Math.max(input.limit ?? 60, 1), 200);
    const lines = all.slice(from - 1, from - 1 + limit).map((text, i) => ({ n: from + i, text }));
    const next = from - 1 + limit < all.length ? from + limit : null;
    return { ok: true as const, path: input.path, sha256: obj.sha256, writer: obj.writer, updatedAt: obj.updatedAt, total: all.length, lines, next };
  }

  /**
   * A daily note as a turn with other readers sees it (a colleague's request, M10.1): only the lines
   * every reader may see, at their own line numbers, so a citation the gate passed resolves and
   * nothing beside it is shown. Standing files and pages are the owner's alone.
   */
  async sharedDaily(input: { path: string; from?: number; limit?: number }, readers: readonly string[]) {
    const parsed = parseHomePath(input.path);
    if (parsed?.kind !== "daily") return refuse("MEMORY_NOT_OWNER", "only the shared-setting lines of a daily note are shown beyond its owner");
    const from = Math.max(input.from ?? 1, 1);
    const limit = Math.min(Math.max(input.limit ?? 60, 1), 200);
    const rows = this.rows<{ line: number; text: string; audience: string | null }>("SELECT line, text, audience FROM daily_lines WHERE date = ? AND line >= ? AND line < ? ORDER BY line", parsed.date, from, from + limit);
    const lines = rows.filter((r) => this.visible(r.audience, readers)).map((r) => ({ n: r.line, text: `- ${r.text}` }));
    if (!lines.length) return refuse("MEMORY_NOT_FOUND", `nothing in ${input.path} at those lines is shared with everyone this turn answers`);
    const sha256 = await sha256Hex(lines.map((l) => l.text).join("\n"));
    return { ok: true as const, path: input.path, scope: "personal", sha256, writer: "qyvr:render", total: lines.length, lines, next: null };
  }

  /** Where a daily line was written (`chat:<id>`, a job, a mail), for the owner alone; null for any other path (M23.5). */
  lineSource(input: { citation: string }, requester: string) {
    if (requester !== this.owner) return refuse("MEMORY_NOT_OWNER", "where a line came from is shown to the owner only");
    const at = parseCitation(input.citation);
    if (!at) return refuse("MEMORY_CITATION_INVALID", `${input.citation} is not a citation`);
    const date = parseHomePath(at.path);
    const row = date?.kind === "daily" ? this.rows<{ source: string }>("SELECT source FROM daily_lines WHERE date = ? AND line = ?", date.date, at.line)[0] : undefined;
    return { ok: true as const, source: row?.source ?? null };
  }

  /** A claim's provenance: its source line, setting, writer and supersession chain both ways. */
  explain(input: { claimId?: string; citation?: string }, requester: string) {
    if (requester !== this.owner) return refuse("MEMORY_NOT_OWNER", "provenance is shown to the owner only");
    this.expireDue();
    let claim: ClaimRow | undefined;
    if (input.claimId) claim = this.rows<ClaimRow>("SELECT * FROM claims WHERE id = ?", input.claimId)[0];
    else if (input.citation) {
      const at = parseCitation(input.citation);
      if (!at) return refuse("MEMORY_CITATION_INVALID", `${input.citation} is not a citation`);
      claim = this.rows<ClaimRow>("SELECT * FROM claims WHERE source_path = ? AND source_line = ? ORDER BY created_at DESC", at.path, at.line)[0];
    } else return refuse("MEMORY_EXPLAIN_TARGET", "give a claim id or a citation");
    if (!claim) return refuse("MEMORY_CLAIM_UNKNOWN", "no claim at that id or citation");
    const date = parseHomePath(claim.source_path);
    const line =
      date?.kind === "daily"
        ? this.rows<{ text: string; writer: string; source: string }>("SELECT text, writer, source FROM daily_lines WHERE date = ? AND line = ?", date.date, claim.source_line)[0]
        : undefined;
    const earlier: string[] = [];
    for (let at = claim.supersedes; at; ) {
      earlier.push(at);
      at = this.rows<{ supersedes: string | null }>("SELECT supersedes FROM claims WHERE id = ?", at)[0]?.supersedes ?? null;
    }
    const later: string[] = [];
    for (let at = this.successor(claim.id); at; at = this.successor(at)) later.push(at);
    return {
      ok: true as const,
      claim: { id: claim.id, kind: claim.kind, salience: claim.salience, confidence: claim.confidence, speaker: claim.speaker, status: claim.status, quote: claim.quote, validUntil: claim.valid_until ?? null },
      citation: citation(claim.source_path, claim.source_line),
      sourceText: line?.text ?? null,
      writer: line?.writer ?? null,
      learnedIn: { scope: claim.scope, source: claim.source, audience: audienceOf(claim.audience) },
      supersedes: earlier,
      supersededBy: later,
    };
  }
}
