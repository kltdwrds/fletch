// M28.1: daily caps per person and per tenant in dollars, enforced by the Ledger from each call's cost; the Company pushes
// only the caps an admin set, so the environment's defaults hold until one is set (the bug that kept stopping UAT on
// staging); stored token budgets deleted by named migrations; an unpriced model never counted as free. Two members of
// solo-sam throughout.
import { describe, expect, it } from "vitest";
import { DEFAULT_BUDGETS, defaultBudgets, dollars, STAGING_BUDGETS } from "../../packages/agent/src/ledger/budget.ts";
import { COMPANY_MIGRATIONS, LEDGER_MIGRATIONS } from "../../packages/agent/src/migrations/catalog.ts";
import { migrate } from "../../packages/agent/src/migrations/engine.ts";
import { Ledger } from "../../packages/agent/src/objects/ledger.ts";
import { ObjectHarness } from "../support/object-harness.ts";
import { ada, authorityWorld, } from "./support/authority-world.ts";

type Storage = Parameters<typeof migrate>[0];
const storageOf = (o: object) => (o as unknown as { ctx: { storage: Storage } }).ctx.storage;

describe("[M28.1] the defaults", () => {
  it("staging is $2 a person and $4 a tenant a day, the product $2 and $20, and the amounts read as dollars", () => {
    expect(defaultBudgets("staging")).toEqual({ personDailyMicros: 2_000_000, tenantDailyMicros: 4_000_000 });
    expect(STAGING_BUDGETS).toEqual(defaultBudgets("staging"));
    for (const env of ["production", "test", undefined]) expect(defaultBudgets(env)).toEqual({ personDailyMicros: 2_000_000, tenantDailyMicros: 20_000_000 });
    expect(DEFAULT_BUDGETS).toEqual(defaultBudgets(undefined));
    expect([dollars(2_000_000), dollars(2_000_400), dollars(150), dollars(0), dollars(4_010_000)]).toEqual(["$2.00", "$2.0004", "$0.00015", "$0.00", "$4.01"]);
  });
});

describe("[M28.1] the Company stops overriding the environment", () => {

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

describe("[M28.1] the token budgets are migrated away", () => {
  it("ledger.budgets-dollars deletes stored token caps, keeps a dollar cap, and a second run applies nothing", () => {
    const h = new ObjectHarness("ledger-m28", (ctx, e) => new Ledger(ctx as DurableObjectState, e as Env), { QYVR_ENV: "staging" });
    void h.instance;
    h.db.exec("INSERT INTO budgets (key, value) VALUES ('tenantDailyTokens', 1000000), ('personDailyTokens', 250000), ('personDailyMicros', 3000000)");
    h.db.exec("DELETE FROM migrations WHERE name = 'ledger.budgets-dollars'");
    const storage = storageOf(h.instance);
    expect(migrate(storage, LEDGER_MIGRATIONS)).toEqual({ applied: ["ledger.budgets-dollars"] });
    expect(h.rows("SELECT key, value FROM budgets ORDER BY key")).toEqual([{ key: "personDailyMicros", value: 3_000_000 }]);
    expect(h.instance.budgets()).toEqual({ personDailyMicros: 3_000_000, tenantDailyMicros: STAGING_BUDGETS.tenantDailyMicros });
    expect(migrate(storage, LEDGER_MIGRATIONS)).toEqual({ applied: [] });
    expect(h.rows("SELECT release FROM migrations WHERE name = 'ledger.budgets-dollars'")).toEqual([{ release: "m28.1" }]);
  });

  it("company.settings-budgets-dollars deletes the stored token budgets, so the overview shows the defaults, and a second run applies nothing", async () => {
    const w = authorityWorld({ qyvrEnv: "staging" });
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
    expect((await w.http(ada.email, "GET", "/admin/overview")).body).toMatchObject({ settings: { budgets: STAGING_BUDGETS, budgetsSet: {} } });
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
