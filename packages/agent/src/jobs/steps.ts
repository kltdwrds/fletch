// The built-in run steps (M5.1). A handler computes; it never performs a side effect itself: what it
// wants delivered comes back as notices, which the engine commits with the step's completion in one
// transaction (the persistence barrier), so a step resumed after an eviction delivers nothing twice.
import { fence } from "../context/fence.ts";
import type { JobDefinition, StepSpec } from "./body.ts";
import type { Observation } from "./gates.ts";
import type { JobModelResult } from "./model.ts";
import type { CallRecord, SilenceClaim } from "./silence.ts";

export type CompleteResult = JobModelResult;

export interface StepContext {
  def: JobDefinition;
  runId: string;
  scheduledFor: number;
  /** Whether the person asked for this run ("run now"): its result always arrives (B17). */
  manual: boolean;
  observed: Observation;
  /** Outputs of the steps before this one, in order. */
  outputs: string[];
  now: number;
  /** The watermark the last certified silence wrote, shown to the next run's model step. */
  mark?: string;
  /** The model step's calls through the adapter on the `job` route, each admitted by the Ledger first, with the job's read tools. */
  complete: (input: { instructions: string; input: string; maxTokens?: number; gateObserved: boolean }) => Promise<CompleteResult>;
}

export type StepOutcome =
  | { kind: "done"; output: string; notices?: string[]; calls?: CallRecord[] }
  /** Certified silence (M25.2): the run ends `nothing_to_report` and writes the claim's watermark. */
  | { kind: "silent"; claim: SilenceClaim; calls: CallRecord[] }
  | { kind: "wait"; timeoutAt: number }
  /** `budget` failures are the Ledger's refusals: they end the run without a retry or a strike. */
  | { kind: "failed"; code: string; reason: string; retry: boolean; budget?: boolean; calls?: CallRecord[] };

export type StepHandler = (spec: StepSpec, ctx: StepContext) => Promise<StepOutcome>;

const BUDGET_CODES = new Set(["RUN_CEILING_REACHED", "BUDGET_PERSON_EXHAUSTED", "BUDGET_TENANT_EXHAUSTED", "BUDGET_STAGING_CAP", "BUDGET_UNAVAILABLE"]);

/**
 * The failures a run step is retried on (Muse spec §16.4, narrowed): a rate limit, a 5xx, and the
 * network ones (the call threw before an answer, or the stream broke). Anything else is deterministic:
 * it ends the occurrence, and the next scheduled occurrence is its retry.
 */
export function transient(code: string): boolean {
  return code === "MODEL_RATE_LIMITED" || /^MODEL_HTTP_5\d\d$/.test(code) || code === "MODEL_CALL_FAILED" || code === "MODEL_STREAM_DROPPED";
}

function hostOf(url: string | undefined): string {
  try {
    return url ? new URL(url).hostname : "page";
  } catch {
    return "page";
  }
}

const at = (ms: number) => new Date(ms).toISOString().replace(".000Z", "Z");

export const BUILTIN_STEPS: Record<string, StepHandler> = {
  async diff(_spec, ctx) {
    return { kind: "done", output: observationText(ctx) };
  },

  async model(spec, ctx) {
    const s = spec as Extract<StepSpec, { kind: "model" }>;
    const gateObserved = Object.keys(ctx.observed).length > 0;
    const before = ctx.outputs.at(-1) ?? (gateObserved ? observationText(ctx) : "");
    const input = ctx.mark ? `${before}\n\nThe last run read up to: ${ctx.mark}` : before;
    const r = await ctx.complete({ instructions: [ctx.def.instructions, s.prompt ?? ""].filter(Boolean).join("\n\n"), input, gateObserved, ...(s.maxTokens ? { maxTokens: s.maxTokens } : {}) });
    if (r.ok) return r.kind === "report" ? { kind: "done", output: r.text, calls: r.calls } : { kind: "silent", claim: r.claim, calls: r.calls };
    const code = r.code;
    return BUDGET_CODES.has(code) ? { kind: "failed", code, reason: r.reason, retry: false, budget: true, calls: r.calls } : { kind: "failed", code, reason: r.reason, retry: transient(code), calls: r.calls };
  },

  async approval(spec, ctx) {
    const s = spec as Extract<StepSpec, { kind: "approval" }>;
    return { kind: "wait", timeoutAt: ctx.now + s.timeoutMinutes * 60_000 };
  },

  async notify(_spec, ctx) {
    const text = ctx.outputs.at(-1);
    if (!text) return { kind: "failed", code: "NOTIFY_NOTHING", reason: "no step before notify produced a message", retry: false };
    return { kind: "done", output: text, notices: [text] };
  },
};

/** What the gate observed, said deterministically: the watch's message and a model step's first input. */
function observationText(ctx: StepContext): string {
  // The message is content alone, no timestamp, so content already delivered dedupes (B17).
  const o = ctx.observed;
  if (o.source !== undefined && o.excerpt !== undefined) {
    return `${ctx.def.title}: an event arrived. It reads:\n${fence(`hook:${o.source}`, o.excerpt)}`;
  }
  if (o.excerpt !== undefined) {
    return `${ctx.def.title}: the page at ${o.url} changed. The start of it now reads:\n${fence(`web:${hostOf(o.url)}`, o.excerpt)}`;
  }
  if (o.before !== undefined && o.after !== undefined) return `${ctx.def.title}: ${o.url} rose from ${o.before} to ${o.after}.`;
  if (o.after !== undefined) return `${ctx.def.title}: ${o.url} reached ${o.after}.`;
  return `${ctx.def.title}: no change since the last check (${at(ctx.now)}).`;
}
