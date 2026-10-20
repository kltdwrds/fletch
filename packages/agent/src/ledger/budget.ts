// Budget decisions and prices (AD-11, M5.1). Pure: the Ledger object passes the sums it read, so the
// order of the checks and their codes are tested without storage.
import { DEFAULT_TIER, MODEL_TIERS, type ModelTier } from "../model/routes.ts";
import type { Admission, AdmitResult } from "./types.ts";

/** Daily caps in millionths of a US dollar (M28.1); an admin sets them through the Company's policies. */
export interface Budgets {
  tenantDailyMicros: number;
  personDailyMicros: number;
}
export const BUDGET_KEYS = ["tenantDailyMicros", "personDailyMicros"] as const satisfies ReadonlyArray<keyof Budgets>;
export const isBudgetKey = (k: string): k is keyof Budgets => (BUDGET_KEYS as readonly string[]).includes(k);

/** The product's defaults: $2 a person and $20 a company a day (DECISIONS-LOG, M28.1). */
export const DEFAULT_BUDGETS: Budgets = { tenantDailyMicros: 20_000_000, personDailyMicros: 2_000_000 };

/** Dollars from micros for a reason or a page: whole cents as cents, anything finer to the micro-dollar. */
export function dollars(micros: number): string {
  const d = micros / 1_000_000;
  return `$${micros % 10_000 === 0 ? d.toFixed(2) : d.toFixed(6).replace(/0+$/, "")}`;
}

/**
 * Unit prices in US dollars per million tokens, from each model's page (glm-5.3-flash fetched
 * 2026-10-12: $0.15 input, $0.50 output, $0.03 cached input; bge-base-en-v1.5 from the Workers AI
 * pricing page 2026-10-13: $0.067 input, embeddings have no output; OpenRouter's z-ai/glm-5.3-flash at
 * the price most of its hosts list, the latency research's endpoints listing of 2026-10-15). A model
 * without a listed price is costed at zero here and says so through `priced: false`; the Ledger then
 * charges `chargeMicros` instead (M28.1). A row whose provider gave its own cost (OpenRouter's usage,
 * M22.1) is costed at that instead.
 */
export const PRICES: Record<string, { input: number; output: number; cached: number }> = {
  "@cf/zai-org/glm-5.3-flash": { input: 0.15, output: 0.5, cached: 0.03 },
  "z-ai/glm-5.3-flash": { input: 0.15, output: 0.5, cached: 0.03 },
  "@cf/baai/bge-base-en-v1.5": { input: 0.067, output: 0, cached: 0.067 },
};

/** Cost in millionths of a dollar: uncached input, cached input and output at their own prices. */
export function costMicros(model: string, tokens: { input: number; output: number; cached: number }): { micros: number; priced: boolean } {
  const p = PRICES[model];
  if (!p) return { micros: 0, priced: false };
  const uncached = Math.max(0, tokens.input - tokens.cached);
  return { micros: Math.round(uncached * p.input + tokens.cached * p.cached + tokens.output * p.output), priced: true };
}

/**
 * What an unpriced call is charged against the dollar caps (M28.1): a frontier-class price, so a model
 * the table lacks can only over-count, never pass as free.
 */
export const UNPRICED_FALLBACK = { input: 3, output: 15, cached: 0.3 };

/** The cost a call is charged: its price, else the fallback. */
export function chargeMicros(model: string, tokens: { input: number; output: number; cached: number }): number {
  const priced = costMicros(model, tokens);
  if (priced.priced) return priced.micros;
  const p = UNPRICED_FALLBACK;
  const uncached = Math.max(0, tokens.input - tokens.cached);
  return Math.round(uncached * p.input + tokens.cached * p.cached + tokens.output * p.output);
}

export const isPriced = (model: string): boolean => Object.hasOwn(PRICES, model);

/** The run's tokens (its ceiling stays in tokens), and the person's and the tenant's day in micros. */
export interface Spent {
  run: number;
  personMicros: number;
  tenantMicros: number;
}

/** What the Company's policies hand the Ledger to enforce before every call (M10.2). */
export interface CompanyPolicy {
  /** Only the caps an admin set (M28.1); the Ledger's environment default covers the rest. */
  budgets: Partial<Budgets>;
  modelTier: ModelTier;
  /** Members whose agent an admin disabled: no call of theirs is admitted. */
  disabled: string[];
}

export const DEFAULT_POLICY: Omit<CompanyPolicy, "budgets"> = { modelTier: DEFAULT_TIER, disabled: [] };

/** A disabled agent first, then the model tier, then a model with no price (M28.1); budgets follow in `decide`. */
export function admitPolicy(policy: Pick<CompanyPolicy, "modelTier" | "disabled">, a: Admission): AdmitResult {
  if (policy.disabled.includes(a.person)) return { ok: false, code: "AGENT_DISABLED", reason: "an admin has disabled this agent" };
  const allowed: readonly string[] = MODEL_TIERS[policy.modelTier];
  if (a.model !== undefined && !allowed.includes(a.model)) return { ok: false, code: "MODEL_TIER_REFUSED", reason: `${a.model} is outside the company's ${policy.modelTier} tier` };
  if (a.model !== undefined && !isPriced(a.model)) return { ok: false, code: "MODEL_UNPRICED", reason: `${a.model} has no price, so its spend cannot be counted against the daily caps` };
  return { ok: true };
}

/** The run's ceiling first, then the person's day, then the tenant's day. */
export function decide(spent: Spent, budgets: Budgets, ceiling: number | undefined): AdmitResult {
  if (ceiling !== undefined && spent.run >= ceiling) return { ok: false, code: "RUN_CEILING_REACHED", reason: `the run has used ${spent.run} of its ${ceiling} tokens` };
  if (spent.personMicros >= budgets.personDailyMicros) return { ok: false, code: "BUDGET_PERSON_EXHAUSTED", reason: `this person has spent ${dollars(spent.personMicros)} of ${dollars(budgets.personDailyMicros)} today` };
  if (spent.tenantMicros >= budgets.tenantDailyMicros) return { ok: false, code: "BUDGET_TENANT_EXHAUSTED", reason: `the tenant has spent ${dollars(spent.tenantMicros)} of ${dollars(budgets.tenantDailyMicros)} today` };
  return { ok: true };
}

/** The UTC day a timestamp falls in, as budgets count it. */
export function utcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function dayStart(ms: number): number {
  return Date.parse(`${utcDay(ms)}T00:00:00.000Z`);
}
