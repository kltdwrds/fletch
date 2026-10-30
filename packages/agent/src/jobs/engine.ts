// The Job engine (AD-3, AD-10, M5.1): one job per object, driven by the object's one alarm, which it
// multiplexes over the next occurrence, a run's next step or retry, an approval timeout, the outbox's
// next attempt and a blocked job's probe. Each alarm does one unit of work and re-arms:
//
//   reconcile the body by hash -> advance an active run by one step -> deliver due outbox rows
//   -> otherwise take the due occurrence: gate in code (no model) -> closed: nothing, no run row
//                                                                 -> open: create the run, idempotently
//
// An event from the owner's `Ingress` source (M6.1) is one gate evaluation, recorded once per event
// id (`events.ts`); an open one becomes a run at the next alarm, after any run already in progress.
//
// A step is persisted as running before its handler runs and completed with its notices in one
// transaction, so an eviction re-runs at most the handler, never an effect.
import type { EgressResult } from "../egress/module.ts";
import type { RunRow, RunSignal } from "../ledger/types.ts";
import type { ToolSpec } from "../tools/registry.ts";
import { describeStop, type JobDefinition, parseJobBody } from "./body.ts";
import { type EventEvaluation, EventLog, evaluateEvent, type EventVerdict, type JobEvent } from "./events.ts";
import { evaluateGate, type GateResult, type Observation } from "./gates.ts";
import type { JobModelInput } from "./model.ts";
import { describeCadence, dueSlot, jitterMs, nextSlotAfter } from "./schedule.ts";
import { BUILTIN_STEPS, type CompleteResult, type StepHandler, transient } from "./steps.ts";
import { failedLine, pastUntil, sha256, stoppedLine, stopsAfter } from "./ends.ts";
import { type JobRow, type JobRun, JobStore, ledgerRow, type OutboxRow, type PastDefinition, type StepRow, type ToolCallRow } from "./store.ts";
import { errorName, log } from "../obs/log.ts";

/** A step's lease: if its instance dies, the alarm armed for the lease's end resumes it. */
export const LEASE_MS = 5 * 60_000;
export const RUN_MAX_ATTEMPTS = 3;
export const RETRY_BASE_MS = 60_000;
/** Consecutive failed runs before later occurrences are skipped for a growing while. */
export const BACKOFF_AFTER = 3;
export const BACKOFF_BASE_MS = 30 * 60_000;
/** Consecutive failed runs before the job turns itself off and says so (B12). */
export const AUTO_DISABLE_AFTER = 5;
export const PROBE_MS = 60 * 60_000;
export const DELIVERY_MAX_ATTEMPTS = 5;
export const DELIVERY_BASE_MS = 30_000;

export type NotifyResult = { ok: true; duplicate: boolean } | { ok: false; code: string; reason: string };

/** The chat a job delivers into (`ChatEngine.notify`), idempotent on the notice id. */
export interface ChatNotices {
  notify(n: { id: string; source: string; text: string; person: string }): Promise<NotifyResult>;
  hasNotice(id: string): Promise<boolean>;
}

export interface BodyObject {
  text(): Promise<string>;
  customMetadata?: Record<string, string>;
}

export interface JobDeps {
  now: () => number;
  bucket?: { get(key: string): Promise<BodyObject | null> };
  /** GET through the tenant's egress module for this person, the job's purpose in the audit row. */
  get: (person: string, purpose: string) => (url: string, headers: Array<[string, string]>) => Promise<EgressResult>;
  ledger: { recordRun(row: RunRow): Promise<void> };
  complete: (a: JobModelInput) => Promise<CompleteResult>;
  /** The tools the host offers a job's model step for its owner (M25.2); only the read-only ones run (`job-tools.ts`). */
  tools?: (owner: string, jobId: string) => ToolSpec[];
  chat: (chatId: string) => ChatNotices;
  /** Fixture steps in tests. */
  steps?: Record<string, StepHandler>;
  /** Tells the owner's `Person` this job is theirs, for the app's job list (M14.2); a failure is logged, not fatal. */
  index?: (owner: string, id: string) => Promise<unknown>;
  /** Tells the owner's `Person` a removed job is no longer theirs to list (M25.6); a failure is logged, not fatal. */
  forget?: (owner: string, id: string) => Promise<unknown>;
}

export interface JobHost {
  storage: Pick<DurableObjectStorage, "sql" | "transactionSync" | "setAlarm" | "deleteAlarm">;
}

export type JobRefusal = { ok: false; code: string; reason: string };
export type Registered = { ok: true; status: JobRow["status"]; cadence: string } | JobRefusal;
export interface JobInspection {
  ok: true;
  job: (JobRow & { cadence: string }) | null;
  runs: JobRun[];
  steps: StepRow[];
  outbox: OutboxRow[];
  calls: ToolCallRow[];
}

const notOwner = (): JobRefusal => ({ ok: false, code: "JOB_NOT_OWNER", reason: "only the job's owner can do this" });
const archived = (): JobRefusal => ({ ok: false, code: "JOB_ARCHIVED", reason: "the job was removed" });

/** What "run now" answers: the run, and how it stands (a gate that failed or was blocked ends it at once). */
export type RunNowResult = { ok: true; runId: string; signal: RunSignal | null; code: string | null } | JobRefusal;

export type EventOutcome = { ok: true; duplicate: boolean; open: boolean; why: string } | JobRefusal;

export class JobEngine {
  readonly store: JobStore;
  readonly events: EventLog;
  private readonly host: JobHost;
  private readonly deps: JobDeps;

  constructor(host: JobHost, deps: JobDeps) {
    this.host = host;
    this.deps = deps;
    this.store = new JobStore(host.storage);
    this.events = new EventLog(host.storage);
  }

  /** An event the owner's `Ingress` accepted: evaluated once per event id, ever; an open gate queues a run. */
  async event(e: JobEvent): Promise<EventOutcome> {
    const job = this.store.job();
    if (!job) return { ok: false, code: "JOB_UNKNOWN", reason: "no job here" };
    if (job.owner !== e.owner) return { ok: false, code: "JOB_NOT_OWNER", reason: "an event reaches only its source owner's jobs" };
    const now = this.deps.now();
    const verdict: EventVerdict = job.status === "active" ? evaluateEvent(job.def.gate, e) : { open: false, why: "job_not_active" };
    let fresh = false;
    this.store.transaction(() => {
      fresh = this.events.record(e, verdict, now);
    });
    const kept = this.events.get(e.eventId) as EventEvaluation;
    if (fresh && kept.open) await this.arm();
    return { ok: true, duplicate: !fresh, open: kept.open, why: kept.why };
  }

  /** Starts the oldest open event's run when no run is in progress; its first step runs at the next alarm. */
  private startEventRun(now: number): void {
    const job = this.store.job();
    const next = this.events.pending()[0];
    if (!job || !next || this.store.activeRun()) return;
    // Runs stay unique on (job, scheduled_for): an event run takes the first instant no run holds.
    const scheduledFor = Math.max(now, ...this.store.runs().map((r) => r.scheduledFor + 1));
    const runId = `${job.id}:event:${next.eventId}`;
    this.store.transaction(() => {
      this.store.createRun({ runId, jobId: job.id, scheduledFor, manual: false, observed: next.observed }, now);
      this.events.setRun(next.eventId, runId);
    });
  }

  /** Registers a job from its body in R2. One the owner did not write starts off until enabled. */
  async register(a: { owner: string; by: string; path: string }): Promise<Registered> {
    const obj = await this.deps.bucket?.get(a.path);
    if (!obj) return { ok: false, code: "JOB_BODY_MISSING", reason: `no body at ${a.path}` };
    const text = await obj.text();
    const parsed = parseJobBody(text);
    if (!parsed.ok) return parsed;
    const writer = obj.customMetadata?.writer ?? a.by;
    return this.put(a.owner, parsed.def, { path: a.path, hash: await sha256(text) }, writer === a.owner && a.by === a.owner);
  }

  /** Defines a job directly (no body file); `by` other than the owner registers it disabled. */
  async define(a: { owner: string; by: string; def: JobDefinition }): Promise<Registered> {
    return this.put(a.owner, a.def, null, a.by === a.owner);
  }

  private async put(owner: string, def: JobDefinition, source: { path: string; hash: string } | null, byOwner: boolean): Promise<Registered> {
    const existing = this.store.job();
    if (existing && (existing.owner !== owner || existing.id !== def.id)) return { ok: false, code: "JOB_OTHER_JOB", reason: "this object holds another job" };
    const status = byOwner ? "active" : "needs_enable";
    const now = this.deps.now();
    this.store.transaction(() => {
      this.store.putJob({ id: def.id, owner, def, history: existing?.history ?? [], sourcePath: source?.path ?? null, sourceHash: source?.hash ?? null, status }, now);
      // Occurrences before a job existed are not its to run: the first is strictly after now. A removed
      // job made again starts as a new one, its old runs kept (M25.6).
      if (!existing) this.store.updateJob({ last_slot: now }, now);
      else if (existing.status === "archived") this.store.updateJob({ last_slot: now, gate_state: "{}", failures: 0, backoff_until: null, next_probe: null }, now);
    });
    await this.arm();
    await this.deps.index?.(owner, def.id).catch((e: unknown) => log("job.index", { job: def.id, error: errorName(e) }, "error"));
    return { ok: true, status, cadence: describeCadence(def.timing) };
  }

  async enable(by: string): Promise<{ ok: true } | JobRefusal> {
    const job = this.store.job();
    if (!job) return { ok: false, code: "JOB_UNKNOWN", reason: "no job here" };
    if (job.owner !== by) return notOwner();
    if (job.status === "archived") return archived();
    this.store.transaction(() => this.store.updateJob({ status: "active", status_code: null, status_reason: null, failures: 0, backoff_until: null, next_probe: null }, this.deps.now()));
    await this.arm();
    return { ok: true };
  }

  async disable(by: string): Promise<{ ok: true } | JobRefusal> {
    const job = this.store.job();
    if (!job) return { ok: false, code: "JOB_UNKNOWN", reason: "no job here" };
    if (job.owner !== by) return notOwner();
    if (job.status === "archived") return archived();
    const now = this.deps.now();
    this.store.transaction(() => this.store.updateJob({ status: "disabled", status_code: "JOB_DISABLED_BY_OWNER", status_reason: "turned off by its owner" }, now));
    await this.stopRun(job, "JOB_STOPPED_BY_OWNER", "turned off by its owner while this run was in progress", now);
    await this.arm();
    return { ok: true };
  }

  /** A change in place (delta 7): same id and runs, the old definition kept. The agent's change to what the job reads or does starts it off, as a job it registers does. */
  async update(a: { owner: string; by: string; def: JobDefinition }): Promise<Registered> {
    const job = this.store.job();
    if (!job) return { ok: false, code: "JOB_UNKNOWN", reason: "no job here" };
    if (job.owner !== a.owner || job.id !== a.def.id) return notOwner();
    if (job.status === "archived") return archived();
    if (job.status === "finished") return { ok: false, code: "JOB_FINISHED", reason: "the job already ran to its stop; make a new one" };
    if (this.store.activeRun()) return { ok: false, code: "JOB_RUN_IN_PROGRESS", reason: "a run is in progress; change it after the run ends" };
    const now = this.deps.now();
    // The person decides an agent's job and its time on one card (QYVR-165): any agent edit sends it back, and one still on its card is not changed under it.
    if (a.by !== a.owner && job.status === "needs_enable") return { ok: false, code: "JOB_AWAITING_DECISION", reason: "the job waits on the person's card; change it after they decide, or remove it" };
    const status = a.by !== a.owner && job.status === "active" ? "needs_enable" : job.status;
    this.store.transaction(() => {
      this.store.putJob({ id: job.id, owner: job.owner, def: a.def, history: [...job.history, { until: now, by: a.by, def: job.def }], sourcePath: job.sourcePath, sourceHash: job.sourceHash, status }, now);
      // `putJob` clears the status words; a job still off keeps saying why. Occurrences before the change are not its to run.
      this.store.updateJob({ last_slot: Math.max(now, job.lastSlot ?? now), ...(status === job.status ? { status_code: job.statusCode, status_reason: job.statusReason } : {}) }, now);
    });
    await this.arm();
    return { ok: true, status, cadence: describeCadence(a.def.timing) };
  }

  /** The owner's stop or remove ends the run in flight (deltas 1, 5): failed, said at once, never notify or silent. One outcome per run: a queued result stands, a late step changes nothing. */
  private async stopRun(job: JobRow, code: string, reason: string, now: number): Promise<void> {
    const run = this.store.activeRun();
    if (!run || this.store.outbox().some((o) => o.runId === run.runId)) return;
    this.store.transaction(() => this.store.updateRun(run.runId, { phase: "done", signal: "failed", code, reason, lease_until: null, timeout_at: null, retry_at: null, ledger_synced: 0 }, now));
    await this.tell(job, stoppedLine(job.def.title, code), run.runId, now);
    await this.deliver(now);
    await this.syncLedger();
  }

  /**
   * Removes the owner's job (M25.6): archived, its alarm cleared, a run in progress ended, its runs kept for
   * the Ledger, and gone from the owner's list. Removing a removed job is the same answer.
   */
  async remove(by: string): Promise<{ ok: true } | JobRefusal> {
    const job = this.store.job();
    if (!job) return { ok: false, code: "JOB_UNKNOWN", reason: "no job here" };
    if (job.owner !== by) return notOwner();
    if (job.status !== "archived") {
      const now = this.deps.now();
      this.store.transaction(() => this.store.updateJob({ status: "archived", status_code: "JOB_ARCHIVED", status_reason: "removed by its owner", next_probe: null, backoff_until: null }, now));
      await this.stopRun(job, "JOB_ARCHIVED", "the job was removed while this run was in progress", now);
      await this.syncLedger();
      await this.arm();
    }
    await this.deps.forget?.(job.owner, job.id).catch((e: unknown) => log("job.forget", { job: job.id, error: errorName(e) }, "error"));
    return { ok: true };
  }

  /** The owner's "run now": clears a block or a backoff and runs once, whatever the gate says. */
  async runNow(by: string): Promise<RunNowResult> {
    const job = this.store.job();
    if (!job) return { ok: false, code: "JOB_UNKNOWN", reason: "no job here" };
    if (job.owner !== by) return notOwner();
    if (job.status === "archived") return archived();
    if (job.status === "disabled" || job.status === "needs_enable" || job.status === "needs_attention") return { ok: false, code: "JOB_NOT_ENABLED", reason: `the job is ${job.status}; enable it first` };
    if (this.store.activeRun()) return { ok: false, code: "JOB_RUN_IN_PROGRESS", reason: "a run is in progress" };
    const now = this.deps.now();
    const gate = await this.gate(job, now);
    const runId = `${job.id}:${now}`;
    this.store.transaction(() => {
      this.store.updateJob({ status: job.status === "blocked" ? "active" : job.status, status_code: null, status_reason: null, next_probe: null, backoff_until: null, ...("state" in gate ? { gate_state: JSON.stringify(gate.state) } : {}) }, now);
      this.store.createRun({ runId, jobId: job.id, scheduledFor: now, manual: true, observed: gate.open ? gate.observed : {} }, now);
    });
    // A blocked gate (429, 403) pauses the job as a tick does; any other failure ends the run as failed.
    if ("error" in gate) {
      if (gate.error.blocked) await this.block(runId, gate.error.code, gate.error.reason, now);
      else await this.fail(runId, gate.error.code, gate.error.reason, false, now);
    } else await this.advance(now);
    await this.syncLedger();
    await this.arm();
    const ran = this.store.run(runId) as JobRun;
    return { ok: true, runId, signal: ran.signal, code: ran.code };
  }

  /** The approval event: the owner's decision completes the waiting step (AD-10). */
  async resolveApproval(a: { runId: string; step: number; approve: boolean; by: string }): Promise<{ ok: true } | JobRefusal> {
    const job = this.store.job();
    if (!job) return { ok: false, code: "JOB_UNKNOWN", reason: "no job here" };
    if (job.owner !== a.by) return notOwner();
    const run = this.store.run(a.runId);
    const step = run ? this.store.step(a.runId, a.step) : null;
    if (run?.phase !== "awaiting_approval" || run.step !== a.step || step?.state !== "waiting") return { ok: false, code: "APPROVAL_NOT_WAITING", reason: "that step is not waiting for a decision" };
    const now = this.deps.now();
    if (!a.approve) {
      this.store.transaction(() => this.store.endStep(a.runId, a.step, "failed", "declined", now, a.by));
      await this.finish(run, { signal: "failed", code: "APPROVAL_DECLINED", reason: "the owner declined" }, now, false);
    } else {
      this.store.transaction(() => {
        this.store.endStep(a.runId, a.step, "done", "approved", now, a.by);
        this.store.updateRun(a.runId, { phase: "executing", step: a.step + 1, timeout_at: null }, now);
      });
    }
    await this.syncLedger();
    await this.arm();
    return { ok: true };
  }

  status(): (Omit<JobRow, "history"> & { cadence: string; history: Array<PastDefinition & { cadence: string }> }) | null {
    const job = this.store.job();
    return job ? { ...job, cadence: describeCadence(job.def.timing), history: job.history.map((h) => ({ ...h, cadence: describeCadence(h.def.timing) })) } : null;
  }

  /** The job with its runs, their steps and the outbox, for its owner alone. */
  inspect(by: string): JobInspection | JobRefusal {
    const job = this.store.job();
    if (!job) return { ok: false, code: "JOB_UNKNOWN", reason: "no job here" };
    if (job.owner !== by) return notOwner();
    const runs = this.store.runs();
    return { ok: true, job: this.status(), runs, steps: runs.flatMap((r) => this.store.steps(r.runId)), outbox: this.store.outbox(), calls: this.store.toolCalls() };
  }

  async alarm(): Promise<void> {
    const now = this.deps.now();
    await this.reconcile(now);
    const job = this.store.job();
    if (!job) return;
    if (!this.store.activeRun() && job.status !== "archived") this.startEventRun(now);
    if (this.store.activeRun()) await this.advance(now);
    else await this.tick(job, now);
    await this.deliver(now);
    await this.syncLedger();
    await this.arm();
  }

  /** Re-reads the body when it has one; a changed hash re-applies it, a broken body needs attention. */
  private async reconcile(now: number): Promise<void> {
    const job = this.store.job();
    if (!job?.sourcePath || !this.deps.bucket || job.status === "archived") return;
    const obj = await this.deps.bucket.get(job.sourcePath);
    if (!obj) {
      if (job.status !== "needs_attention") await this.attention(job, "JOB_BODY_MISSING", `the body at ${job.sourcePath} is gone`, now);
      return;
    }
    const text = await obj.text();
    const hash = await sha256(text);
    if (hash === job.sourceHash) return;
    const parsed = parseJobBody(text);
    if (!parsed.ok || parsed.def.id !== job.id) {
      this.store.transaction(() => this.store.updateJob({ source_hash: hash }, now));
      await this.attention(job, parsed.ok ? "JOB_BODY_INVALID" : parsed.code, parsed.ok ? "the body names another job id" : parsed.reason, now);
      return;
    }
    const writer = obj.customMetadata?.writer ?? job.owner;
    const status = writer !== job.owner ? "needs_enable" : job.status === "needs_attention" ? "active" : job.status;
    this.store.transaction(() => this.store.putJob({ id: job.id, owner: job.owner, def: parsed.def, history: job.history, sourcePath: job.sourcePath, sourceHash: hash, status }, now));
  }

  private async tick(job: JobRow, now: number): Promise<void> {
    if (job.status === "blocked") {
      // A probe never runs the job: fixing the block does not auto-run (muse-reference section 6).
      if (job.nextProbe !== null && now >= job.nextProbe) this.store.transaction(() => this.store.updateJob({ next_probe: now + PROBE_MS }, now));
      return;
    }
    if (job.status !== "active") return;
    if (pastUntil(job, now)) {
      this.store.transaction(() => this.store.updateJob({ status: "finished", status_code: "JOB_STOPPED", status_reason: `stopped ${describeStop(job.def.stop)}` }, now));
      return;
    }
    const slot = dueSlot(job.def.timing, now, job.lastSlot);
    if (slot === null) {
      if (nextSlotAfter(job.def.timing, Math.max(now, job.lastSlot ?? now)) === null && job.lastSlot !== null) this.store.transaction(() => this.store.updateJob({ status: "finished" }, now));
      return;
    }
    if (job.backoffUntil !== null && now < job.backoffUntil) {
      this.store.transaction(() => this.store.updateJob({ last_slot: slot, ticks: job.ticks + 1, skipped: job.skipped + 1 }, now));
      return;
    }
    const gate = await this.gate(job, now);
    const runId = `${job.id}:${slot}`;
    if (!gate.open && !("error" in gate)) {
      this.store.transaction(() => this.store.updateJob({ last_slot: slot, ticks: job.ticks + 1, gate_state: JSON.stringify(gate.state) }, now));
      return;
    }
    let created = false;
    this.store.transaction(() => {
      this.store.updateJob({ last_slot: slot, ticks: job.ticks + 1, ...("state" in gate ? { gate_state: JSON.stringify(gate.state) } : {}) }, now);
      created = this.store.createRun({ runId, jobId: job.id, scheduledFor: slot, manual: false, observed: gate.open ? gate.observed : {} }, now);
    });
    if (!created) return;
    if ("error" in gate) {
      if (gate.error.blocked) await this.block(runId, gate.error.code, gate.error.reason, now);
      else await this.fail(runId, gate.error.code, gate.error.reason, false, now);
      return;
    }
    await this.advance(now);
  }

  private async gate(job: JobRow, now: number): Promise<GateResult> {
    if (!job.def.gate) return { open: true, state: job.gateState, observed: {} };
    return evaluateGate(job.def.gate, job.gateState, { now: () => now, zone: job.def.timing.zone, get: this.deps.get(job.owner, `job:${job.id}`) });
  }

  /** Runs the active run's next step, one per alarm. */
  private async advance(now: number): Promise<void> {
    const run = this.store.activeRun();
    const job = this.store.job();
    if (!run || !job) return;
    if (run.phase === "retry_wait") {
      if (run.retryAt !== null && now < run.retryAt) return;
      this.store.transaction(() => this.store.updateRun(run.runId, { phase: "executing", retry_at: null }, now));
    }
    if (run.phase === "awaiting_approval") {
      if (run.timeoutAt !== null && now >= run.timeoutAt) {
        this.store.transaction(() => this.store.endStep(run.runId, run.step, "failed", "timed out", now));
        await this.finish(run, { signal: "failed", code: "APPROVAL_TIMEOUT", reason: "no decision before the approval timed out" }, now, true);
      }
      return;
    }
    const spec = job.def.steps[run.step];
    if (!spec) {
      const notified = this.store.outbox().some((o) => o.runId === run.runId);
      await this.finish(run, { signal: notified ? "notify" : "nothing_to_report" }, now, false);
      return;
    }
    const handler = this.deps.steps?.[spec.kind] ?? BUILTIN_STEPS[spec.kind];
    this.store.transaction(() => {
      this.store.startStep(run.runId, run.step, spec.kind, now);
      this.store.updateRun(run.runId, { lease_until: now + LEASE_MS }, now);
    });
    await this.host.storage.setAlarm(now + LEASE_MS);
    if (!handler) {
      await this.fail(run.runId, "STEP_UNKNOWN", `no step called ${spec.kind}`, false, now);
      return;
    }
    const outputs = this.store.steps(run.runId).filter((s) => s.state === "done" && s.step < run.step && s.kind !== "approval").map((s) => s.output ?? "");
    const outcome = await handler(spec, {
      def: job.def, runId: run.runId, scheduledFor: run.scheduledFor, manual: run.manual, observed: run.observed, outputs, now,
      ...(job.gateState.mark ? { mark: job.gateState.mark } : {}),
      complete: (input) => this.deps.complete({ person: job.owner, runId: run.runId, ceiling: job.def.ceilingTokens, tools: this.deps.tools?.(job.owner, job.id) ?? [], ...input }),
    });
    // The owner's stop or remove may land while the handler ran (`stopRun`): the run keeps the outcome it was given.
    if (this.ended(run.runId)) return;
    if (outcome.kind === "silent") {
      // Certified silence: the step, its calls and the watermark commit together, then the run ends silent.
      const { claim } = outcome;
      this.store.transaction(() => {
        this.store.endStep(run.runId, run.step, "done", `nothing_to_report: ${claim.work} (evidence ${claim.evidence.join(", ")}; read up to ${claim.watermark})`, now);
        this.store.recordCalls(run.runId, run.step, outcome.calls);
        this.store.updateJob({ gate_state: JSON.stringify({ ...(this.store.job() as JobRow).gateState, mark: claim.watermark }) }, now);
      });
      // A run the person asked for always answers (B17), even when there is nothing to report.
      if (run.manual) await this.tell(job, `${job.def.title}: nothing to report (${claim.work}).`, run.runId, now);
      await this.finish(run, { signal: "nothing_to_report" }, now, false);
      return;
    }
    if (outcome.kind === "failed") {
      this.store.transaction(() => {
        this.store.endStep(run.runId, run.step, "failed", `${outcome.code}: ${outcome.reason}`, now);
        if (outcome.calls) this.store.recordCalls(run.runId, run.step, outcome.calls);
      });
      // Decided here for every handler, built in or not: only a transient code earns another attempt.
      if (outcome.retry && transient(outcome.code) && run.attempt < RUN_MAX_ATTEMPTS) {
        this.store.transaction(() => this.store.updateRun(run.runId, { phase: "retry_wait", attempt: run.attempt + 1, retry_at: now + RETRY_BASE_MS * 2 ** (run.attempt - 1), lease_until: null, code: outcome.code, reason: outcome.reason }, now));
        return;
      }
      await this.fail(run.runId, outcome.code, outcome.reason, outcome.budget === true, now);
      return;
    }
    if (outcome.kind === "wait") {
      this.store.transaction(() => {
        this.store.endStep(run.runId, run.step, "waiting", null, now);
        this.store.updateRun(run.runId, { phase: "awaiting_approval", timeout_at: outcome.timeoutAt, lease_until: null }, now);
      });
      return;
    }
    const hashes = await Promise.all((outcome.notices ?? []).map((t) => sha256(`${job.def.chat}\n${t}`)));
    this.store.transaction(() => {
      if (this.ended(run.runId)) return;
      this.store.endStep(run.runId, run.step, "done", outcome.output, now);
      if (outcome.calls) this.store.recordCalls(run.runId, run.step, outcome.calls);
      for (const [i, text] of (outcome.notices ?? []).entries()) this.store.queue({ id: `${run.runId}:${run.step}:${i}`, runId: run.runId, chat: job.def.chat, contentHash: hashes[i] as string, text }, now);
      this.store.updateRun(run.runId, { step: run.step + 1, lease_until: null, ledger_synced: 0 }, now);
    });
    // The next step runs at the next alarm, armed now: each step is its own invocation.
  }

  /** Whether a run already has its one outcome. */
  private ended(runId: string): boolean {
    return this.store.run(runId)?.phase === "done";
  }

  private async finish(run: JobRun, end: { signal: "notify" | "nothing_to_report" | "failed" | "blocked"; code?: string; reason?: string; nextProbe?: number }, now: number, strike: boolean): Promise<void> {
    if (this.ended(run.runId)) return;
    const job = this.store.job() as JobRow;
    this.store.transaction(() => {
      this.store.updateRun(run.runId, { phase: "done", signal: end.signal, code: end.code ?? null, reason: end.reason ?? null, next_probe: end.nextProbe ?? null, lease_until: null, timeout_at: null, retry_at: null, ledger_synced: 0 }, now);
      if (end.signal === "notify" || end.signal === "nothing_to_report") this.store.updateJob({ failures: 0, backoff_until: null }, now);
      // A one-shot is spent by the first run to end, scheduled or the person's, however it ends (B-P7-04).
      if (job.def.timing.schedule.kind === "runonce") this.store.updateJob({ status: "finished" }, now);
      else if (end.signal !== "failed" && end.signal !== "blocked" && stopsAfter(job, end.signal, this.store.runs())) this.store.updateJob({ status: "finished", status_code: "JOB_STOPPED", status_reason: `stopped ${describeStop(job.def.stop)}` }, now);
    });
    // A failed run is said (M25.6): a run the person asked for always, a scheduled one on its first failure in a row.
    if (end.signal === "failed" && strike && (run.manual || job.failures === 0)) await this.tell(job, failedLine(job, { manual: run.manual, code: end.code ?? "JOB_FAILED", reason: end.reason ?? "no reason given", now }), run.runId, now);
    if (strike) await this.strike(job, end.code ?? "JOB_FAILED", end.reason ?? "", now);
  }

  /** Ends a run as failed. Budget refusals are not the job's fault: no strike, but the person is told once a day. */
  private async fail(runId: string, code: string, reason: string, budget: boolean, now: number): Promise<void> {
    const run = this.store.run(runId) as JobRun;
    await this.finish(run, { signal: "failed", code, reason }, now, !budget);
    if (budget) {
      const job = this.store.job() as JobRow;
      await this.tell(job, `${job.def.title} did not run on ${new Date(now).toISOString().slice(0, 10)}: ${code} (${reason}). It will try again at its next scheduled time.`, runId, now);
    }
  }

  private async block(runId: string, code: string, reason: string, now: number): Promise<void> {
    const run = this.store.run(runId) as JobRun;
    const job = this.store.job() as JobRow;
    const nextProbe = now + PROBE_MS;
    await this.finish(run, { signal: "blocked", code, reason, nextProbe }, now, false);
    this.store.transaction(() => this.store.updateJob({ status: "blocked", status_code: code, status_reason: reason, next_probe: nextProbe }, now));
    await this.tell(job, `I paused ${job.def.title}: the service refused it (${code}: ${reason}). I will not try another way around it, and it stays paused until you say "run now".`, runId, now);
  }

  /** Counts a failed run: backoff after three in a row, then off and the person told (B12). */
  private async strike(job: JobRow, code: string, reason: string, now: number): Promise<void> {
    const failures = job.failures + 1;
    if (failures >= AUTO_DISABLE_AFTER) {
      this.store.transaction(() => this.store.updateJob({ failures, status: "disabled", status_code: "JOB_AUTO_DISABLED", status_reason: `${failures} failed runs in a row; last ${code}: ${reason}`, backoff_until: null }, now));
      await this.tell(job, `I turned off ${job.def.title} after ${failures} failed runs in a row. The last one failed with ${code}: ${reason}. It stays off until you turn it back on.`, null, now);
      return;
    }
    const backoff = failures >= BACKOFF_AFTER ? now + BACKOFF_BASE_MS * 2 ** (failures - BACKOFF_AFTER) : null;
    this.store.transaction(() => this.store.updateJob({ failures, backoff_until: backoff }, now));
  }

  private async attention(job: JobRow, code: string, reason: string, now: number): Promise<void> {
    this.store.transaction(() => this.store.updateJob({ status: "needs_attention", status_code: code, status_reason: reason }, now));
    await this.tell(job, `${job.def.title} needs your attention and will not run until it is fixed: ${code} (${reason}).`, null, now);
  }

  /** Queues a message to the job's chat; the same text is queued once. */
  private async tell(job: JobRow, text: string, runId: string | null, now: number): Promise<void> {
    const hash = await sha256(`${job.def.chat}\n${text}`);
    this.store.transaction(() => this.store.queue({ id: `${job.id}:notice:${hash.slice(0, 16)}`, runId, chat: job.def.chat, contentHash: hash, text }, now));
  }

  /**
   * Delivers due outbox rows. A row is marked `delivering` before the call; one found still
   * `delivering` has an unknown outcome, so the chat is asked whether it arrived before any resend (B7).
   */
  private async deliver(now: number): Promise<void> {
    const job = this.store.job();
    if (!job) return;
    for (const row of this.store.dueOutbox(now)) {
      const chat = this.deps.chat(row.chat);
      if (row.state === "delivering" && (await chat.hasNotice(row.id).catch(() => false))) {
        this.store.transaction(() => this.store.updateOutbox(row.id, { state: "delivered", delivered_at: now }));
        continue;
      }
      this.store.transaction(() => this.store.updateOutbox(row.id, { state: "delivering", attempts: row.attempts + 1 }));
      const r = await chat.notify({ id: row.id, source: `job:${job.id}`, text: row.text, person: job.owner }).catch((err: unknown): NotifyResult => ({ ok: false, code: "NOTIFY_FAILED", reason: String(err) }));
      if (r.ok) {
        this.store.transaction(() => this.store.updateOutbox(row.id, { state: "delivered", delivered_at: now, last_code: null }));
        continue;
      }
      const attempts = row.attempts + 1;
      this.store.transaction(() =>
        this.store.updateOutbox(row.id, attempts >= DELIVERY_MAX_ATTEMPTS ? { state: "failed", last_code: r.code } : { state: "pending", next_attempt: now + DELIVERY_BASE_MS * 2 ** (attempts - 1), last_code: r.code }),
      );
    }
  }

  /** Mirrors changed runs to the Ledger; a Ledger that cannot be reached is retried at the next alarm. */
  private async syncLedger(): Promise<void> {
    const job = this.store.job();
    if (!job) return;
    for (const run of this.store.unsyncedRuns()) {
      try {
        await this.deps.ledger.recordRun(ledgerRow(run, job.owner));
        this.store.transaction(() => this.store.updateRun(run.runId, { ledger_synced: 1 }, run.updatedAt));
      } catch {
        return;
      }
    }
  }

  /** The one alarm, at the earliest thing this job waits for. */
  private async arm(): Promise<void> {
    const job = this.store.job();
    if (!job) return;
    const now = this.deps.now();
    const times: number[] = [];
    const run = this.store.activeRun();
    if (run) {
      if (run.phase === "executing") times.push(run.leaseUntil ?? now);
      if (run.phase === "retry_wait" && run.retryAt !== null) times.push(run.retryAt);
      if (run.phase === "awaiting_approval" && run.timeoutAt !== null) times.push(run.timeoutAt);
    } else if (job.status === "active" && this.events.pending().length) {
      times.push(now);
    } else if (job.status === "active") {
      const slot = nextSlotAfter(job.def.timing, Math.max(now, job.lastSlot ?? Number.NEGATIVE_INFINITY));
      if (slot !== null) times.push(slot + jitterMs(job.def.timing, job.id, slot));
    } else if (job.status === "blocked" && job.nextProbe !== null) times.push(job.nextProbe);
    const outbox = this.store.nextOutboxAttempt();
    if (outbox !== null) times.push(outbox);
    if (this.store.unsyncedRuns().length) times.push(now + RETRY_BASE_MS);
    if (times.length) await this.host.storage.setAlarm(Math.min(...times));
    else await this.host.storage.deleteAlarm();
  }
}

/** The run rows a test or status page reads. */
export type { JobRun, Observation };
