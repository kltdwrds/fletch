// M28.1: daily caps per person and per tenant in dollars, enforced by the Ledger from each call's cost; the Company pushes
// only the caps an admin set, so the environment's defaults hold until one is set (the bug that kept stopping UAT on
// staging); stored token budgets deleted by named migrations; an unpriced model never counted as free. Two members of
// solo-sam throughout.
import { describe, expect, it } from "vitest";
import { failureText } from "../../packages/agent/src/chat/failure-words.ts";
import { chargeMicros, DEFAULT_BUDGETS, dollars } from "../../packages/agent/src/ledger/budget.ts";
import type { ModelCallRow } from "../../packages/agent/src/ledger/types.ts";
import { COMPANY_MIGRATIONS, LEDGER_MIGRATIONS } from "../../packages/agent/src/migrations/catalog.ts";
import { migrate } from "../../packages/agent/src/migrations/engine.ts";
import { ROUTES } from "../../packages/agent/src/model/routes.ts";
import { Ledger } from "../../packages/agent/src/objects/ledger.ts";
import { ObjectHarness } from "../support/object-harness.ts";
import { ada, authorityWorld, T0 } from "./support/authority-world.ts";

const GLM = "@cf/zai-org/glm-5.3-flash";

/** A finished call of `person`'s: GLM output at $0.50 a million, so `micros` micro-dollars is `micros * 2` output tokens. */
const call = (person: string, micros: number, at = T0, extra: Partial<ModelCallRow> = {}): ModelCallRow => ({
  tenant: "solo-sam", person, runId: `r-${person}-${at}`, route: "chat", model: GLM, attempt: 1, status: "ok", code: null, httpStatus: 200,
  inputTokens: 0, outputTokens: micros * 2, reasoningTokens: 0, cachedTokens: 0, at, startedAt: null, firstTokenAt: null, finishedAt: null, ...extra,
});

type Storage = Parameters<typeof migrate>[0];
const storageOf = (o: object) => (o as unknown as { ctx: { storage: Storage } }).ctx.storage;

describe("[M28.1] the defaults", () => {
  it("the default is $2 a person and $20 a tenant a day, and the amounts read as dollars", () => {
    expect(DEFAULT_BUDGETS).toEqual({ personDailyMicros: 2_000_000, tenantDailyMicros: 20_000_000 });
    expect([dollars(2_000_000), dollars(2_000_400), dollars(150), dollars(0), dollars(4_010_000)]).toEqual(["$2.00", "$2.0004", "$0.00015", "$0.00", "$4.01"]);
  });
});

describe("[M28.1] the Company stops overriding the environment", () => {
  it("a company whose admin changed the tier and disabled then re-enabled an agent still enforces the default $2 and $20", async () => {
    const w = authorityWorld();
    expect((await w.http(ada.email, "PUT", "/admin/settings", { modelTier: "economy" })).status).toBe(200);
    // The regression: each of those pushes carried the product's caps, and the Ledger stored them over the default.
    expect(w.ledger().budgetsSet()).toEqual({});
    expect(w.ledger().budgets()).toEqual(DEFAULT_BUDGETS);
    expect((await w.http(ada.email, "GET", "/admin/overview")).body).toMatchObject({ settings: { budgets: DEFAULT_BUDGETS, budgetsSet: {}, modelTier: "economy" } });
  });

  it("the person's day and the tenant's day refuse by dollars with the amounts in the reason, and the tokens stay recorded", async () => {
    const w = authorityWorld();
    const ledger = w.ledger();
    await ledger.setBudgets({ tenantDailyMicros: 4_000_000 });
    const admit = (person: string) => ledger.admit({ person, runId: `next-${person}`, model: ROUTES.chat });
    await ledger.record(call(ada.email, 1_999_999));
    expect(await admit(ada.email)).toEqual({ ok: true });
    await ledger.record(call(ada.email, 500_001, T0 + 1));
    expect(await admit(ada.email)).toEqual({ ok: false, code: "BUDGET_PERSON_EXHAUSTED", reason: "this person has spent $2.50 of $2.00 today" });
    // Bo's own day is untouched, and the tenant's $4 is not reached.
    expect(await admit(other.email)).toEqual({ ok: true });
    await ledger.record(call(other.email, 1_499_999, T0 + 2));
    expect(await admit(other.email)).toEqual({ ok: true });
    await ledger.record(call(other.email, 400, T0 + 3));
    // Bo has spent $1.500399 of a $2 day, but the company's day is spent for both.
    expect(await admit(other.email)).toEqual({ ok: false, code: "BUDGET_TENANT_EXHAUSTED", reason: "the tenant has spent $4.000399 of $4.00 today" });
    expect(await admit(ada.email)).toMatchObject({ ok: false, code: "BUDGET_PERSON_EXHAUSTED" });
    // The tokens behind the dollars are still each row's.
    const rows = await ledger.modelCalls({ person: other.email });
    expect(rows.map((r) => [r.outputTokens, r.costMicros])).toEqual([[2_999_998, 1_499_999], [800, 400]]);
    // The next UTC day starts afresh.
    w.clock.now = T0 + 86_400_000;
    expect(await admit(ada.email)).toEqual({ ok: true });
    // The chat's words for both stay the same, and name no code.
    for (const code of ["BUDGET_PERSON_EXHAUSTED", "BUDGET_TENANT_EXHAUSTED"]) expect(failureText(code)).toContain("daily allowance");
  });

  it("an admin's cap reaches the Ledger exactly, survives an unrelated change, and null clears it back to the default", async () => {
    const w = authorityWorld();
    expect(await w.http(other.email, "PUT", "/admin/settings", { budgets: { personDailyMicros: 1 } })).toMatchObject({ status: 403, body: { code: "NOT_AN_ADMIN" } });
    expect(await w.http(ada.email, "PUT", "/admin/settings", { budgets: { personDailyTokens: 1_000_000 } })).toMatchObject({ status: 400, body: { code: "SETTINGS_INVALID", reason: expect.stringContaining("personDailyMicros") } });
    expect(await w.http(ada.email, "PUT", "/admin/settings", { budgets: { personDailyMicros: 1.5 } })).toMatchObject({ status: 400, body: { code: "SETTINGS_INVALID" } });
    expect(w.ledger().budgetsSet()).toEqual({});

    const set = await w.http(ada.email, "PUT", "/admin/settings", { budgets: { personDailyMicros: 500_000 } });
    expect(set.body).toMatchObject({ settings: { budgets: { personDailyMicros: 500_000, tenantDailyMicros: DEFAULT_BUDGETS.tenantDailyMicros }, budgetsSet: { personDailyMicros: 500_000 } } });
    expect(w.ledger().budgetsSet()).toEqual({ personDailyMicros: 500_000 });
    await w.http(ada.email, "PUT", "/admin/settings", { modelTier: "economy" });
    expect(w.ledger().budgets()).toEqual({ personDailyMicros: 500_000, tenantDailyMicros: DEFAULT_BUDGETS.tenantDailyMicros });
    await w.ledger().record(call(other.email, 500_000));
    expect(await w.ledger().admit({ person: other.email, runId: "x" })).toMatchObject({ ok: false, code: "BUDGET_PERSON_EXHAUSTED", reason: expect.stringContaining("of $0.50 today") });

    const cleared = await w.http(ada.email, "PUT", "/admin/settings", { budgets: { personDailyMicros: null } });
    expect(cleared.body).toMatchObject({ settings: { budgets: DEFAULT_BUDGETS, budgetsSet: {} } });
    expect(w.ledger().budgetsSet()).toEqual({});
    expect(await w.ledger().admit({ person: other.email, runId: "x" })).toEqual({ ok: true });
  });

  it("the Ledger stores only dollar caps: a token key or a fraction is refused, and a push replaces the whole stored set", async () => {
    const w = authorityWorld();
    const ledger = w.ledger();
    await expect(ledger.setCompanyPolicy({ budgets: { personDailyTokens: 5 } as never, modelTier: "standard", disabled: [] })).rejects.toThrow(/BUDGETS_INVALID/);
    await expect(ledger.setBudgets({ tenantDailyMicros: -1 })).rejects.toThrow(/BUDGETS_INVALID/);
    await ledger.setBudgets({ personDailyMicros: 7, tenantDailyMicros: 9 });
    expect(await ledger.setCompanyPolicy({ budgets: { tenantDailyMicros: 11 }, modelTier: "standard", disabled: [] })).toMatchObject({ budgets: { tenantDailyMicros: 11 } });
    expect(ledger.budgets()).toEqual({ personDailyMicros: DEFAULT_BUDGETS.personDailyMicros, tenantDailyMicros: 11 });
  });
});

describe("[M28.1] an unpriced model is never free", () => {
  it("admission refuses a model with no price before any call, in words without the code", async () => {
    const w = authorityWorld();
    expect(await w.ledger().admit({ person: ada.email, runId: "s", model: ROUTES.smoke })).toEqual({ ok: false, code: "MODEL_UNPRICED", reason: `${ROUTES.smoke} has no price, so its spend cannot be counted against the daily caps` });
    expect(await w.ledger().admit({ person: other.email, runId: "s", model: ROUTES.chat })).toEqual({ ok: true });
    const words = failureText("MODEL_UNPRICED");
    expect(words).toContain("no price");
    expect(words).not.toMatch(/[A-Z]{3,}_[A-Z_]+/);
  });

  it("a row priced neither by the model that answered nor by the one asked for is charged at the fallback, and it counts toward the cap", async () => {
    const w = authorityWorld();
    const ledger = w.ledger();
    await ledger.setBudgets({ personDailyMicros: 18_000 });
    await ledger.record(call(ada.email, 0, T0, { model: "vendor/answered-as-another", inputTokens: 1_000, outputTokens: 1_000 }));
    // Answered under another name for a priced model: the asked model's price (D-0020), 150 + 500 micros.
    await ledger.record(call(other.email, 0, T0, { model: "vendor/answered-as-another", asked: ROUTES.chat, inputTokens: 1_000, outputTokens: 1_000 }));
    expect((await ledger.modelCalls()).map((r) => [r.person, r.costMicros])).toEqual([[ada.email, 18_000], [other.email, 650]]);
    expect(chargeMicros("vendor/answered-as-another", { input: 1_000, output: 1_000, cached: 0 })).toBe(18_000);
    expect(await ledger.admit({ person: ada.email, runId: "n" })).toMatchObject({ ok: false, code: "BUDGET_PERSON_EXHAUSTED" });
    expect(await ledger.admit({ person: other.email, runId: "n" })).toEqual({ ok: true });
  });
});

describe("[M28.1] the token budgets are migrated away", () => {
  it("ledger.budgets-dollars deletes stored token caps, keeps a dollar cap, and a second run applies nothing", () => {
    const h = new ObjectHarness("ledger-m28", (ctx, e) => new Ledger(ctx as DurableObjectState, e as Env), {});
    void h.instance;
    h.db.exec("INSERT INTO budgets (key, value) VALUES ('tenantDailyTokens', 1000000), ('personDailyTokens', 250000), ('personDailyMicros', 3000000)");
    h.db.exec("DELETE FROM migrations WHERE name = 'ledger.budgets-dollars'");
    const storage = storageOf(h.instance);
    expect(migrate(storage, LEDGER_MIGRATIONS)).toEqual({ applied: ["ledger.budgets-dollars"] });
    expect(h.rows("SELECT key, value FROM budgets ORDER BY key")).toEqual([{ key: "personDailyMicros", value: 3_000_000 }]);
    expect(h.instance.budgets()).toEqual({ personDailyMicros: 3_000_000, tenantDailyMicros: DEFAULT_BUDGETS.tenantDailyMicros });
    expect(migrate(storage, LEDGER_MIGRATIONS)).toEqual({ applied: [] });
    expect(h.rows("SELECT release FROM migrations WHERE name = 'ledger.budgets-dollars'")).toEqual([{ release: "m28.1" }]);
  });

  it("company.settings-budgets-dollars deletes the stored token budgets, so the overview shows the defaults, and a second run applies nothing", async () => {
    const w = authorityWorld();
    void w.company();
    const h = w.companyHarness();
    const storage = storageOf(w.company());
    const reset = (value: unknown) => {
      storage.sql.exec("DELETE FROM migrations WHERE name = 'company.settings-budgets-dollars'");
      storage.sql.exec("INSERT INTO settings (key, value, by, at) VALUES ('budgets', ?, ?, 0) ON CONFLICT(key) DO UPDATE SET value = excluded.value", JSON.stringify(value), ada.email);
    };
    reset({ tenantDailyTokens: 5_000_000, personDailyTokens: 1_000_000 });
    expect(migrate(storage, COMPANY_MIGRATIONS)).toEqual({ applied: ["company.settings-budgets-dollars"] });
    expect(h.rows("SELECT key FROM settings WHERE key = 'budgets'")).toEqual([]);
    expect((await w.http(ada.email, "GET", "/admin/overview")).body).toMatchObject({ settings: { budgets: DEFAULT_BUDGETS, budgetsSet: {} } });
    expect(migrate(storage, COMPANY_MIGRATIONS)).toEqual({ applied: [] });
    reset({ personDailyTokens: 1_000_000, tenantDailyMicros: 3_000_000 });
    migrate(storage, COMPANY_MIGRATIONS);
    expect(h.rows("SELECT value FROM settings WHERE key = 'budgets'")).toEqual([{ value: JSON.stringify({ tenantDailyMicros: 3_000_000 }) }]);
  });
});

describe("[M28.1] the admin page says and takes dollars", () => {
  it("the Budgets section asks for dollars a day, sends micro-dollar caps, marks a default, and names no token budget", async () => {
    const w = authorityWorld();
    const html = (await w.http(ada.email, "GET", "/admin")).body.html as string;
    const section = html.slice(html.indexOf('<section id="budgets">'), html.indexOf("</section>", html.indexOf('<section id="budgets">')));
    expect(section).toContain('name="personDailyDollars"');
    expect(section).toContain('placeholder="$ per person per day"');
    expect(section).toContain('placeholder="$ per company per day"');
    expect(html).toContain('["personDailyMicros", micros(f.personDailyDollars.value)]');
    expect(html).toContain('" (default)"');
    expect(html).not.toMatch(/DailyTokens|tokens per/);
    // The page's dollar helpers, run as the page runs them.
    const script = html.slice(html.indexOf("<script>") + 8, html.indexOf("</script>"));
    const pick = (name: string) => script.split("\n").find((l) => l.startsWith(`const ${name} = `))!;
    const helpers = new Function(`${pick("usd")}\n${pick("micros")}\nreturn { usd, micros };`)() as { usd: (m: number) => string; micros: (v: string) => number | undefined };
    expect([helpers.usd(2_000_000), helpers.usd(2_000_400), helpers.usd(500_000)]).toEqual(["$2.00", "$2.0004", "$0.50"]);
    expect([helpers.micros("2"), helpers.micros("0.07"), helpers.micros("")]).toEqual([2_000_000, 70_000, undefined]);
  });
});

/** A former member's label: rows and files keyed by a person who is not on the roster (fletch's fixtures hold one person). */
const other = { ...ada, id: "former-member", email: "former-member", name: "Pat" };
