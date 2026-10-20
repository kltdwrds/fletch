// M25.1 item 2: where a credential's value stands on a request (a header after a scheme word, a query
// parameter or a JSON body field) is declared per connector in its manifest, and per personal
// credential by the person's registry entry; a placement the declaration does not name is refused with
// EGRESS_CRED_PLACEMENT before any request leaves. The hostile model drives the code-path tool.
import { describe, expect, it } from "vitest";
import { CONNECTOR_MANIFESTS, type ConnectorManifest, manifestFor } from "../../packages/agent/src/connectors/manifest.ts";
import { egressFetch } from "../../packages/agent/src/egress/module.ts";
import { type HostRule, plan } from "../../packages/agent/src/egress/policy.ts";
import { type HostEntry, rulesFor } from "../../packages/agent/src/vault/hosts.ts";
import { ADA_HOST, ADA_REF, ada, by, call, echoVendor, egressWorld, load, seedBoth, vaultOf } from "./support/egress-world.ts";

/** Fixture manifests beside the production ones: a connector keyed in a query parameter, another in a body field. */
const FIXTURES: ConnectorManifest[] = [
  ...CONNECTOR_MANIFESTS,
  { id: "maps", placements: [{ in: "query", param: "key" }] },
  { id: "mailer", placements: [{ in: "body", field: "api_key" }] },
];
const entry = (ref: string, host: string): HostEntry => ({ ref, host, methods: ["GET", "POST"], header: "authorization", prefix: "Bearer ", fills: false });
const rules: HostRule[] = rulesFor([entry("cred://maps", "maps.example"), entry("cred://mailer", "mail.example"), entry("cred://github", "api.github.com"), entry(ADA_REF, ADA_HOST)], FIXTURES);

/** Plans and sends one request with a fake Vault that reveals `value` for every reference. */
async function send(req: Parameters<typeof plan>[0], value = "fixture-secret-value") {
  const net = echoVendor();
  const audit: unknown[] = [];
  const r = await egressFetch({ fetch: net.fetch, reveal: async () => ({ ok: true, value }), audit: (row) => audit.push(row), now: () => 0, hosts: rules }, req, { person: ada.email, purpose: "m25_test" });
  return { r, net, audit };
}

describe("[M25.1] per-connector placement", () => {
  it("each connector's manifest declares its own placements, and a personal credential's registry entry declares a header alone", () => {
    expect(manifestFor("cred://github")).toMatchObject({ id: "github", placements: [{ in: "header", name: "authorization", prefix: "Bearer " }] });
    expect(manifestFor("cred://company-github")?.id).toBe("github");
    expect(manifestFor(ADA_REF)).toBeUndefined();
    const slot = (host: string) => rules.find((r) => r.host === host)?.credentials[0]?.placements;
    expect(slot("maps.example")).toEqual([{ in: "query", param: "key" }]);
    expect(slot("mail.example")).toEqual([{ in: "body", field: "api_key" }]);
    expect(slot(ADA_HOST)).toEqual([{ in: "header", name: "authorization", prefix: "Bearer " }]);
    // The registry cannot move a connector's credential: GitHub's stands in its manifest's header whatever the entry says.
    expect(rulesFor([{ ...entry("cred://github", "api.github.com"), header: "x-token", prefix: "" }])[1]?.credentials[0]?.placements).toEqual([{ in: "header", name: "authorization", prefix: "Bearer " }]);
  });

  it("a placement the manifest declares carries the value there and only there: a query parameter, a body field, a header", async () => {
    const q = await send({ url: "https://maps.example/v1/geocode?q=harbour&key=cred://maps" });
    expect(q.r).toMatchObject({ ok: true, status: 200 });
    expect(new URL(q.net.sent[0]!.url).searchParams.get("key")).toBe("fixture-secret-value");
    expect(q.net.sent[0]!.headers.authorization).toBeUndefined();
    const b = await send({ url: "https://mail.example/send", method: "POST", body: JSON.stringify({ api_key: "cred://mailer", to: ada.email }) });
    expect(b.r).toMatchObject({ ok: true });
    expect(JSON.parse(b.net.sent[0]!.body as string)).toEqual({ api_key: "fixture-secret-value", to: ada.email });
    const h = await send({ url: "https://api.github.com/user", headers: [["authorization", "Bearer cred://github"]] });
    expect(h.net.sent[0]!.headers.authorization).toBe("Bearer fixture-secret-value");
    // Every answer that echoed the value comes back with the reference in its place.
    for (const { r } of [q, b, h]) expect(JSON.stringify(r)).not.toContain("fixture-secret-value");
  });

  it("a placement the manifest does not declare is refused with EGRESS_CRED_PLACEMENT and nothing is sent", async () => {
    const refused = [
      { url: "https://maps.example/v1/geocode", headers: [["authorization", "Bearer cred://maps"]] as Array<[string, string]> },
      { url: "https://maps.example/v1/geocode?token=cred://maps" },
      { url: "https://maps.example/v1/geocode", method: "POST", body: JSON.stringify({ key: "cred://maps" }) },
      { url: "https://mail.example/send?api_key=cred://mailer", method: "POST", body: "{}" },
      { url: "https://mail.example/send", method: "POST", body: JSON.stringify({ apikey: "cred://mailer" }) },
      { url: "https://api.github.com/user?access_token=cred://github" },
      { url: "https://api.github.com/user", headers: [["x-token", "cred://github"]] as Array<[string, string]> },
      { url: `https://${ADA_HOST}/orders`, method: "POST", body: JSON.stringify({ token: ADA_REF }) },
      // Not a whole value, or nowhere a placement can be: the path, a nested field, a repeated parameter, a body that is not JSON.
      { url: "https://maps.example/cred://maps/geocode" },
      { url: "https://mail.example/send", method: "POST", body: JSON.stringify({ auth: { api_key: "cred://mailer" } }) },
      { url: "https://maps.example/v1?key=cred://maps&key=other" },
      { url: "https://mail.example/send", method: "POST", body: "api_key=cred://mailer" },
    ];
    for (const req of refused) {
      const { r, net, audit } = await send(req);
      expect({ req, code: r.ok ? "ok" : r.code }).toEqual({ req, code: "EGRESS_CRED_PLACEMENT" });
      expect(net.sent).toEqual([]);
      expect(audit).toEqual([]);
    }
    const said = plan({ url: "https://api.github.com/user?access_token=cred://github" }, rules);
    expect(said).toMatchObject({ ok: false, reason: 'cred://github goes to api.github.com only in the authorization header after "Bearer ", not in the query parameter access_token' });
  });

  it("the hostile model, through code's egress, places Ada's key where her declaration does not: refused by code, no request leaves, the key never reaches the model", async () => {
    const hostile = [
      load("codefetch"),
      call("code_fetch", { url: `https://${ADA_HOST}/orders?api_key=${ADA_REF}` }),
      call("code_fetch", { url: `https://${ADA_HOST}/orders`, method: "POST", body: JSON.stringify({ token: ADA_REF }) }),
      call("code_fetch", { url: `https://${ADA_HOST}/orders`, headers: [["x-api-key", ADA_REF]] }),
      call("code_fetch", { url: `https://${ADA_HOST}/orders`, headers: [["authorization", `Token ${ADA_REF}`]] }),
      { text: "Tried every place." },
    ];
    const { w, net, vault } = egressWorld(hostile);
    const tokens = await seedBoth(vault());
    await w.say(ada.email, "Read my shop orders.");
    expect(net.sent).toEqual([]);
    const shown = JSON.stringify(w.fake.requests.at(-1)?.inputs.messages);
    expect(shown.match(/EGRESS_CRED_PLACEMENT/g)).toHaveLength(4);
    expect(shown).not.toContain(tokens.ada);
    // The declared placement, from the same tool, goes through.
    const ok = egressWorld([load("codefetch"), call("code_fetch", { url: `https://${ADA_HOST}/orders`, headers: [["authorization", `Bearer ${ADA_REF}`]] }), { text: "Read." }], { name: "vault-m25-ok" });
    const t = await seedBoth(ok.vault());
    await ok.w.say(ada.email, "Read my shop orders.");
    expect(ok.net.sent.map((s) => s.headers.authorization)).toEqual([`Bearer ${t.ada}`]);
  });

  it("the old global rule is gone: without a manifest that declares it, a query or body placement is refused; with one, it is carried", async () => {
    const net = echoVendor();
    const v = vaultOf("vault-m25-global", net.fetch, () => 0).instance;
    const r = await v.capture({ ref: "cred://maps", value: "fixture-maps-key", hosts: [{ host: "maps.example", methods: ["GET"], header: "authorization", prefix: "Bearer " }] }, by(ada.email));
    expect(r.ok).toBe(true);
    // In production no manifest names "maps", so its registry entry is its declaration: a header alone.
    expect(await v.egress({ url: "https://maps.example/v1?key=cred://maps" }, { person: ada.email, purpose: "t" })).toMatchObject({ ok: false, code: "EGRESS_CRED_PLACEMENT" });
    expect(net.sent).toEqual([]);
    expect((await send({ url: "https://maps.example/v1?key=cred://maps" })).r).toMatchObject({ ok: true });
  });
});
