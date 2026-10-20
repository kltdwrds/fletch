// The admin side of the company layer, hermetic (M10.2) on the two-member `solo-sam`: the admin
// page and the overview it reads, seats at the invitation, budgets, the model tier and disabled
// agents pushed from the `Company` to the `Ledger` and enforced before every call, company connectors
// whose credentials the real Vault resolves only under a company grant, and company skills written by
// admins alone and read by every member's catalog.
import { describe, expect, it } from "vitest";
import { VaultCore } from "../../packages/agent/src/vault/core.ts";
import { ObjectHarness } from "../support/object-harness.ts";
import { ada, authorityWorld } from "./support/authority-world.ts";
import { keysFor, testMasterKey } from "./support/vault-harness.ts";
const SECRET = "bk-live-QUOKKA-7731";

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

describe("[M10.2] company connectors", () => {

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
