// The Ledger object, one per tenant (AD-1, AD-11): a row per model call with tenant, person, run
// id, route, tokens and cost; a row per job run; and the budgets enforced before every call (M5.1):
// the run's token ceiling, the person's and the tenant's day in dollars (M28.1), and in staging the cap across tenants that
// the dispatcher's `Budget` entrypoint keeps, to which every recorded call reports the day's total.
import { DurableObject } from "cloudflare:workers";
import { checkJournalRow, type JournalRow } from "../grants/journal.ts";
import { admitPolicy, BUDGET_KEYS, type Budgets, chargeMicros, type CompanyPolicy, dayStart, decide, defaultBudgets, isBudgetKey, utcDay } from "../ledger/budget.ts";
import { computeRollup, type DeliveryCounts, dayBounds, type PlatformRollup, platformRollup, type Rollup } from "../ledger/rollup.ts";
import type { Admission, AdmitResult, BrowserRow, LedgerSink, ModelCallRow, RunRow, TurnEndRow } from "../ledger/types.ts";
import { DEFAULT_TIER, isModelTier } from "../model/routes.ts";
import { queryLedgerView } from "../views/ledger-views.ts";
import type { ViewInput, ViewResult } from "../views/select.ts";
import { migrateObject, probeObject } from "../migrations/catalog.ts";


type Row = {
  tenant: string;
  person: string;
  run_id: string;
  route: ModelCallRow["route"];
  model: string;
  provider: string | null;
  attempt: number;
  status: ModelCallRow["status"];
  code: string | null;
  http_status: number | null;
  input_tokens: number;
  output_tokens: number;
  reasoning_tokens: number;
  cached_tokens: number;
  cost_micros: number;
  at: number;
  started_at: number | null;
  first_token_at: number | null;
  finished_at: number | null;
};

/** The dispatcher's budget entrypoint as the agent binds it (tenant in props). */
export interface StagingBudget {
  report(day: string, total: number): Promise<{ ok: boolean }>;
  check(day: string): Promise<{ ok: true } | { ok: false; code: string; reason: string }>;
}

export class Ledger extends DurableObject<Env> implements LedgerSink {
  private readonly schema = migrateObject(this.ctx, "ledger");

  /** The sweep's wake (M25.3): what this wake applied and what is still behind. */
  async migrationProbe() { return probeObject(this.ctx.storage, this.schema); }
  /** The clock; tests replace it on the instance rather than waiting. */
  now: () => number = () => Date.now();

  private get sql(): SqlStorage {
    return this.ctx.storage.sql;
  }

  /** Staging's cap applies in staging only; elsewhere there is no cross-tenant counter. */
  private get staging(): StagingBudget | null {
    return this.env.QYVR_ENV === "staging" && this.env.BUDGET ? (this.env.BUDGET as unknown as StagingBudget) : null;
  }

  async fetch(): Promise<Response> {
    return Response.json({ code: "NOT_IMPLEMENTED", object: "Ledger" }, { status: 501 });
  }

  async record(row: ModelCallRow): Promise<void> {
    // The provider's own cost where its usage gave one (M22.1), else the price table's, else the unpriced fallback (M28.1).
    const cost = row.costMicros !== undefined && Number.isFinite(row.costMicros) && row.costMicros >= 0
      ? Math.round(row.costMicros)
      : chargeMicros(row.model, { input: row.inputTokens, output: row.outputTokens, cached: row.cachedTokens });
    this.sql.exec(
      "INSERT INTO model_calls (tenant, person, run_id, route, model, provider, attempt, status, code, http_status, input_tokens, output_tokens, reasoning_tokens, cached_tokens, cost_micros, at, started_at, first_token_at, finished_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      row.tenant, row.person, row.runId, row.route, row.model, row.provider ?? null, row.attempt, row.status, row.code, row.httpStatus,
      row.inputTokens, row.outputTokens, row.reasoningTokens, row.cachedTokens, cost, row.at,
      row.startedAt, row.firstTokenAt, row.finishedAt,
    );
    const staging = this.staging;
    if (staging && row.inputTokens + row.outputTokens > 0) {
      // The day's total is cumulative, so a report lost here is corrected by the next one.
      await staging.report(utcDay(row.at), this.tokensSince(dayStart(row.at))).catch(() => undefined);
    }
  }

  /** Whether a call may be made now: the run's ceiling, the person's day, the tenant's day, staging's cap. */
  async admit(a: Admission): Promise<AdmitResult> {
    const now = this.now();
    const policy = admitPolicy(this.policy(), a);
    if (!policy.ok) return policy;
    const since = dayStart(now);
    const local = decide(
      { run: this.tokensWhere("run_id = ? AND person = ?", a.runId, a.person), personMicros: this.microsWhere("person = ? AND at >= ?", a.person, since), tenantMicros: this.microsWhere("at >= ?", since) },
      this.budgets(),
      a.ceiling,
    );
    if (!local.ok) return local;
    const staging = this.staging;
    if (!staging) return local;
    try {
      const cap = await staging.check(utcDay(now));
      return cap.ok ? local : { ok: false, code: "BUDGET_STAGING_CAP", reason: cap.reason };
    } catch (err) {
      // A cap that cannot be read refuses: an unaccounted call is never the default.
      return { ok: false, code: "BUDGET_UNAVAILABLE", reason: `the staging cap could not be read: ${String(err)}` };
    }
  }

  /** The daily caps in force: what the Company set, else this environment's defaults (M28.1). */
  budgets(): Budgets {
    return { ...defaultBudgets(this.env.QYVR_ENV), ...this.budgetsSet() };
  }

  /** Only the caps the Company set; a stored key that is not a cap is ignored. */
  budgetsSet(): Partial<Budgets> {
    const rows = this.sql.exec<{ key: string; value: number }>("SELECT key, value FROM budgets").toArray();
    return Object.fromEntries(rows.filter((r) => isBudgetKey(r.key)).map((r) => [r.key, r.value]));
  }

  /** The model tier and disabled agents the Company last set; the defaults until it sets any. */
  policy(): Omit<CompanyPolicy, "budgets"> {
    const set = new Map(this.sql.exec<{ key: string; value: string }>("SELECT key, value FROM company_policy").toArray().map((r) => [r.key, JSON.parse(r.value) as unknown]));
    const tier = set.get("modelTier");
    const disabled = set.get("disabled");
    return { modelTier: isModelTier(tier) ? tier : DEFAULT_TIER, disabled: Array.isArray(disabled) ? disabled.map(String) : [] };
  }

  /**
   * The Company's policies, pushed on every change (M10.2); this store enforces them before every call.
   * The budgets pushed are exactly the caps an admin set (M28.1): the stored set is replaced by them, so
   * a cap not pushed falls back to this environment's default.
   */
  async setCompanyPolicy(p: CompanyPolicy): Promise<CompanyPolicy> {
    if (!isModelTier(p.modelTier) || !Array.isArray(p.disabled)) throw new Error("COMPANY_POLICY_INVALID: a tier and a list of disabled agents");
    const budgets = checkBudgets(p.budgets ?? {});
    this.ctx.storage.transactionSync(() => {
      this.sql.exec("INSERT INTO company_policy (key, value) VALUES ('modelTier', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", JSON.stringify(p.modelTier));
      this.sql.exec("INSERT INTO company_policy (key, value) VALUES ('disabled', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", JSON.stringify(p.disabled.map(String)));
      this.sql.exec("DELETE FROM budgets");
      for (const [key, value] of Object.entries(budgets)) this.sql.exec("INSERT INTO budgets (key, value) VALUES (?, ?)", key, value);
    });
    return { budgets: this.budgetsSet(), ...this.policy() };
  }

  /** Sets some of the tenant's caps and keeps the others; tests and the Company's push alike go through `checkBudgets`. */
  async setBudgets(b: Partial<Budgets>): Promise<Budgets> {
    for (const [key, value] of Object.entries(checkBudgets(b))) {
      this.sql.exec("INSERT INTO budgets (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", key, value);
    }
    return this.budgets();
  }

  /** Upserts a job run's row; the `Job` is its owner and calls this on every phase change. */
  async recordRun(run: RunRow): Promise<void> {
    const spent = this.sql.exec<{ tokens: number; cost: number }>("SELECT COALESCE(SUM(input_tokens + output_tokens), 0) AS tokens, COALESCE(SUM(cost_micros), 0) AS cost FROM model_calls WHERE run_id = ? AND person = ?", run.runId, run.person).one();
    const row: RunRow = { ...run, tokens: spent?.tokens ?? 0, costMicros: spent?.cost ?? 0, browserMs: this.browserMsWhere("run_id = ? AND person = ?", run.runId, run.person) };
    this.sql.exec(
      "INSERT INTO job_runs (run_id, job_id, person, scheduled_for, body, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(person, run_id) DO UPDATE SET body = excluded.body, updated_at = excluded.updated_at",
      run.runId, run.jobId, run.person, run.scheduledFor, JSON.stringify(row), run.updatedAt,
    );
  }

  async runs(filter: { jobId?: string; person?: string } = {}): Promise<RunRow[]> {
    return this.sql
      .exec<{ body: string }>("SELECT body FROM job_runs ORDER BY scheduled_for, run_id, person")
      .toArray()
      .map((r) => JSON.parse(r.body) as RunRow)
      .filter((r) => (filter.jobId ? r.jobId === filter.jobId : true) && (filter.person ? r.person === filter.person : true));
  }

  async modelCalls(filter: { runId?: string; person?: string } = {}): Promise<Array<ModelCallRow & { costMicros: number }>> {
    const rows = this.sql.exec<Row>("SELECT * FROM model_calls ORDER BY id").toArray();
    return rows
      .map((r) => ({
        tenant: r.tenant, person: r.person, runId: r.run_id, route: r.route, model: r.model, provider: r.provider, attempt: r.attempt, status: r.status,
        code: r.code, httpStatus: r.http_status, inputTokens: r.input_tokens, outputTokens: r.output_tokens,
        reasoningTokens: r.reasoning_tokens, cachedTokens: r.cached_tokens, costMicros: r.cost_micros, at: r.at,
        startedAt: r.started_at, firstTokenAt: r.first_token_at, finishedAt: r.finished_at,
      }))
      .filter((r) => (filter.runId ? r.runId === filter.runId : true) && (filter.person ? r.person === filter.person : true));
  }

  /** Browser time for a run (M25.4): one row per call, summed into the run's row and read back by `browserMs`. */
  async recordBrowser(row: BrowserRow): Promise<void> {
    if (!Number.isFinite(row.ms) || row.ms < 0) throw new Error(`BROWSER_ROW_INVALID: ms ${row.ms}`);
    this.sql.exec("INSERT INTO browser_usage (tenant, person, run_id, op, ms, at) VALUES (?, ?, ?, ?, ?, ?)", row.tenant, row.person, row.runId, row.op, Math.round(row.ms), row.at);
  }

  /** Browser milliseconds, for one run, one person, or every row. */
  async browserMs(filter: { runId?: string; person?: string } = {}): Promise<number> {
    return this.browserMsWhere(`1 = 1${filter.runId ? " AND run_id = ?" : ""}${filter.person ? " AND person = ?" : ""}`, ...[filter.runId, filter.person].filter((x): x is string => x !== undefined));
  }

  private browserMsWhere(where: string, ...bindings: string[]): number {
    return this.sql.exec<{ t: number }>(`SELECT COALESCE(SUM(ms), 0) AS t FROM browser_usage WHERE ${where}`, ...bindings).one()?.t ?? 0;
  }

  /** A chat turn that ended stopped or at the step cap (M24.2); a second report of the same turn changes nothing. */
  async turnEnded(row: TurnEndRow): Promise<void> {
    if (row.outcome !== "stopped" && row.outcome !== "step_limit") throw new Error(`TURN_END_INVALID: outcome ${JSON.stringify(row.outcome)}`);
    this.sql.exec(
      "INSERT INTO turn_ends (person, chat_id, turn_id, outcome, steps, at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(chat_id, turn_id) DO NOTHING",
      row.person, row.chatId, row.turnId, row.outcome, row.steps, row.at,
    );
  }

  /** Turn ends, one person's or every row. */
  async turnEnds(filter: { person?: string } = {}): Promise<TurnEndRow[]> {
    type R = { person: string; chat_id: string; turn_id: string; outcome: TurnEndRow["outcome"]; steps: number; at: number };
    const rows = filter.person
      ? this.sql.exec<R>("SELECT * FROM turn_ends WHERE person = ? ORDER BY at, rowid", filter.person).toArray()
      : this.sql.exec<R>("SELECT * FROM turn_ends ORDER BY at, rowid").toArray();
    return rows.map((r) => ({ person: r.person, chatId: r.chat_id, turnId: r.turn_id, outcome: r.outcome, steps: r.steps, at: r.at }));
  }

  /**
   * `db_query` over the Ledger's views (M24.2) for one person: the chat binds its owner, and every view
   * reads that person's rows alone, whatever the statement names.
   */
  async queryView(person: string, input: ViewInput): Promise<ViewResult> {
    return queryLedgerView(this.sql, person, input);
  }

  /**
   * One journal row (M7.1), written once per id: the decision and outcome of one proposed action,
   * content-free by `checkJournalRow`, which refuses any field that is not an identifier or a code.
   */
  async journal(row: JournalRow): Promise<{ ok: true; duplicate: boolean } | { ok: false; code: "JOURNAL_ROW_INVALID"; reason: string }> {
    const checked = checkJournalRow(row);
    if (!checked.ok) return checked;
    const before = this.sql.exec("SELECT id FROM journal WHERE id = ?", row.id).toArray().length;
    if (before) return { ok: true, duplicate: true };
    this.sql.exec("INSERT INTO journal (id, principal, at, body) VALUES (?, ?, ?, ?)", row.id, row.principal, row.at, JSON.stringify(row));
    return { ok: true, duplicate: false };
  }

  /** Journal rows, one principal's or every row; an admin reaches them only through the `Company`, which checks the role (M10.1). */
  async journalRows(filter: { principal?: string } = {}): Promise<JournalRow[]> {
    const rows = filter.principal
      ? this.sql.exec<{ body: string }>("SELECT body FROM journal WHERE principal = ? ORDER BY at, id", filter.principal).toArray()
      : this.sql.exec<{ body: string }>("SELECT body FROM journal ORDER BY at, id").toArray();
    return rows.map((r) => JSON.parse(r.body) as JournalRow);
  }

  /**
   * The dashboard's numbers for `[from, to)` (M15.3), for the whole tenant or one person; the caller
   * brings each person's delivery counts, which their own `Person` keeps. Read only.
   */
  async dashboard(range: { from: number; to: number; person?: string }, deliveries: DeliveryCounts[]): Promise<Rollup> {
    const p = range.person;
    const calls = (await this.modelCalls(p ? { person: p } : {})).filter((c) => c.at >= range.from && c.at < range.to);
    const runs = await this.runs(p ? { person: p } : {});
    const journal = await this.journalRows(p ? { principal: p } : {});
    const turnEnds = await this.turnEnds(p ? { person: p } : {});
    return computeRollup({ from: range.from, to: range.to, calls, runs, journal, turnEnds, deliveries: p ? deliveries.filter((d) => d.person === p) : deliveries });
  }

  /**
   * The sweeper's daily rollup (M15.3): the day's numbers kept here, in the tenant, and the part with
   * no person named returned for the platform's rollups. Re-running a day replaces its row.
   */
  async rollup(day: string, deliveries: DeliveryCounts[]): Promise<{ ok: true; rollup: PlatformRollup } | { ok: false; code: "ROLLUP_DAY_INVALID"; reason: string }> {
    const bounds = dayBounds(day);
    if (!bounds) return { ok: false, code: "ROLLUP_DAY_INVALID", reason: "day must be YYYY-MM-DD" };
    const r = await this.dashboard(bounds, deliveries);
    this.sql.exec("INSERT INTO rollups (day, body, at) VALUES (?, ?, ?) ON CONFLICT(day) DO UPDATE SET body = excluded.body, at = excluded.at", day, JSON.stringify(r), this.now());
    return { ok: true, rollup: platformRollup(this.env.TENANT_ID, day, r) };
  }

  /** The kept daily rollups, oldest first. */
  async rollups(): Promise<Array<{ day: string; rollup: Rollup }>> {
    return this.sql.exec<{ day: string; body: string }>("SELECT day, body FROM rollups ORDER BY day").toArray().map((r) => ({ day: r.day, rollup: JSON.parse(r.body) as Rollup }));
  }

  /** Tokens one loop spent for one owner since `since`: its runs' ids are `loop:<id>:<slot>` (M12). */
  async loopSpend(person: string, loop: string, since: number): Promise<number> {
    return this.tokensWhere("person = ? AND run_id LIKE ? AND at >= ?", person, `loop:${loop}:%`, since);
  }

  private microsWhere(where: string, ...bindings: Array<string | number>): number {
    return this.sql.exec<{ t: number }>(`SELECT COALESCE(SUM(cost_micros), 0) AS t FROM model_calls WHERE ${where}`, ...bindings).one()?.t ?? 0;
  }

  private tokensSince(since: number): number {
    return this.tokensWhere("at >= ?", since);
  }

  private tokensWhere(where: string, ...bindings: Array<string | number>): number {
    return this.sql.exec<{ t: number }>(`SELECT COALESCE(SUM(input_tokens + output_tokens), 0) AS t FROM model_calls WHERE ${where}`, ...bindings).one()?.t ?? 0;
  }
}

/** A set of caps the Ledger stores: dollar-cap keys only, each a whole number of micros, zero or more. */
function checkBudgets(b: Partial<Budgets>): Partial<Budgets> {
  const out: Partial<Budgets> = {};
  for (const [key, value] of Object.entries(b)) {
    if (!isBudgetKey(key)) throw new Error(`BUDGETS_INVALID: ${key} is not one of ${BUDGET_KEYS.join(", ")}`);
    if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error(`BUDGETS_INVALID: ${key} is a whole number of micro-dollars, zero or more`);
    out[key] = value as number;
  }
  return out;
}
