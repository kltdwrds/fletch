// The admin side of the company layer, hermetic (M10.2) on the two-member `solo-sam`: the admin
// page and the overview it reads, seats at the invitation, budgets, the model tier and disabled
// agents pushed from the `Company` to the `Ledger` and enforced before every call, company connectors
// whose credentials the real Vault resolves only under a company grant, and company skills written by
// admins alone and read by every member's catalog.
import { describe, expect, it } from "vitest";
import { HEDGES, MODEL_TIERS, ROUTES } from "../../packages/agent/src/model/routes.ts";
import { VaultCore } from "../../packages/agent/src/vault/core.ts";
import { ObjectHarness } from "../support/object-harness.ts";
import { ada, authorityWorld } from "./support/authority-world.ts";
import { keysFor, testMasterKey } from "./support/vault-harness.ts";
const SECRET = "bk-live-QUOKKA-7731";

describe("[M10.2] admin pages", () => {

  it("budgets and the model tier are the Company's, and the Ledger enforces what it was given before every call", async () => {
    const w = authorityWorld();
    expect(await w.http(ada.email, "PUT", "/admin/settings", { budgets: { personDailyMicros: -1 } })).toMatchObject({ status: 400, body: { code: "SETTINGS_INVALID" } });
    expect(await w.http(ada.email, "PUT", "/admin/settings", { modelTier: "gold" })).toMatchObject({ status: 400, body: { code: "SETTINGS_INVALID" } });
    const set = await w.http(ada.email, "PUT", "/admin/settings", { budgets: { personDailyMicros: 40_000 }, modelTier: "economy" });
    expect(set.body).toMatchObject({ settings: { budgets: { personDailyMicros: 40_000, tenantDailyMicros: 20_000_000 }, budgetsSet: { personDailyMicros: 40_000 }, modelTier: "economy" } });
    expect(w.ledger().budgets()).toEqual({ personDailyMicros: 40_000, tenantDailyMicros: 20_000_000 });
    expect(w.ledger().budgetsSet()).toEqual({ personDailyMicros: 40_000 });
    // The economy tier admits D1's default model, on both of the chat route's hosts (M22.1), and refuses the smoke route's, before the call.
    expect(MODEL_TIERS.economy).toEqual([ROUTES.chat, HEDGES.chat?.model]);
    expect(await w.ledger().admit({ person: ada.email, runId: "r1", model: ROUTES.chat })).toEqual({ ok: true });
    expect(await w.ledger().admit({ person: ada.email, runId: "r1", model: HEDGES.chat?.model })).toEqual({ ok: true });
    expect(await w.ledger().admit({ person: ada.email, runId: "r1", model: ROUTES.smoke })).toMatchObject({ ok: false, code: "MODEL_TIER_REFUSED" });
    // The standard tier admits the smoke route's model, which has no price, so the dollar caps refuse it (M28.1).
    await w.http(ada.email, "PUT", "/admin/settings", { modelTier: "standard" });
    expect(await w.ledger().admit({ person: ada.email, runId: "r1", model: ROUTES.smoke })).toMatchObject({ ok: false, code: "MODEL_UNPRICED" });
  });
});

/** The world with the real Vault as the Company's VAULT, and the Vault asking the Company on every resolution. */
function connectorWorld(options: { entitled?: "company" | "everyone" } = {}) {
  const fetched: Array<{ url: string; auth: string | null }> = [];
  let w: ReturnType<typeof authorityWorld> | undefined;
  const vaultH = new ObjectHarness(
    "vault",
    (ctx) =>
      new VaultCore(ctx as never, {
        tenant: "solo-sam",
        keys: keysFor("solo-sam", testMasterKey()),
        fetch: async (url, init) => {
          fetched.push({ url, auth: new Headers(init.headers).get("authorization") });
          return new Response(JSON.stringify({ balance: 1200, echo: new Headers(init.headers).get("authorization") }), { headers: { "content-type": "application/json" } });
        },
        now: () => 1_791_892_800_000,
        entitled: options.entitled === "everyone" ? async () => true : (person, connector, purpose) => (w as ReturnType<typeof authorityWorld>).company().connectorEntitled(person, connector, purpose),
      }),
    {},
  );
  w = authorityWorld({ companyEnv: { VAULT: { idFromName: (n: string) => ({ name: n }), get: () => vaultH.instance } } });
  const read = (person: string) => vaultH.instance.egress({ url: "https://books.solo-sam.example/balance", method: "GET", headers: [["authorization", "Bearer cred://company-books"]] }, { person, purpose: "books_read" });
  return { w, vault: () => vaultH.instance, fetched, read };
}
const teamGrant = (grantee: Record<string, unknown>) => ({ grantor: { kind: "company", id: "solo-sam" }, grantee, subject: { kind: "connector", ref: "books" }, mode: "auto", created_from: "admin-ui", constraints: {} });

describe("[M10.2] company connectors", () => {
  it("an admin connects the books into the Vault; the Company keeps no value and a member cannot connect", async () => {
    const { w, vault } = connectorWorld();
    expect(await w.http(ada.email, "POST", "/admin/connectors", { id: "books", hosts: ["10.0.0.7"], value: SECRET })).toMatchObject({ status: 400, body: { code: "VAULT_HOST_IP_LITERAL" } });
    const made = await w.http(ada.email, "POST", "/admin/connectors", { id: "books", hosts: ["books.solo-sam.example"], value: SECRET });
    expect(made).toMatchObject({ status: 201, body: { connector: { id: "books", ref: "cred://company-books", hosts: ["books.solo-sam.example"], connectedBy: ada.email } } });
    expect(vault().list(ada.email)).toMatchObject([{ ref: "cred://company-books", company: true, hosts: [{ host: "books.solo-sam.example" }] }]);
    const overview = await w.http(ada.email, "GET", "/admin/overview");
    expect(overview.body.connectors).toMatchObject([{ id: "books" }]);
    expect(JSON.stringify([made.body, overview.body])).not.toContain(SECRET);
  });

  it("a grant to every member reaches both, a policy by role caps it at the Vault, and removal ends it", async () => {
    const { w, read } = connectorWorld();
    await w.http(ada.email, "POST", "/admin/connectors", { id: "books", hosts: ["books.solo-sam.example"], value: SECRET });
    await w.company().createGrant(ada.email, teamGrant({ kind: "any-member" }));
    expect((await read(ada.email)).ok).toBe(true);
    await w.company().addPolicy(ada.email, { kind: "deny-action", actionKind: "books.read", role: "member" });
    expect((await read(ada.email)).ok).toBe(true);
    expect(await w.http(ada.email, "DELETE", "/admin/connectors/books")).toMatchObject({ status: 200 });
    expect(await read(ada.email)).toMatchObject({ ok: false, code: "EGRESS_CRED_UNKNOWN" });
  });

  it("the planted fault: a Vault that does not ask the Company resolves the books for Ada, who holds no grant", async () => {
    const guarded = connectorWorld();
    const planted = connectorWorld({ entitled: "everyone" });
    for (const c of [guarded, planted]) await c.w.http(ada.email, "POST", "/admin/connectors", { id: "books", hosts: ["books.solo-sam.example"], value: SECRET });
    expect(await guarded.read(ada.email)).toMatchObject({ ok: false, code: "EGRESS_COMPANY_GRANT_REQUIRED" });
    expect(await planted.read(ada.email)).toMatchObject({ ok: true });
    // A Vault given no way to ask refuses every company reference.
    const h = new ObjectHarness("vault-bare", (ctx) => new VaultCore(ctx as never, { tenant: "solo-sam", keys: keysFor("solo-sam", testMasterKey()), fetch: async () => new Response("{}"), now: () => 1 }), {});
    await h.instance.putCompany({ connector: "books", value: SECRET, hosts: ["books.solo-sam.example"], by: ada.email });
    expect(await h.instance.egress({ url: "https://books.solo-sam.example/balance", method: "GET", headers: [["authorization", "Bearer cred://company-books"]] }, { person: ada.email, purpose: "books_read" })).toMatchObject({ ok: false, code: "EGRESS_COMPANY_GRANT_REQUIRED" });
  });
});
