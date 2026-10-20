// Company policies an admin sets beside the deny policies (authority-model.md "Roles and teams",
// M10.2): seats, budgets, the model tier and which agents are disabled, in the `Company` object's
// SQLite. The `Company` owns them and pushes each change to the `Ledger`, which enforces them before
// every model call; seats are enforced here, at the invitation.
import { type Budgets, type CompanyPolicy, DEFAULT_POLICY, isBudgetKey } from "../ledger/budget.ts";
import { isModelTier, type ModelTier } from "../model/routes.ts";
import { type CompanyMembers, isAdminRole, normalizeEmail } from "./members.ts";

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, by TEXT NOT NULL, at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS disabled_agents (email TEXT PRIMARY KEY, by TEXT NOT NULL, at INTEGER NOT NULL);`;

export interface CompanySettingsView {
  /** At most this many members; null is no limit. */
  seats: number | null;
  /** The daily caps in force, in micro-dollars: what an admin set, else the environment's defaults (M28.1). */
  budgets: Budgets;
  /** Only the caps an admin set; the rest are the defaults. This, never `budgets`, is what the Ledger is given. */
  budgetsSet: Partial<Budgets>;
  modelTier: ModelTier;
  disabled: string[];
  /** Offboarding (M11): whether a departing member's export and conversion keep their pages about members; true by default. */
  memberPagesInExport: boolean;
}

type Refusal = { ok: false; code: string; reason: string };
const notAdmin: Refusal = { ok: false, code: "NOT_AN_ADMIN", reason: "only an admin sets company policies" };
const MAX_SEATS = 10_000;
/** $100,000 a day. */
const MAX_MICROS = 100_000_000_000;

export class CompanySettings {
  private readonly storage: Pick<DurableObjectStorage, "sql">;
  private readonly members: CompanyMembers;
  private readonly now: () => number;
  private readonly defaults: Budgets;

  /** `defaults` are the daily caps (`DEFAULT_BUDGETS`), shown for what an admin did not set and never pushed. */
  constructor(storage: Pick<DurableObjectStorage, "sql">, members: CompanyMembers, now: () => number, defaults: Budgets) {
    this.storage = storage;
    this.members = members;
    this.now = now;
    this.defaults = defaults;
  }

  private get sql(): SqlStorage {
    return this.storage.sql;
  }

  private value(key: string): unknown {
    const raw = this.sql.exec<{ value: string }>("SELECT value FROM settings WHERE key = ?", key).toArray()[0]?.value;
    return raw === undefined ? undefined : JSON.parse(raw);
  }

  view(): CompanySettingsView {
    const seats = this.value("seats");
    const stored = (this.value("budgets") ?? {}) as Record<string, unknown>;
    const budgetsSet: Partial<Budgets> = Object.fromEntries(Object.entries(stored).filter(([k, v]) => isBudgetKey(k) && Number.isSafeInteger(v)));
    const tier = this.value("modelTier");
    const pages = this.value("memberPagesInExport");
    return {
      seats: typeof seats === "number" ? seats : null,
      budgets: { ...this.defaults, ...budgetsSet },
      budgetsSet,
      modelTier: isModelTier(tier) ? tier : DEFAULT_POLICY.modelTier,
      memberPagesInExport: pages !== false,
      // A disabled member who left the company is no longer listed; their row stays until re-enabled.
      disabled: this.sql.exec<{ email: string }>("SELECT email FROM disabled_agents ORDER BY email").toArray().map((r) => r.email).filter((e) => !!this.members.lookup(e)),
    };
  }

  /** What the Ledger enforces. */
  policy(view = this.view()): CompanyPolicy {
    return { budgets: view.budgetsSet, modelTier: view.modelTier, disabled: view.disabled };
  }

  /**
   * The settings an admin would have after `input`, checked, without storing them: the `Company`
   * pushes the policy to the `Ledger` first and stores only what the Ledger took.
   */
  propose(by: string, input: unknown): { ok: true; next: CompanySettingsView; changes: Record<string, unknown> } | Refusal {
    if (!isAdminRole(this.members.lookup(by)?.role)) return notAdmin;
    const i = (input ?? {}) as Record<string, unknown>;
    const current = this.view();
    const changes: Record<string, unknown> = {};
    if (i.seats !== undefined) {
      if (i.seats !== null && !(Number.isSafeInteger(i.seats) && (i.seats as number) >= 1 && (i.seats as number) <= MAX_SEATS)) return { ok: false, code: "SETTINGS_INVALID", reason: `seats are 1 to ${MAX_SEATS}, or null for no limit` };
      if (typeof i.seats === "number" && i.seats < this.members.list().length) return { ok: false, code: "SEATS_BELOW_MEMBERS", reason: `the company has ${this.members.list().length} members` };
      changes.seats = i.seats;
    }
    if (i.budgets !== undefined) {
      const b = (i.budgets ?? {}) as Record<string, unknown>;
      const next: Partial<Budgets> = { ...current.budgetsSet };
      for (const key of Object.keys(b)) {
        if (!isBudgetKey(key)) return { ok: false, code: "SETTINGS_INVALID", reason: `unknown budget ${key}; the daily caps are personDailyMicros and tenantDailyMicros, in micro-dollars` };
        const v = b[key];
        // null clears an admin's cap back to the environment's default.
        if (v === null) {
          delete next[key];
          continue;
        }
        if (!Number.isSafeInteger(v) || (v as number) < 0 || (v as number) > MAX_MICROS) return { ok: false, code: "SETTINGS_INVALID", reason: `${key} is 0 to ${MAX_MICROS} micro-dollars ($${MAX_MICROS / 1_000_000} a day), or null for the default` };
        next[key] = v as number;
      }
      changes.budgets = next;
    }
    if (i.modelTier !== undefined) {
      if (!isModelTier(i.modelTier)) return { ok: false, code: "SETTINGS_INVALID", reason: "the model tier is economy or standard" };
      changes.modelTier = i.modelTier;
    }
    if (i.memberPagesInExport !== undefined) {
      if (typeof i.memberPagesInExport !== "boolean") return { ok: false, code: "SETTINGS_INVALID", reason: "memberPagesInExport is true or false" };
      changes.memberPagesInExport = i.memberPagesInExport;
    }
    const budgetsSet = (changes.budgets as Partial<Budgets> | undefined) ?? current.budgetsSet;
    return { ok: true, next: { ...current, ...(changes as Partial<CompanySettingsView>), budgetsSet, budgets: { ...this.defaults, ...budgetsSet } }, changes };
  }

  store(by: string, changes: Record<string, unknown>): void {
    for (const [key, value] of Object.entries(changes)) {
      this.sql.exec("INSERT INTO settings (key, value, by, at) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, by = excluded.by, at = excluded.at", key, JSON.stringify(value), normalizeEmail(by), this.now());
    }
  }

  /** The disabled list after one admin's change, checked; stored by `storeDisabled` once the Ledger took it. */
  proposeDisabled(by: string, email: string, disabled: boolean): { ok: true; next: CompanySettingsView } | Refusal {
    if (!isAdminRole(this.members.lookup(by)?.role)) return { ok: false, code: "NOT_AN_ADMIN", reason: "only an admin disables an agent" };
    const target = this.members.lookup(email);
    if (!target) return { ok: false, code: "NOT_A_MEMBER", reason: "no such member" };
    const current = this.view();
    const set = new Set(current.disabled);
    if (disabled) set.add(target.email);
    else set.delete(target.email);
    return { ok: true, next: { ...current, disabled: [...set].sort() } };
  }

  storeDisabled(by: string, email: string, disabled: boolean): void {
    if (disabled) this.sql.exec("INSERT OR REPLACE INTO disabled_agents (email, by, at) VALUES (?, ?, ?)", normalizeEmail(email), normalizeEmail(by), this.now());
    else this.sql.exec("DELETE FROM disabled_agents WHERE email = ?", normalizeEmail(email));
  }

  /** Whether one more member fits the seats. */
  seatFree(): boolean {
    const seats = this.view().seats;
    return seats === null || this.members.list().length < seats;
  }
}
