// The background loops (AD-14, memory-and-learning.md "Background loops", D5): per person, memory
// upkeep, the hourly relationships re-rank, nightly reflection and the weekly skill review; per company, company memory upkeep, the
// company skill review, the onboarding study and the monthly cost report. Each has an enable flag
// and a token budget, kept by its owner's object, and every run is a row in the `Ledger` with the
// loop as its job id. A loop's budget is tokens per UTC day for one owner, counted from the Ledger's
// own model-call rows before every call, so a loop over budget stops before the call, never after.
import { normalizeContext } from "@earendil-works/pi-ai";
import { fence } from "../context/fence.ts";
import { dayStart } from "../ledger/budget.ts";
import type { LedgerSink, RunRow, RunSignal } from "../ledger/types.ts";
import { createStreamFn } from "../model/adapter.ts";
import { type ModelConfig, modelFor } from "../model/routes.ts";

export const PERSON_LOOPS = ["memory-upkeep", "relationships", "reflection", "skill-review"] as const;
export const COMPANY_LOOPS = ["company-upkeep", "company-skill-review", "onboarding-study", "cost-report"] as const;
export type PersonLoop = (typeof PERSON_LOOPS)[number];
export type CompanyLoop = (typeof COMPANY_LOOPS)[number];
export type LoopId = PersonLoop | CompanyLoop;

/** Each loop's default flag and daily token budget; the cost report makes no model call, so zero. */
export const LOOP_DEFAULTS: Record<LoopId, { enabled: boolean; budget: number }> = {
  "memory-upkeep": { enabled: true, budget: 60_000 },
  relationships: { enabled: true, budget: 30_000 },
  reflection: { enabled: true, budget: 30_000 },
  "skill-review": { enabled: true, budget: 30_000 },
  "company-upkeep": { enabled: true, budget: 60_000 },
  "company-skill-review": { enabled: true, budget: 30_000 },
  "onboarding-study": { enabled: true, budget: 20_000 },
  "cost-report": { enabled: true, budget: 0 },
};

/** Lines one upkeep call reads at most; more evidence is taken in further calls within the budget. */
export const EVIDENCE_BATCH = 40;

/** The Ledger as the loops use it: rows, admission, and what a loop spent today. */
export interface LoopLedger extends LedgerSink {
  recordRun(run: RunRow): Promise<void>;
  loopSpend(person: string, loop: string, since: number): Promise<number>;
}

export interface LoopModel {
  ai: Ai;
  /** The deploy's model configuration (`modelConfig(env)`). */
  models?: ModelConfig;
  ledger: LoopLedger;
  tenant: string;
  wait: (ms: number) => Promise<void>;
}

type Refusal = { ok: false; code: string; reason: string };
const refuse = (code: string, reason: string): Refusal => ({ ok: false, code, reason });

export interface LoopSetting {
  loop: LoopId;
  enabled: boolean;
  budget: number;
}

/** The flags and budgets of one owner's loops, and the runs they finished, in that owner's SQLite. */
export class LoopSettings {
  private readonly sql: SqlStorage;
  private readonly loops: readonly LoopId[];

  constructor(storage: Pick<DurableObjectStorage, "sql">, loops: readonly LoopId[]) {
    this.sql = storage.sql;
    this.loops = loops;
  }

  /** A run already finished in this slot: a tick delivered twice is answered with the first outcome. */
  finished(runId: string): LoopOutcome | null {
    const row = this.sql.exec<{ outcome: string }>("SELECT outcome FROM loop_runs WHERE run_id = ?", runId).toArray()[0];
    return row ? (JSON.parse(row.outcome) as LoopOutcome) : null;
  }

  finish(outcome: LoopOutcome, at: number): void {
    this.sql.exec("INSERT OR REPLACE INTO loop_runs (run_id, outcome, at) VALUES (?, ?, ?)", outcome.runId, JSON.stringify(outcome), at);
  }

  /** The runs one loop finished, oldest first. */
  runs(loop: LoopId): LoopOutcome[] {
    return this.sql.exec<{ outcome: string }>("SELECT outcome FROM loop_runs WHERE run_id LIKE ? ORDER BY at, run_id", `loop:${loop}:%`).toArray().map((r) => JSON.parse(r.outcome) as LoopOutcome);
  }

  get(loop: LoopId): LoopSetting {
    const row = this.sql.exec<{ enabled: number; budget: number }>("SELECT enabled, budget FROM loop_settings WHERE loop = ?", loop).toArray()[0];
    return row ? { loop, enabled: row.enabled === 1, budget: row.budget } : { loop, ...LOOP_DEFAULTS[loop] };
  }

  list(): LoopSetting[] {
    return this.loops.map((l) => this.get(l));
  }

  /** Turns a loop on or off, or sets its daily budget; the owner's object checks who may. */
  set(loop: unknown, patch: { enabled?: unknown; budget?: unknown }): { ok: true; setting: LoopSetting } | Refusal {
    if (!this.loops.includes(loop as LoopId)) return refuse("LOOP_UNKNOWN", `a loop here is one of ${this.loops.join(", ")}`);
    const current = this.get(loop as LoopId);
    if (patch.enabled !== undefined && typeof patch.enabled !== "boolean") return refuse("LOOP_SETTING_INVALID", "enabled is true or false");
    if (patch.budget !== undefined && !(Number.isSafeInteger(patch.budget) && (patch.budget as number) >= 0)) return refuse("LOOP_SETTING_INVALID", "the budget is a whole number of tokens per day");
    const next = { loop: loop as LoopId, enabled: (patch.enabled as boolean | undefined) ?? current.enabled, budget: (patch.budget as number | undefined) ?? current.budget };
    this.sql.exec("INSERT OR REPLACE INTO loop_settings (loop, enabled, budget) VALUES (?, ?, ?)", next.loop, next.enabled ? 1 : 0, next.budget);
    return { ok: true, setting: next };
  }
}

export interface LoopOutcome {
  ok: boolean;
  loop: LoopId;
  runId: string;
  signal: RunSignal;
  code: string | null;
  reason: string | null;
  /** Model calls this run made; zero whenever the gate found no evidence. */
  calls: number;
}

/**
 * One run of one loop for one owner: its id, its row in the Ledger, its budget check before each
 * call, and its one fenced call through the adapter. The id is the loop and the slot it was due in,
 * so a tick delivered twice is the same run.
 */
export class LoopRun {
  readonly runId: string;
  calls = 0;
  private readonly startedAt: number;

  readonly loop: LoopId;
  readonly owner: string;
  private readonly setting: LoopSetting;
  private readonly state: LoopSettings;
  private readonly m: LoopModel;
  private readonly now: () => number;

  private constructor(loop: LoopId, owner: string, state: LoopSettings, m: LoopModel, now: () => number, slot: number) {
    this.loop = loop;
    this.owner = owner;
    this.state = state;
    this.m = m;
    this.now = now;
    this.runId = `loop:${loop}:${new Date(slot).toISOString()}`;
    this.setting = state.get(loop);
    this.startedAt = now();
  }

  /**
   * A run of `loop` in the slot due at `slot`; or, without starting one, the outcome of a loop that is
   * switched off (nothing recorded, no call) or of the run this slot already finished.
   */
  static start(o: { loop: LoopId; owner: string; state: LoopSettings; model: LoopModel; now: () => number; slot: number }): LoopRun | LoopOutcome {
    if (!o.state.get(o.loop).enabled) return disabled(o.loop);
    const run = new LoopRun(o.loop, o.owner, o.state, o.model, o.now, o.slot);
    return o.state.finished(run.runId) ?? run;
  }

  /** Whether the next call fits the loop's day: refused here, before the call, with its code. */
  async admit(): Promise<Refusal | null> {
    const spent = await this.m.ledger.loopSpend(this.owner, this.loop, dayStart(this.now()));
    if (spent >= this.setting.budget) return refuse("LOOP_BUDGET_EXHAUSTED", `${this.loop} spent ${spent} of its ${this.setting.budget} tokens today`);
    return null;
  }

  /**
   * One call on the `job` route, the inputs fenced as data, answered with one JSON object. The
   * Ledger's run ceiling is the rest of the day's budget, so a call cannot start past it either.
   */
  async call(instructions: string, inputs: Array<[label: string, text: string]>): Promise<{ ok: true; json: Record<string, unknown> } | Refusal> {
    const over = await this.admit();
    if (over) return over;
    const spent = await this.m.ledger.loopSpend(this.owner, this.loop, dayStart(this.now()));
    const model = modelFor("job");
    const streamFn = createStreamFn(
      { ai: this.m.ai, ledger: this.m.ledger, wait: this.m.wait, now: this.now, models: this.m.models },
      { tenant: this.m.tenant, person: this.owner, runId: this.runId, route: "job", ceiling: this.setting.budget - spent },
    );
    const context = normalizeContext({
      messages: [
        { role: "system", content: instructions, timestamp: 0 },
        { role: "user", content: inputs.map(([label, text]) => fence(label, text || "(none)")).join("\n"), timestamp: this.now() },
      ],
    });
    this.calls++;
    const message = await (await streamFn(model, context, { maxTokens: model.maxTokens })).result();
    if (message.stopReason === "error" || message.stopReason === "aborted") {
      const text = message.errorMessage ?? "MODEL_CALL_FAILED: no detail";
      return refuse(text.includes(":") ? text.slice(0, text.indexOf(":")) : "MODEL_CALL_FAILED", text);
    }
    const raw = message.content.map((c) => (c.type === "text" ? c.text : "")).join("");
    try {
      const json = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)) as unknown;
      if (!json || typeof json !== "object" || Array.isArray(json)) return refuse("LOOP_OUTPUT_UNPARSEABLE", "the answer is not one JSON object");
      return { ok: true, json: json as Record<string, unknown> };
    } catch (err) {
      return refuse("LOOP_OUTPUT_UNPARSEABLE", `the answer does not parse: ${String(err).slice(0, 120)}`);
    }
  }

  /**
   * The run's row in the Ledger, with the signal it ended on; the Ledger adds its tokens and cost. For
   * a loop, `notify` means it produced something for its owner's stores (claims, a note, proposals, a
   * report), `nothing_to_report` that its gate found no evidence, `blocked` that a budget stopped it.
   */
  async finish(signal: RunSignal, code: string | null = null, reason: string | null = null): Promise<LoopOutcome> {
    const at = this.now();
    await this.m.ledger.recordRun({
      runId: this.runId, jobId: `loop:${this.loop}`, person: this.owner, scheduledFor: this.startedAt, phase: "done", attempt: 1, step: this.calls,
      leaseUntil: null, timeoutAt: null, tokens: 0, costMicros: 0, signal, code, reason, nextProbe: null, startedAt: this.startedAt, updatedAt: at,
    });
    const outcome = { ok: signal !== "failed" && signal !== "blocked", loop: this.loop, runId: this.runId, signal, code, reason, calls: this.calls };
    this.state.finish(outcome, at);
    return outcome;
  }

  /** Ends a run on a refused or failed call: a budget's refusal is `blocked` with its code, anything else `failed`. */
  async stop(r: Refusal): Promise<LoopOutcome> {
    return this.finish(BUDGET_CODES.has(r.code) ? "blocked" : "failed", r.code, r.reason);
  }
}

/** Refusals that mean a budget stopped the run, from this loop's check or the Ledger's own. */
const BUDGET_CODES = new Set(["LOOP_BUDGET_EXHAUSTED", "RUN_CEILING_REACHED", "BUDGET_PERSON_EXHAUSTED", "BUDGET_TENANT_EXHAUSTED", "BUDGET_STAGING_CAP"]);

/** A refused loop that did not run: switched off. Nothing is recorded and no call is made. */
export const disabled = (loop: LoopId): LoopOutcome => ({ ok: true, loop, runId: "", signal: "nothing_to_report", code: "LOOP_DISABLED", reason: `${loop} is switched off`, calls: 0 });

/** The strings of a JSON list, or none. */
export const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

/** The objects of a JSON list, or none. */
export const items = (v: unknown): Array<Record<string, unknown>> => (Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x)) : []);
