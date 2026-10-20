// Company and team memory (memory-and-learning.md "Scopes", AD-23) in the `Company` object's SQLite:
// dated lines with their scope, writer and source, an FTS5 index beside them, and each day rendered
// under the company prefix in the tenant bucket. This is the owning store of both scopes: every read
// asks the disclosure gate for each reader of the turn, and every write is checked against the write
// rules here (company scope by an admin in person; team scope by a member of the team, in person or
// through their own agent). Nothing moves here from personal scope; promotion is M11's.
import { dayOf, oneLine, sha256Hex } from "./home.ts";
import { disclosesToAll, type Reader, teamOf, teamScope } from "./disclosure.ts";
import { enqueueVector, fuse, type SemanticDegraded, type SemanticLeg, VECTOR_QUEUE_SCHEMA } from "./semantic.ts";
import { FIRST_ENTRY_LINE, MAX_LINE_CHARS, maxOf, type Refusal, refuse, type SearchHit } from "./store.ts";

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS scope_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT, scope TEXT NOT NULL, date TEXT NOT NULL, line INTEGER NOT NULL,
  text TEXT NOT NULL, writer TEXT NOT NULL, source TEXT NOT NULL, at INTEGER NOT NULL, UNIQUE (scope, date, line)
);
CREATE VIRTUAL TABLE IF NOT EXISTS scope_fts USING fts5(text, tokenize = 'porter unicode61');
CREATE TABLE IF NOT EXISTS scope_claims (
  id TEXT PRIMARY KEY, scope TEXT NOT NULL, text TEXT NOT NULL, source_path TEXT NOT NULL, source_line INTEGER NOT NULL,
  supersedes TEXT, status TEXT NOT NULL, writer TEXT NOT NULL, at INTEGER NOT NULL
);
${VECTOR_QUEUE_SCHEMA}`;

/** A consolidated claim of the company upkeep loop (M12): one line of company scope it cites. */
export type ScopeClaim = { id: string; scope: string; text: string; citation: string; supersedes: string | null; status: "active" | "superseded" };
/** A company-scope line as the upkeep loop reads it, after its watermark. */
export type ScopeLine = { id: number; citation: string; text: string };

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** `company/memory/<date>.md` or `teams/<team>/memory/<date>.md`: the path a citation names. */
export function scopePath(scope: string, date: string): string {
  const team = teamOf(scope);
  return team ? `teams/${team}/memory/${date}.md` : `company/memory/${date}.md`;
}

export function parseScopePath(path: string): { scope: string; date: string } | null {
  const company = /^company\/memory\/(\d{4}-\d{2}-\d{2})\.md$/.exec(path);
  if (company?.[1] && DATE.test(company[1])) return { scope: "company", date: company[1] };
  const team = /^teams\/([^/]+)\/memory\/(\d{4}-\d{2}-\d{2})\.md$/.exec(path);
  if (team?.[1] && team[2] && teamOf(teamScope(team[1]))) return { scope: teamScope(team[1]), date: team[2] };
  return null;
}

/** Whether a path or citation names the company store rather than a person's home. */
export const isScopePath = (path: string) => path.startsWith("company/") || path.startsWith("teams/");

export interface ScopeWrite {
  scope: string;
  text: string;
  /** `person:<email>` for a human in the app, `agent:<email>` for a person's agent. */
  writer: string;
  source: string;
  timeZone?: string;
}

export interface CompanyMemoryApi {
  search(input: { queries: string[]; maxResults?: number }, readers: string[]): Promise<{ ok: true; hits: SearchHit[]; semantic?: SemanticDegraded } | Refusal>;
  get(input: { path: string; from?: number; limit?: number }, readers: string[]): Promise<CompanyGet | Refusal>;
  append(by: string, input: ScopeWrite): Promise<{ ok: true; path: string; line: number; citation: string } | Refusal>;
}

/** A page of one day; `sha256` is of the whole rendered day, as R2 holds it. */
export type CompanyGet = { ok: true; path: string; scope: string; sha256: string; writer: string; total: number; lines: Array<{ n: number; text: string }>; next: number | null };

type LineRow = { id: number; scope: string; date: string; line: number; text: string; score: number };

export class CompanyMemory {
  private readonly storage: Pick<DurableObjectStorage, "sql" | "transactionSync">;
  private readonly reader: (email: string) => Reader;
  private readonly isAdmin: (email: string) => boolean;
  private readonly bucket: R2Bucket | undefined;
  private readonly now: () => number;
  /** The semantic half of search (M12.2), in the tenant index under the company's namespace. */
  private readonly leg: ((sql: () => SqlStorage) => SemanticLeg | undefined) | undefined;
  private legInstance?: SemanticLeg;

  constructor(
    storage: Pick<DurableObjectStorage, "sql" | "transactionSync">,
    deps: { reader: (email: string) => Reader; isAdmin: (email: string) => boolean; bucket?: R2Bucket; now: () => number; semantic?: (sql: () => SqlStorage) => SemanticLeg | undefined },
  ) {
    this.storage = storage;
    this.reader = deps.reader;
    this.isAdmin = deps.isAdmin;
    this.bucket = deps.bucket;
    this.now = deps.now;
    this.leg = deps.semantic;
  }

  get semantic(): SemanticLeg | undefined {
    if (this.leg) this.legInstance ??= this.leg(() => this.sql);
    return this.legInstance;
  }

  /** Sends queued lines to the index; a failure leaves them queued for the next write's sync. */
  async syncVectors() {
    return this.semantic ? this.semantic.sync((ids) => this.lineTexts(ids)) : { ok: true as const, upserted: 0, deleted: 0 };
  }

  private lineTexts(ids: readonly number[]): Map<number, string> {
    if (!ids.length) return new Map();
    return new Map(this.sql.exec<{ id: number; text: string }>(`SELECT id, text FROM scope_lines WHERE id IN (${ids.map(() => "?").join(", ")})`, ...ids).toArray().map((r) => [r.id, r.text]));
  }

  private get sql(): SqlStorage {
    return this.storage.sql;
  }

  private readers(emails: string[]): Reader[] {
    return [...new Set(emails)].map((e) => this.reader(e));
  }

  /** The write rules, decided here: company scope by an admin in person; a team's scope by its members. */
  async append(by: string, input: ScopeWrite): Promise<{ ok: true; path: string; line: number; citation: string } | Refusal> {
    const who = this.reader(by);
    if (!who.member) return refuse("NOT_A_MEMBER", "only a member writes company or team memory");
    if (input.writer !== `person:${by}` && input.writer !== `agent:${by}`) return refuse("SCOPE_WRITER_INVALID", "a write names its own author");
    const team = teamOf(input.scope);
    if (input.scope === "company") {
      if (!this.isAdmin(by)) return refuse("COMPANY_SCOPE_ADMIN_ONLY", "company memory is written by an admin");
      if (!input.writer.startsWith("person:")) return refuse("COMPANY_SCOPE_ADMIN_ONLY", "company memory is written by an admin in person, not through an agent");
    } else if (team) {
      if (!who.teams.includes(team)) return refuse("TEAM_SCOPE_MEMBERS_ONLY", `only a member of team ${team} writes its memory`);
    } else return refuse("SCOPE_INVALID", "scope is company or team:<id>");
    return this.insert(input);
  }

  /**
   * A promotion a human merged (M11): the merge key's holder was checked by the ladder, so the write
   * rules above do not apply; the writer is `promotion:<id>` and nothing else may use this path.
   */
  async appendMerged(input: ScopeWrite): Promise<{ ok: true; path: string; line: number; citation: string } | Refusal> {
    if (!input.writer.startsWith("promotion:")) return refuse("SCOPE_WRITER_INVALID", "only a merged promotion writes here");
    if (input.scope !== "company" && !teamOf(input.scope)) return refuse("SCOPE_INVALID", "scope is company or team:<id>");
    return this.insert(input);
  }

  /**
   * A line of the onboarding study an admin reviewed and accepted in person (M11.2): the review was
   * checked by the `Company`'s onboarding, so only company scope and only writer `onboarding:study`.
   */
  async appendStudied(input: ScopeWrite): Promise<{ ok: true; path: string; line: number; citation: string } | Refusal> {
    if (input.writer !== "onboarding:study") return refuse("SCOPE_WRITER_INVALID", "only the reviewed onboarding study writes here");
    if (input.scope !== "company") return refuse("SCOPE_INVALID", "the onboarding study writes company scope only");
    return this.insert(input);
  }

  private async insert(input: ScopeWrite): Promise<{ ok: true; path: string; line: number; citation: string } | Refusal> {
    const text = oneLine(input.text);
    if (!text) return refuse("MEMORY_EMPTY", "the line is empty");
    if (text.length > MAX_LINE_CHARS) return refuse("MEMORY_TOO_LONG", `a line holds at most ${MAX_LINE_CHARS} characters`);
    const at = this.now();
    const date = dayOf(at, input.timeZone);
    const line = this.storage.transactionSync(() => {
      const n = this.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM scope_lines WHERE scope = ? AND date = ?", input.scope, date).one()?.n ?? 0;
      const id = this.sql
        .exec<{ id: number }>("INSERT INTO scope_lines (scope, date, line, text, writer, source, at) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id", input.scope, date, FIRST_ENTRY_LINE + n, text, input.writer, input.source, at)
        .one()?.id;
      this.sql.exec("INSERT INTO scope_fts (rowid, text) VALUES (?, ?)", id ?? null, text);
      if (id !== undefined) enqueueVector(this.sql, id, "upsert");
      return FIRST_ENTRY_LINE + n;
    });
    const path = scopePath(input.scope, date);
    await this.render(input.scope, date);
    // The line is saved and keyword-searchable whatever the index says; a failed sync stays queued.
    await this.syncVectors();
    return { ok: true, path, line, citation: `${path}#L${line}` };
  }

  /** Two or three phrasings over company and team lines by keyword, filtered to what every reader may see. */
  search(input: { queries: string[]; maxResults?: number }, readers: string[]): { ok: true; hits: SearchHit[] } {
    return { ok: true, hits: this.ranked(input, readers).slice(0, maxOf(input)).map((r) => this.hit(r)) };
  }

  /**
   * Keyword and semantic search fused (M12.2): the leg proposes line ids of this store, which are
   * resolved here and pass the same disclosure gate as keyword hits; a failed semantic half returns
   * the keyword hits with the reason.
   */
  async searchHybrid(input: { queries: string[]; maxResults?: number }, readers: string[]): Promise<{ ok: true; hits: SearchHit[]; semantic?: SemanticDegraded }> {
    const ranked = this.ranked(input, readers);
    const max = maxOf(input);
    const queries = input.queries.map((q) => q.trim()).filter(Boolean);
    // An empty store makes no embedding call: there is nothing the semantic half could find.
    const empty = !this.sql.exec("SELECT id FROM scope_lines LIMIT 1").toArray().length;
    if (!this.semantic || !queries.length || empty) return { ok: true, hits: ranked.slice(0, max).map((r) => this.hit(r)) };
    const near = await this.semantic.recall(queries);
    if (!near.ok) return { ok: true, hits: ranked.slice(0, max).map((r) => ({ ...this.hit(r), match: "keyword" as const })), semantic: { code: near.code, reason: near.reason } };
    const who = this.readers(readers);
    const rows = new Map(ranked.map((r) => [r.id, r]));
    const missing = near.ids.filter((id) => !rows.has(id));
    if (missing.length) {
      const found = this.sql.exec<LineRow>(`SELECT id, scope, date, line, text, 0 AS score FROM scope_lines WHERE id IN (${missing.map(() => "?").join(", ")})`, ...missing).toArray();
      for (const r of found) if (disclosesToAll({ scope: r.scope }, who)) rows.set(r.id, r);
    }
    const fused = fuse(ranked.map((r) => r.id), near.ids.filter((id) => rows.has(id)));
    return { ok: true, hits: fused.slice(0, max).map((f) => ({ ...this.hit(rows.get(f.id) as LineRow), match: f.match })) };
  }

  private ranked(input: { queries: string[] }, readers: string[]): LineRow[] {
    const who = this.readers(readers);
    const best = new Map<number, LineRow>();
    for (const q of input.queries) {
      const terms = [...new Set(q.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])].filter((t) => t.length > 1).slice(0, 16);
      if (!terms.length) continue;
      const rows = this.sql
        .exec<LineRow>(
          `SELECT l.id, l.scope, l.date, l.line, l.text, bm25(scope_fts) AS score
           FROM scope_fts JOIN scope_lines l ON l.id = scope_fts.rowid WHERE scope_fts MATCH ? ORDER BY score LIMIT 100`,
          terms.map((t) => `"${t}"`).join(" OR "),
        )
        .toArray();
      for (const r of rows) if (!best.has(r.id) || (best.get(r.id)?.score ?? 0) > r.score) best.set(r.id, r);
    }
    return [...best.values()].filter((r) => disclosesToAll({ scope: r.scope }, who)).sort((a, b) => a.score - b.score || a.id - b.id);
  }

  private hit(r: LineRow): SearchHit {
    const path = scopePath(r.scope, r.date);
    const claims = this.sql
      .exec<{ id: string; status: string; supersedes: string | null }>("SELECT id, status, supersedes FROM scope_claims WHERE source_path = ? AND source_line = ? ORDER BY at, id", path, r.line)
      .toArray()
      .map((c) => ({ id: c.id, kind: "fact", status: c.status, supersedes: c.supersedes, supersededBy: this.sql.exec<{ id: string }>("SELECT id FROM scope_claims WHERE supersedes = ?", c.id).toArray()[0]?.id ?? null, validUntil: null }));
    return { citation: `${path}#L${r.line}`, uri: `memory://md:${path}:${r.line}`, path, line: r.line, text: r.text, scope: r.scope, audience: null, claims };
  }

  /** Pages through one day of a scope, for readers who may all see that scope. */
  async get(input: { path: string; from?: number; limit?: number }, readers: string[]): Promise<CompanyGet | Refusal> {
    const at = parseScopePath(input.path);
    if (!at) return refuse("MEMORY_PATH_INVALID", `${input.path} is not a company or team memory path`);
    if (!disclosesToAll({ scope: at.scope }, this.readers(readers))) return refuse("MEMORY_SCOPE_UNREADABLE", `${at.scope} memory is not readable by everyone this turn answers`);
    const all = this.dayText(at.scope, at.date);
    if (!all) return refuse("MEMORY_NOT_FOUND", `${input.path} does not exist`);
    const from = Math.max(input.from ?? 1, 1);
    const limit = Math.min(Math.max(input.limit ?? 60, 1), 200);
    const lines = all.slice(from - 1, from - 1 + limit).map((text, i) => ({ n: from + i, text }));
    const sha256 = await sha256Hex(`${all.join("\n")}\n`);
    return { ok: true, path: input.path, scope: at.scope, sha256, writer: "qyvr:render", total: all.length, lines, next: from - 1 + limit < all.length ? from + limit : null };
  }

  /** Company-scope lines after `afterId`, oldest first; team lines are never read here (M12). */
  companyLinesAfter(afterId: number, limit: number): ScopeLine[] {
    return this.sql
      .exec<{ id: number; date: string; line: number; text: string }>("SELECT id, date, line, text FROM scope_lines WHERE scope = 'company' AND id > ? ORDER BY id LIMIT ?", afterId, limit)
      .toArray()
      .map((r) => ({ id: r.id, citation: `${scopePath("company", r.date)}#L${r.line}`, text: r.text }));
  }

  /** The company's consolidated claims, newest first. */
  companyClaims(status?: "active" | "superseded", limit = 50): ScopeClaim[] {
    type Row = { id: string; scope: string; text: string; source_path: string; source_line: number; supersedes: string | null; status: "active" | "superseded" };
    return this.sql
      .exec<Row>(`SELECT * FROM scope_claims WHERE scope = 'company' ${status ? "AND status = ?" : ""} ORDER BY at DESC, id LIMIT ?`, ...(status ? [status, limit] : [limit]))
      .toArray()
      .map((r) => ({ id: r.id, scope: r.scope, text: r.text, citation: `${r.source_path}#L${r.source_line}`, supersedes: r.supersedes, status: r.status }));
  }

  /**
   * A claim the company upkeep loop consolidated: company scope only, citing a company-scope line, and
   * superseding only an active company claim. The loop decided the rest; this store holds the rules.
   */
  addCompanyClaim(input: { text: string; cite: string; supersedes: string | null; writer: string }): { ok: true; id: string } | Refusal {
    if (!input.writer.startsWith("loop:")) return refuse("SCOPE_WRITER_INVALID", "only the company upkeep loop consolidates claims");
    const at = /^(.+)#L(\d+)$/.exec(input.cite);
    const parsed = at?.[1] ? parseScopePath(at[1]) : null;
    if (!at || parsed?.scope !== "company") return refuse("LOOP_CITATION_UNRESOLVED", "a company claim cites a company-scope line");
    if (!this.sql.exec("SELECT id FROM scope_lines WHERE scope = 'company' AND date = ? AND line = ?", parsed.date, Number(at[2])).toArray().length) return refuse("LOOP_CITATION_UNRESOLVED", `${input.cite} is not a line of company memory`);
    if (input.supersedes && !this.sql.exec("SELECT id FROM scope_claims WHERE id = ? AND scope = 'company' AND status = 'active'", input.supersedes).toArray().length) return refuse("LOOP_SUPERSEDES_UNKNOWN", `no active company claim ${input.supersedes}`);
    const id = `cc_${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
    this.storage.transactionSync(() => {
      this.sql.exec("INSERT INTO scope_claims (id, scope, text, source_path, source_line, supersedes, status, writer, at) VALUES (?, 'company', ?, ?, ?, ?, 'active', ?, ?)", id, oneLine(input.text), at[1] as string, Number(at[2]), input.supersedes, input.writer, this.now());
      if (input.supersedes) this.sql.exec("UPDATE scope_claims SET status = 'superseded' WHERE id = ?", input.supersedes);
    });
    return { ok: true, id };
  }

  /** Every company-scope day as rendered, oldest first: what the workspace mirror copies (M10.2). Team days are never listed. */
  companyDays(): Array<{ path: string; text: string }> {
    const dates = this.sql.exec<{ date: string }>("SELECT DISTINCT date FROM scope_lines WHERE scope = 'company' ORDER BY date").toArray();
    return dates.map(({ date }) => ({ path: scopePath("company", date), text: `${(this.dayText("company", date) ?? []).join("\n")}\n` }));
  }

  /** A day as its rendered lines: a heading, a blank line, then one `- ` line per entry, so line n is row n. */
  private dayText(scope: string, date: string): string[] | null {
    const rows = this.sql.exec<{ text: string }>("SELECT text FROM scope_lines WHERE scope = ? AND date = ? ORDER BY line", scope, date).toArray();
    return rows.length ? [`# ${date}`, "", ...rows.map((r) => `- ${r.text}`)] : null;
  }

  private async render(scope: string, date: string): Promise<void> {
    const lines = this.dayText(scope, date);
    if (!this.bucket || !lines) return;
    const path = scopePath(scope, date);
    await this.bucket.put(path.startsWith("company/") ? path : `company/${path}`, `${lines.join("\n")}\n`, { customMetadata: { writer: "qyvr:render", scope } });
  }
}
