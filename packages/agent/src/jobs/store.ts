// The `Job` object's SQLite (AD-1, AD-10): the job, its runs, each run's steps and the delivery
// outbox. A run is keyed on (job_id, scheduled_for) and a step on (run_id, step), so creating either
// twice is a no-op; the outbox is unique on the content hash, so the same message is queued once.
import type { RunPhase, RunRow, RunSignal } from "../ledger/types.ts";
import type { JobDefinition } from "./body.ts";
import type { GateState, Observation } from "./gates.ts";
import type { CallRecord } from "./silence.ts";
import { JOB_MIGRATIONS } from "../migrations/catalog.ts";
import { migrate } from "../migrations/engine.ts";


/**
 * `needs_enable`: registered by an agent, off until the owner enables it (cloudflare-os semantics).
 * `archived`: removed by its owner (M25.6); the runs stay for the Ledger and nothing else is kept alive.
 */
export type JobStatus = "active" | "needs_enable" | "disabled" | "blocked" | "needs_attention" | "finished" | "archived";

/** A definition the job had before a change in place (delta 7): kept on the record, in the same JSON column as the definition. */
export interface PastDefinition {
  /** When it stopped being the job's definition. */
  until: number;
  by: string;
  def: JobDefinition;
}

/** Earlier definitions kept per job; the oldest leave first. */
export const HISTORY_KEPT = 20;

export interface JobRow {
  id: string;
  owner: string;
  def: JobDefinition;
  /** The definitions it had before each change in place, oldest first. */
  history: PastDefinition[];
  sourcePath: string | null;
  sourceHash: string | null;
  status: JobStatus;
  statusCode: string | null;
  statusReason: string | null;
  gateState: GateState;
  lastSlot: number | null;
  failures: number;
  backoffUntil: number | null;
  nextProbe: number | null;
  skipped: number;
  ticks: number;
}

export interface JobRun {
  runId: string;
  jobId: string;
  scheduledFor: number;
  manual: boolean;
  phase: RunPhase;
  attempt: number;
  step: number;
  leaseUntil: number | null;
  timeoutAt: number | null;
  retryAt: number | null;
  observed: Observation;
  signal: RunSignal | null;
  code: string | null;
  reason: string | null;
  nextProbe: number | null;
  ledgerSynced: boolean;
  startedAt: number;
  updatedAt: number;
}

export type StepState = "running" | "waiting" | "done" | "failed";
export interface StepRow {
  runId: string;
  step: number;
  kind: string;
  state: StepState;
  output: string | null;
  attempts: number;
  decidedBy: string | null;
}

/** One tool call a model step made (M25.2): kept with the step, for the owner's view of the run. */
export interface ToolCallRow {
  runId: string;
  step: number;
  callId: string;
  tool: string;
  ok: boolean;
  code: string | null;
}

export type OutboxState = "pending" | "delivering" | "delivered" | "failed";
export interface OutboxRow {
  id: string;
  runId: string | null;
  chat: string;
  contentHash: string;
  text: string;
  state: OutboxState;
  attempts: number;
  nextAttempt: number;
  lastCode: string | null;
}

type Sql = Pick<SqlStorage, "exec">;
type Raw = Record<string, SqlStorageValue>;

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

export class JobStore {
  private readonly storage: Pick<DurableObjectStorage, "sql" | "transactionSync">;

  constructor(storage: Pick<DurableObjectStorage, "sql" | "transactionSync">) {
    this.storage = storage;
    migrate(storage, JOB_MIGRATIONS);
  }

  private get sql(): Sql {
    return this.storage.sql;
  }

  transaction<T>(fn: () => T): T {
    void this.sql;
    return this.storage.transactionSync(fn);
  }

  job(): JobRow | null {
    const r = this.sql.exec<Raw>("SELECT * FROM job WHERE k = 1").toArray()[0];
    if (!r) return null;
    const { history, ...def } = JSON.parse(String(r.def)) as JobDefinition & { history?: PastDefinition[] };
    return {
      id: String(r.id), owner: String(r.owner), def, history: history ?? [],
      sourcePath: (r.source_path as string | null) ?? null, sourceHash: (r.source_hash as string | null) ?? null,
      status: r.status as JobStatus, statusCode: (r.status_code as string | null) ?? null, statusReason: (r.status_reason as string | null) ?? null,
      gateState: JSON.parse(String(r.gate_state)) as GateState, lastSlot: num(r.last_slot), failures: Number(r.failures),
      backoffUntil: num(r.backoff_until), nextProbe: num(r.next_probe), skipped: Number(r.skipped), ticks: Number(r.ticks),
    };
  }

  /** Writes the job; its earlier definitions ride in the definition's JSON under `history`, so no column is added. */
  putJob(j: { id: string; owner: string; def: JobDefinition; history: PastDefinition[]; sourcePath: string | null; sourceHash: string | null; status: JobStatus }, now: number): void {
    this.sql.exec(
      `INSERT INTO job (k, id, owner, def, source_path, source_hash, status, updated_at) VALUES (1, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(k) DO UPDATE SET def = excluded.def, source_path = excluded.source_path, source_hash = excluded.source_hash, status = excluded.status, status_code = NULL, status_reason = NULL, updated_at = excluded.updated_at`,
      j.id, j.owner, JSON.stringify(j.history.length ? { ...j.def, history: j.history.slice(-HISTORY_KEPT) } : j.def), j.sourcePath, j.sourceHash, j.status, now,
    );
  }

  /** Updates named job columns; keys are this module's own column names, never input. */
  updateJob(fields: Partial<Record<"status" | "status_code" | "status_reason" | "gate_state" | "last_slot" | "failures" | "backoff_until" | "next_probe" | "skipped" | "ticks" | "source_hash", string | number | null>>, now: number): void {
    const keys = Object.keys(fields);
    if (!keys.length) return;
    this.sql.exec(`UPDATE job SET ${keys.map((k) => `${k} = ?`).join(", ")}, updated_at = ? WHERE k = 1`, ...keys.map((k) => fields[k as keyof typeof fields] ?? null), now);
  }

  /** Creates the run for a slot once; a second call for the same slot changes nothing. */
  createRun(r: { runId: string; jobId: string; scheduledFor: number; manual: boolean; observed: Observation }, now: number): boolean {
    const before = this.run(r.runId);
    this.sql.exec(
      "INSERT OR IGNORE INTO runs (run_id, job_id, scheduled_for, manual, phase, observed, started_at, updated_at) VALUES (?, ?, ?, ?, 'executing', ?, ?, ?)",
      r.runId, r.jobId, r.scheduledFor, r.manual ? 1 : 0, JSON.stringify(r.observed), now, now,
    );
    return !before;
  }

  updateRun(runId: string, fields: Partial<Record<"phase" | "attempt" | "step" | "lease_until" | "timeout_at" | "retry_at" | "signal" | "code" | "reason" | "next_probe" | "ledger_synced", string | number | null>>, now: number): void {
    const keys = Object.keys(fields);
    this.sql.exec(`UPDATE runs SET ${keys.map((k) => `${k} = ?`).join(", ")}, updated_at = ? WHERE run_id = ?`, ...keys.map((k) => fields[k as keyof typeof fields] ?? null), now, runId);
  }

  run(runId: string): JobRun | null {
    const r = this.sql.exec<Raw>("SELECT * FROM runs WHERE run_id = ?", runId).toArray()[0];
    return r ? toRun(r) : null;
  }

  activeRun(): JobRun | null {
    const r = this.sql.exec<Raw>("SELECT * FROM runs WHERE phase != 'done' ORDER BY started_at LIMIT 1").toArray()[0];
    return r ? toRun(r) : null;
  }

  runs(): JobRun[] {
    return this.sql.exec<Raw>("SELECT * FROM runs ORDER BY scheduled_for, run_id").toArray().map(toRun);
  }

  unsyncedRuns(): JobRun[] {
    return this.sql.exec<Raw>("SELECT * FROM runs WHERE ledger_synced = 0 ORDER BY updated_at").toArray().map(toRun);
  }

  step(runId: string, step: number): StepRow | null {
    const r = this.sql.exec<Raw>("SELECT * FROM steps WHERE run_id = ? AND step = ?", runId, step).toArray()[0];
    return r ? toStep(r) : null;
  }

  steps(runId: string): StepRow[] {
    return this.sql.exec<Raw>("SELECT * FROM steps WHERE run_id = ? ORDER BY step", runId).toArray().map(toStep);
  }

  /** Marks a step running before its handler runs: the record exists before any effect could. */
  startStep(runId: string, step: number, kind: string, now: number): void {
    this.sql.exec(
      `INSERT INTO steps (run_id, step, kind, state, attempts, updated_at) VALUES (?, ?, ?, 'running', 1, ?)
       ON CONFLICT(run_id, step) DO UPDATE SET state = 'running', attempts = attempts + 1, updated_at = excluded.updated_at`,
      runId, step, kind, now,
    );
  }

  endStep(runId: string, step: number, state: StepState, output: string | null, now: number, decidedBy: string | null = null): void {
    this.sql.exec("UPDATE steps SET state = ?, output = ?, decided_by = COALESCE(?, decided_by), updated_at = ? WHERE run_id = ? AND step = ?", state, output, decidedBy, now, runId, step);
  }

  /** The step's tool calls, written with its completion; a step run again replaces its own. */
  recordCalls(runId: string, step: number, calls: CallRecord[]): void {
    this.sql.exec("DELETE FROM tool_calls WHERE run_id = ? AND step = ?", runId, step);
    for (const [n, c] of calls.entries()) this.sql.exec("INSERT INTO tool_calls (run_id, step, n, call_id, tool, ok, code) VALUES (?, ?, ?, ?, ?, ?, ?)", runId, step, n, c.id, c.tool, c.ok ? 1 : 0, c.refused ?? c.code ?? null);
  }

  toolCalls(): ToolCallRow[] {
    return this.sql.exec<Raw>("SELECT * FROM tool_calls ORDER BY run_id, step, n").toArray().map((r) => ({ runId: String(r.run_id), step: Number(r.step), callId: String(r.call_id), tool: String(r.tool), ok: Number(r.ok) === 1, code: (r.code as string | null) ?? null }));
  }

  /** Queues a message unless the same content was queued before; returns whether it is new. */
  queue(o: { id: string; runId: string | null; chat: string; contentHash: string; text: string }, now: number): boolean {
    const before = this.sql.exec<Raw>("SELECT id FROM outbox WHERE content_hash = ?", o.contentHash).toArray().length;
    this.sql.exec(
      "INSERT OR IGNORE INTO outbox (id, run_id, chat, content_hash, text, state, next_attempt, created_at) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)",
      o.id, o.runId, o.chat, o.contentHash, o.text, now, now,
    );
    return before === 0;
  }

  outbox(): OutboxRow[] {
    return this.sql.exec<Raw>("SELECT * FROM outbox ORDER BY created_at, id").toArray().map(toOutbox);
  }

  dueOutbox(now: number): OutboxRow[] {
    return this.sql.exec<Raw>("SELECT * FROM outbox WHERE state IN ('pending', 'delivering') AND next_attempt <= ? ORDER BY created_at, id", now).toArray().map(toOutbox);
  }

  nextOutboxAttempt(): number | null {
    return num(this.sql.exec<Raw>("SELECT MIN(next_attempt) AS t FROM outbox WHERE state IN ('pending', 'delivering')").toArray()[0]?.t);
  }

  updateOutbox(id: string, fields: Partial<Record<"state" | "attempts" | "next_attempt" | "last_code" | "delivered_at", string | number | null>>): void {
    const keys = Object.keys(fields);
    this.sql.exec(`UPDATE outbox SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`, ...keys.map((k) => fields[k as keyof typeof fields] ?? null), id);
  }
}

function toRun(r: Raw): JobRun {
  return {
    runId: String(r.run_id), jobId: String(r.job_id), scheduledFor: Number(r.scheduled_for), manual: Number(r.manual) === 1,
    phase: r.phase as RunPhase, attempt: Number(r.attempt), step: Number(r.step), leaseUntil: num(r.lease_until), timeoutAt: num(r.timeout_at),
    retryAt: num(r.retry_at), observed: JSON.parse(String(r.observed)) as Observation, signal: (r.signal as RunSignal | null) ?? null,
    code: (r.code as string | null) ?? null, reason: (r.reason as string | null) ?? null, nextProbe: num(r.next_probe),
    ledgerSynced: Number(r.ledger_synced) === 1, startedAt: Number(r.started_at), updatedAt: Number(r.updated_at),
  };
}

function toStep(r: Raw): StepRow {
  return { runId: String(r.run_id), step: Number(r.step), kind: String(r.kind), state: r.state as StepState, output: (r.output as string | null) ?? null, attempts: Number(r.attempts), decidedBy: (r.decided_by as string | null) ?? null };
}

function toOutbox(r: Raw): OutboxRow {
  return {
    id: String(r.id), runId: (r.run_id as string | null) ?? null, chat: String(r.chat), contentHash: String(r.content_hash), text: String(r.text),
    state: r.state as OutboxState, attempts: Number(r.attempts), nextAttempt: Number(r.next_attempt), lastCode: (r.last_code as string | null) ?? null,
  };
}

/** The Ledger's copy of a run. */
export function ledgerRow(run: JobRun, person: string): RunRow {
  return {
    runId: run.runId, jobId: run.jobId, person, scheduledFor: run.scheduledFor, phase: run.phase, attempt: run.attempt, step: run.step,
    leaseUntil: run.leaseUntil, timeoutAt: run.timeoutAt, tokens: 0, costMicros: 0, signal: run.signal, code: run.code, reason: run.reason,
    nextProbe: run.nextProbe, startedAt: run.startedAt, updatedAt: run.updatedAt,
  };
}
