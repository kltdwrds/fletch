// The parent chat's record of its sub-agents (M7.2), in the `Chat` object's SQLite: one row per
// sub-agent with its parent, role and depth, so every spawn is decided from what the parent stored,
// and its brief, status and result, so a status answer reads observed state. A delegation is the
// group of sub-agents one main-agent call started; its handoff enters the chat once, when all of
// them have settled.
import type { ParentRole, SubAgentRole } from "./depth.ts";

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS subagents (
  id TEXT PRIMARY KEY,
  grp TEXT NOT NULL,
  turn_id TEXT NOT NULL,
  parent TEXT NOT NULL,
  role TEXT NOT NULL,
  depth INTEGER NOT NULL,
  person TEXT NOT NULL,
  brief TEXT NOT NULL,
  status TEXT NOT NULL,
  rounds INTEGER NOT NULL DEFAULT 0,
  result TEXT,
  code TEXT,
  verdict TEXT,
  verdict_reason TEXT,
  refusals TEXT NOT NULL DEFAULT '[]',
  tokens INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS subagent_groups (
  grp TEXT PRIMARY KEY,
  turn_id TEXT NOT NULL,
  person TEXT NOT NULL,
  handed_off_at INTEGER
);`;

/** queued: ready to run; running: in its facet now; waiting: a coordinator waiting on its workers. */
export type SubAgentStatus = "queued" | "running" | "waiting" | "done" | "failed";
export type Verdict = "pass" | "fail" | "unverified";

export interface SubAgentRow {
  id: string;
  grp: string;
  turnId: string;
  parent: string;
  role: SubAgentRole;
  depth: number;
  person: string;
  brief: string;
  status: SubAgentStatus;
  rounds: number;
  result: string | null;
  code: string | null;
  verdict: Verdict | null;
  verdictReason: string | null;
  refusals: string[];
  tokens: number;
  createdAt: number;
}

type Sql = Pick<DurableObjectStorage, "sql" | "transactionSync">;

const rowOf = (r: Record<string, unknown>): SubAgentRow => ({
  id: String(r.id),
  grp: String(r.grp),
  turnId: String(r.turn_id),
  parent: String(r.parent),
  role: r.role as SubAgentRole,
  depth: Number(r.depth),
  person: String(r.person),
  brief: String(r.brief),
  status: r.status as SubAgentStatus,
  rounds: Number(r.rounds),
  result: (r.result as string | null) ?? null,
  code: (r.code as string | null) ?? null,
  verdict: (r.verdict as Verdict | null) ?? null,
  verdictReason: (r.verdict_reason as string | null) ?? null,
  refusals: JSON.parse(String(r.refusals)) as string[],
  tokens: Number(r.tokens),
  createdAt: Number(r.created_at),
});

export class SubAgentStore {
  private readonly storage: Sql;

  constructor(storage: Sql) {
    this.storage = storage;
  }

  transaction<T>(fn: () => T): T {
    return this.storage.transactionSync(fn);
  }

  get(id: string): SubAgentRow | undefined {
    const r = this.storage.sql.exec("SELECT * FROM subagents WHERE id = ?", id).toArray()[0];
    return r ? rowOf(r) : undefined;
  }

  /** The parent's record a spawn is decided from: the main agent, or a stored sub-agent. */
  parentOf(id: string): { role: ParentRole; depth: number } | undefined {
    if (id === "main") return { role: "main", depth: 0 };
    const row = this.get(id);
    return row ? { role: row.role, depth: row.depth } : undefined;
  }

  list(): SubAgentRow[] {
    return this.storage.sql.exec("SELECT * FROM subagents ORDER BY created_at, id").toArray().map(rowOf);
  }

  children(parent: string): SubAgentRow[] {
    return this.storage.sql.exec("SELECT * FROM subagents WHERE parent = ? ORDER BY created_at, id", parent).toArray().map(rowOf);
  }

  group(grp: string): SubAgentRow[] {
    return this.storage.sql.exec("SELECT * FROM subagents WHERE grp = ? ORDER BY created_at, id", grp).toArray().map(rowOf);
  }

  open(): number {
    return Number(this.storage.sql.exec("SELECT count(*) AS n FROM subagents WHERE status IN ('queued', 'running', 'waiting')").one()?.n ?? 0);
  }

  /** The next sub-agent to run: a running one first (its run was cut off), then the oldest queued. */
  next(): SubAgentRow | undefined {
    const r = this.storage.sql.exec("SELECT * FROM subagents WHERE status IN ('running', 'queued') ORDER BY status = 'running' DESC, created_at, id LIMIT 1").toArray()[0];
    return r ? rowOf(r) : undefined;
  }

  hasGroup(grp: string): boolean {
    return this.storage.sql.exec("SELECT grp FROM subagent_groups WHERE grp = ?", grp).toArray().length > 0;
  }

  addGroup(grp: string, turnId: string, person: string): void {
    this.storage.sql.exec("INSERT OR IGNORE INTO subagent_groups (grp, turn_id, person) VALUES (?, ?, ?)", grp, turnId, person);
  }

  /** Groups whose sub-agents have all settled and whose handoff has not entered the chat. */
  settledGroups(): Array<{ grp: string; turnId: string; person: string }> {
    return this.storage.sql
      .exec(
        `SELECT g.grp, g.turn_id, g.person FROM subagent_groups g WHERE g.handed_off_at IS NULL
         AND NOT EXISTS (SELECT 1 FROM subagents s WHERE s.grp = g.grp AND s.status NOT IN ('done', 'failed'))
         AND EXISTS (SELECT 1 FROM subagents s WHERE s.grp = g.grp) ORDER BY g.grp`,
      )
      .toArray()
      .map((r) => ({ grp: String(r.grp), turnId: String(r.turn_id), person: String(r.person) }));
  }

  handedOffAt(grp: string): number | null {
    const r = this.storage.sql.exec("SELECT handed_off_at FROM subagent_groups WHERE grp = ?", grp).toArray()[0];
    return r && r.handed_off_at !== null ? Number(r.handed_off_at) : null;
  }

  markHandedOff(grp: string, at: number): void {
    this.storage.sql.exec("UPDATE subagent_groups SET handed_off_at = ? WHERE grp = ?", at, grp);
  }

  insert(row: { id: string; grp: string; turnId: string; parent: string; role: string; depth: number; person: string; brief: string }, at: number): void {
    this.storage.sql.exec(
      "INSERT OR IGNORE INTO subagents (id, grp, turn_id, parent, role, depth, person, brief, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?)",
      row.id, row.grp, row.turnId, row.parent, row.role, row.depth, row.person, row.brief, at, at,
    );
  }

  setStatus(id: string, status: SubAgentStatus, at: number, extra: { result?: string; code?: string | null; tokens?: number; rounds?: number } = {}): void {
    const row = this.get(id);
    if (!row) return;
    this.storage.sql.exec(
      "UPDATE subagents SET status = ?, result = ?, code = ?, tokens = ?, rounds = ?, updated_at = ? WHERE id = ?",
      status, extra.result ?? row.result, extra.code === undefined ? row.code : extra.code, row.tokens + (extra.tokens ?? 0), extra.rounds ?? row.rounds, at, id,
    );
  }

  setVerdict(id: string, verdict: Verdict, reason: string): void {
    this.storage.sql.exec("UPDATE subagents SET verdict = ?, verdict_reason = ? WHERE id = ?", verdict, reason, id);
  }

  addRefusal(id: string, code: string): void {
    const row = this.get(id);
    if (row) this.storage.sql.exec("UPDATE subagents SET refusals = ? WHERE id = ?", JSON.stringify([...row.refusals, code]), id);
  }
}
