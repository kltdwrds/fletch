// The Ledger's rows (AD-11): attribution lives here alone, since the gateway's `collectLog: false`
// drops its own log entry, metadata included. From M5.1 it also holds a row per job run and decides,
// before every model call, whether the run, the person and the tenant are inside their budgets.
import type { Route } from "../model/routes.ts";

/** How a model call ended; a 429 retried later is its own `rate_limited` row; `refused` never left. */
export type CallStatus = "ok" | "rate_limited" | "http_error" | "dropped" | "failed" | "refused";

export interface ModelCallRow {
  tenant: string;
  person: string;
  runId: string;
  route: Route;
  /** The model that answered as the provider named it, else the one asked for. */
  model: string;
  /** Who served the call: `workers-ai` or `meta` (D-0020). */
  provider?: string | null;
  /** The model id the call asked for, when the provider named the answer another (a dated id): the price falls back to it. */
  asked?: string;
  attempt: number;
  status: CallStatus;
  /** Stable code for any status but `ok`. */
  code: string | null;
  httpStatus: number | null;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cachedTokens: number;
  at: number;
  /** When the request went to the model; null for a call that never ran (`refused`). */
  startedAt: number | null;
  /** When the first reasoning, text or tool-call delta arrived; null when none did. */
  firstTokenAt: number | null;
  /** When the attempt ended, whatever its status; null for a call that never ran. */
  finishedAt: number | null;
}

/** Why a call was not admitted; each is checked from the Ledger before the call is made. */
export type BudgetCode = "RUN_CEILING_REACHED" | "BUDGET_PERSON_EXHAUSTED" | "BUDGET_TENANT_EXHAUSTED" | "BUDGET_STAGING_CAP" | "BUDGET_UNAVAILABLE" | "AGENT_DISABLED" | "MODEL_TIER_REFUSED" | "MODEL_UNPRICED";

export interface Admission {
  person: string;
  runId: string;
  /** The run's token ceiling, when the call belongs to a job run. */
  ceiling?: number;
  /** The model the call is for, checked against the company's model tier (M10.2). */
  model?: string;
}

export type AdmitResult = { ok: true } | { ok: false; code: BudgetCode; reason: string };

/** Where the adapter writes rows and asks for admission; the `Ledger` object in production. */
export interface LedgerSink {
  record(row: ModelCallRow): Promise<void>;
  /** Asked before every call; absent only in tests of the adapter alone. */
  admit?(admission: Admission): Promise<AdmitResult>;
  /** A chat turn that ended stopped or at the step cap (M24.2), once per chat and turn; absent in tests of the adapter alone. */
  turnEnded?(row: TurnEndRow): Promise<void>;
  /** Browser time spent for a run (M25.4); absent in tests of the adapter alone. */
  recordBrowser?(row: BrowserRow): Promise<void>;
}

/** Wall time one browser call took, as a cost on the run it served (M25.4). */
export interface BrowserRow {
  tenant: string;
  person: string;
  runId: string;
  op: string;
  ms: number;
  at: number;
}

/**
 * How a chat turn ended where the dashboard counts it (M24.2): stopped by the person, or at the step cap
 * (`TURN_STEP_LIMIT`), so the cap is raised on evidence or not at all.
 */
export interface TurnEndRow {
  person: string;
  chatId: string;
  turnId: string;
  outcome: "stopped" | "step_limit";
  steps: number;
  at: number;
}

/** The terminal signal of a run (milestones.md M5). */
export type RunSignal = "nothing_to_report" | "notify" | "failed" | "blocked";

export type RunPhase = "executing" | "awaiting_approval" | "retry_wait" | "done";

/** One job run, as the `Job` keeps it and mirrors it to the `Ledger`. */
export interface RunRow {
  runId: string;
  jobId: string;
  person: string;
  scheduledFor: number;
  phase: RunPhase;
  attempt: number;
  step: number;
  leaseUntil: number | null;
  timeoutAt: number | null;
  tokens: number;
  costMicros: number;
  /** Browser milliseconds the Ledger holds for this run (M25.4); the Ledger fills it. */
  browserMs?: number;
  signal: RunSignal | null;
  code: string | null;
  reason: string | null;
  nextProbe: number | null;
  startedAt: number;
  updatedAt: number;
}
