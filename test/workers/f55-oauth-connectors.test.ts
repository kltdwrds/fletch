// F55: OAuth connectors on the default (D-0016 proposed, built as the overnight Defaults allow, deleted with the record
// if Kyle rejects it). The capture form's `oauth` scheme mints one state and sends the person's own browser to the
// provider's consent page with no secret in the address; the callback spends the state once, for its own person, inside
// its ten minutes, exchanges the code from inside the Vault and stores one `oauth` row bound to the hosts the person
// named; the access token is refreshed only on the egress path, every call to the provider is an audit row, an echoed
// token comes back as the reference, and a disconnect calls the provider's revoke URL once. Sam and Pat, two members of
// solo-sam (`test/fixtures/people.json`), against a recording provider (authorize, token, revoke) and an API host that
// echoes the bearer it was sent.
import { describe, expect, it } from "vitest";
import { CONNECTION_KINDS, outcomeWords, yoursRows } from "../../packages/agent/src/http/app/connection-words.ts";
import { VAULT_MIGRATIONS } from "../../packages/agent/src/migrations/catalog.ts";
import { credentialsNamespace } from "../../packages/agent/src/vault/tools.ts";
import { OAUTH_CALLBACK, STATE_TTL_MS } from "../../packages/agent/src/vault/oauth.ts";
import people from "../fixtures/people.json" with { type: "json" };
import { ada, TENANT, vaultWorld } from "./support/vault-world.ts";

const pat = people.people.find((p) => p.id === "pat-solo")!;
const AUTH = "auth.provider.example";
const API = "api.provider.example";
const ELSEWHERE = "files.elsewhere.example";
const REF = "cred://provider";
const CLIENT_SECRET = "f55-client-secret-fixture";
const ORIGIN = `https://${TENANT}.example`;

/** The vault world with a recording OAuth provider in place of the echoing vendor. */
function oauthWorld(name: string) {
  const provider = { calls: [] as Array<{ url: string; path: string; body: URLSearchParams }>, token: 200, revoke: 200, issued: 0, expiresIn: 3600 as number | null };
  const w = vaultWorld(name, async (url, init) => {
    const u = new URL(url);
    if (u.hostname === AUTH) {
      provider.calls.push({ url, path: u.pathname, body: new URLSearchParams(String(init.body ?? "")) });
      if (u.pathname === "/oauth/revoke") return new Response(null, { status: provider.revoke });
      if (provider.token !== 200) return Response.json({ error: "invalid_grant" }, { status: provider.token });
      provider.issued += 1;
      return Response.json({ access_token: `access-${provider.issued}`, refresh_token: `refresh-${provider.issued}`, token_type: "Bearer", scope: "read write", ...(provider.expiresIn ? { expires_in: provider.expiresIn } : {}) });
    }
    // The API host is hostile: it echoes the bearer it was sent.
    return Response.json({ echo: new Headers(init.headers).get("authorization") });
  });
  const rows = (q: string, ...b: unknown[]) => (w.vault() as unknown as { sql(q: string, ...b: unknown[]): Array<Record<string, unknown>> }).sql(q, ...b);
  const form = (o: Record<string, string> = {}) => ({
    ref: REF, label: "Provider", kind: "oauth", scheme: "oauth", host: API, methods: "GET POST", permission: "standing", client_id: "fletch-client",
    authorize_url: `https://${AUTH}/oauth/authorize?access_type=offline`, token_url: `https://${AUTH}/oauth/token`, revoke_url: `https://${AUTH}/oauth/revoke`, scope: "read write", value: CLIENT_SECRET, ...o,
  });
  const begin = (as = ada.email, o: Record<string, string> = {}) => w.http(as, "POST", "/vault/capture", { form: form(o) });
  const stateOf = (r: { headers: Headers }) => new URL(r.headers.get("location") ?? "https://x.example").searchParams.get("state") ?? "";
  const callback = (as: string, q: Record<string, string>) => w.http(as, "GET", `${OAUTH_CALLBACK}?${new URLSearchParams(q)}`);
  const connect = async () => {
    const state = stateOf(await begin());
    const cb = await callback(ada.email, { code: "code-1", state });
    if (cb.status !== 201) throw new Error(`connect refused: ${cb.text}`);
    return state;
  };
  const apiCalls = () => w.requests.filter((r) => !r.url.startsWith(`https://${AUTH}/`));
  return { ...w, provider, rows, begin, stateOf, callback, connect, apiCalls };
}

describe("[F55] OAuth connectors: the consent redirect and the one-shot state", () => {
  it("the submit mints one state and sends the browser to the authorize URL with the agent's callback, no secret in it, and stores no credential", async () => {
    const w = oauthWorld("f55-begin");
    const r = await w.begin();
    expect(r.status).toBe(303);
    const to = new URL(r.headers.get("location") as string);
    expect(`${to.origin}${to.pathname}`).toBe(`https://${AUTH}/oauth/authorize`);
    expect(Object.fromEntries(to.searchParams)).toEqual({ access_type: "offline", response_type: "code", client_id: "fletch-client", redirect_uri: `${ORIGIN}${OAUTH_CALLBACK}`, scope: "read write", state: expect.stringMatching(/^[0-9a-f]{32}$/) });
    expect(to.href).not.toContain(CLIENT_SECRET);
    expect(r.text).not.toContain(CLIENT_SECRET);
    // B-P9-02: nothing is stored before the person comes back; the state row holds the client sealed, and nothing was fetched.
    expect(w.vault().list(ada.email)).toEqual([]);
    expect(w.rows("SELECT ref FROM secrets")).toEqual([]);
    const [state] = w.rows("SELECT state, owner, ref, token_url, ct, expires_at, created_at, spent_at FROM oauth_states");
    expect(state).toMatchObject({ state: w.stateOf(r), owner: ada.email, ref: REF, token_url: `https://${AUTH}/oauth/token`, spent_at: null });
    expect(Number(state?.expires_at) - Number(state?.created_at)).toBe(10 * 60_000);
    expect(new TextDecoder().decode(state?.ct as Uint8Array)).not.toContain(CLIENT_SECRET);
    expect(w.requests).toEqual([]);
  });

  it("the callback spends the state, exchanges the code with the client secret in the body and never the URL, and stores the oauth row with no value shown", async () => {
    const w = oauthWorld("f55-callback");
    const state = w.stateOf(await w.begin());
    const cb = await w.callback(ada.email, { code: "code-1", state });
    expect(cb.status).toBe(201);
    expect(cb.text).toContain(`Saved <code>${REF}</code> for ${API}`);
    for (const value of [CLIENT_SECRET, "access-1", "refresh-1", "code-1"]) expect({ value, shown: cb.text.includes(value) }).toEqual({ value, shown: false });
    expect(w.provider.calls).toHaveLength(1);
    const exchange = w.provider.calls[0]!;
    expect(exchange.url).toBe(`https://${AUTH}/oauth/token`);
    expect(Object.fromEntries(exchange.body)).toEqual({ grant_type: "authorization_code", code: "code-1", redirect_uri: `${ORIGIN}${OAUTH_CALLBACK}`, client_id: "fletch-client", client_secret: CLIENT_SECRET });
    expect(w.requests[0]).toMatchObject({ method: "POST", redirect: "manual", authorization: null });
    expect(w.vault().list(ada.email)).toMatchObject([{ ref: REF, label: "Provider", kind: "oauth", status: "active", permission: "standing", hosts: [{ host: API, methods: ["GET", "POST"], header: "authorization", prefix: "Bearer ", fills: false }] }]);
    expect(JSON.stringify(w.vault().list(ada.email))).not.toMatch(/access-1|refresh-1|f55-client-secret/);
    expect(w.vault().audit()).toMatchObject([{ ref: REF, host: AUTH, method: "POST", path: "/oauth/token", person: ada.email, purpose: "oauth code exchange", outcome: "resolved" }]);
    expect(w.vault().events(ada.email)).toMatchObject([{ event: "captured", ref: REF, by: ada.email, detail: `capture-form; oauth; ${API}` }]);
    expect(w.vault().captureState(ada.email, REF)).toMatchObject({ state: "entered" });
    // Only the form drawn for the oauth scheme lets its form redirect to an https provider; a key's or a login's form,
    // the callback page and the JSON keep 'self'.
    const csp = (r: { headers: Headers }) => /form-action [^;]*;/.exec(r.headers.get("content-security-policy") ?? "")?.[0];
    expect(csp(await w.http(ada.email, "GET", "/vault/capture?kind=oauth"))).toBe("form-action 'self' https:;");
    for (const path of ["/vault/capture", "/vault/capture?kind=login", "/vault"]) expect({ path, csp: csp(await w.http(ada.email, "GET", path)) }).toEqual({ path, csp: "form-action 'self';" });
    expect(csp(cb)).toBe("form-action 'self';");
    // The spent state keeps no sealed client.
    expect(w.rows("SELECT spent_at, length(ct) AS n FROM oauth_states WHERE state = ?", state)).toEqual([{ spent_at: w.clock.now, n: 0 }]);
    // It is a connection: the Yours row draws it as it draws a key.
    expect(CONNECTION_KINDS.has("oauth")).toBe(true);
    expect(yoursRows(w.vault().list(ada.email), {})).toMatchObject([{ name: API, status: "active", statusWord: "Active", sub: expect.stringContaining("Provider") }]);
    expect(yoursRows(w.vault().list(ada.email).map((c) => ({ ...c, label: "" })), {})[0]?.sub).toContain("OAuth connection");
  });

  it("a replayed state is refused VAULT_OAUTH_STATE_INVALID with no second exchange", async () => {
    const w = oauthWorld("f55-replay");
    const state = await w.connect();
    const again = await w.callback(ada.email, { code: "code-2", state });
    expect(again.status).toBe(400);
    expect(again.text).toContain("VAULT_OAUTH_STATE_INVALID");
    // A state never minted, or none at all, is the same refusal, and nothing is fetched.
    for (const q of [{ code: "code-3", state: "0".repeat(32) }, { code: "code-3" }] as Array<Record<string, string>>) expect((await w.callback(ada.email, q)).text).toContain("VAULT_OAUTH_STATE_INVALID");
    expect(w.provider.calls).toHaveLength(1);
    expect(w.vault().events(ada.email).filter((e) => e.event === "captured")).toHaveLength(1);
  });

  it("another member's state is refused, unspent, and its own person can still finish", async () => {
    const w = oauthWorld("f55-owner");
    const state = w.stateOf(await w.begin());
    const pats = await w.callback(pat.email, { code: "code-1", state });
    expect(pats.status).toBe(400);
    expect(pats.text).toContain("VAULT_OAUTH_STATE_INVALID");
    expect(w.provider.calls).toEqual([]);
    expect(w.vault().list(pat.email)).toEqual([]);
    expect((await w.callback(ada.email, { code: "code-1", state })).status).toBe(201);
    expect(w.vault().list(pat.email)).toEqual([]);
    expect(w.vault().list(ada.email)).toMatchObject([{ ref: REF, kind: "oauth" }]);
  });

  it("an expired state is refused and swept, and the next mint sweeps the expired ones", async () => {
    const w = oauthWorld("f55-expiry");
    const state = w.stateOf(await w.begin());
    w.clock.now += STATE_TTL_MS;
    const late = await w.callback(ada.email, { code: "code-1", state });
    expect(late.status).toBe(400);
    expect(late.text).toContain("VAULT_OAUTH_STATE_INVALID");
    expect(w.provider.calls).toEqual([]);
    expect(w.rows("SELECT state FROM oauth_states")).toEqual([]);
    const old = w.stateOf(await w.begin());
    w.clock.now += STATE_TTL_MS + 1;
    const fresh = w.stateOf(await w.begin());
    expect(w.rows("SELECT state FROM oauth_states")).toEqual([{ state: fresh }]);
    expect(old).not.toBe(fresh);
  });

  it("a callback with the provider's error spends the state, stores nothing and names the error; a refused exchange stores nothing", async () => {
    const w = oauthWorld("f55-error");
    const state = w.stateOf(await w.begin());
    const denied = await w.callback(ada.email, { error: "access_denied", state });
    expect(denied.status).toBe(400);
    expect(denied.text).toContain("access_denied");
    expect(denied.text).toContain("VAULT_OAUTH_REJECTED");
    expect(w.provider.calls).toEqual([]);
    expect(w.vault().list(ada.email)).toEqual([]);
    expect((await w.callback(ada.email, { code: "code-1", state })).text).toContain("VAULT_OAUTH_STATE_INVALID");
    w.provider.token = 400;
    const refused = await w.callback(ada.email, { code: "code-1", state: w.stateOf(await w.begin()) });
    expect(refused.status).toBe(400);
    expect(refused.text).toContain("VAULT_OAUTH_REJECTED");
    expect(w.vault().list(ada.email)).toEqual([]);
    expect(w.vault().audit()).toMatchObject([{ host: AUTH, method: "POST", purpose: "oauth code exchange: HTTP 400", outcome: "rejected" }]);
    expect(outcomeWords("rejected")).toBe("rejected by the provider");
  });

  it("the form refuses a non-https endpoint, an IP literal and a platform host by code, mints nothing and never echoes the secret; a cross-site submit is refused", async () => {
    const w = oauthWorld("f55-hosts");
    for (const [o, code] of [
      [{ authorize_url: `http://${AUTH}/oauth/authorize` }, "VAULT_HOST_SCHEME_DENIED"],
      [{ token_url: "https://10.0.0.9/oauth/token" }, "VAULT_HOST_IP_LITERAL"],
      [{ revoke_url: "https://auth.qyvr.ai/revoke" }, "VAULT_HOST_PLATFORM"],
      [{ host: "api.example.workers.dev" }, "VAULT_HOST_PLATFORM"],
      [{ host: "intranet.local" }, "VAULT_HOST_PRIVATE"],
    ] as Array<[Record<string, string>, string]>) {
      const r = await w.begin(ada.email, o);
      expect({ o, status: r.status, code: r.text.includes(code), echoed: r.text.includes(CLIENT_SECRET) }).toEqual({ o, status: 400, code: true, echoed: false });
    }
    // Kind switched to oauth on a key's form (no oauth scheme field): the fields come back on the oauth form, no state.
    const switched = await w.begin(ada.email, { scheme: "" });
    expect({ status: switched.status, code: switched.text.includes("VAULT_FORM_INVALID"), scheme: switched.text.includes('name="scheme" value="oauth"'), echoed: switched.text.includes(CLIENT_SECRET) }).toEqual({ status: 400, code: true, scheme: true, echoed: false });
    expect(switched.headers.get("content-security-policy")).toContain("form-action 'self' https:;");
    const cross = await w.http(ada.email, "POST", "/vault/capture", { form: { ref: REF, kind: "oauth", host: API, value: CLIENT_SECRET } }, "https://attacker.example");
    expect(cross.status).toBe(403);
    expect(w.rows("SELECT state FROM oauth_states")).toEqual([]);
    expect(w.requests).toEqual([]);
  });

  it("credential_request with oauth links the form's oauth scheme; a dismissed setup opens no form and mints no state", async () => {
    const w = oauthWorld("f55-setup");
    const ask = credentialsNamespace({ list: async () => [] }).tools.find((t) => t.name === "credential_request")!;
    expect(ask.description).toContain("consent page");
    const out = (await ask.execute("c1", { host: API, name: "provider", oauth: true } as never)).content.map((c) => ("text" in c ? c.text : "")).join("");
    const link = /\/vault\/capture\?\S+/.exec(out)?.[0] as string;
    const q = new URL(link, ORIGIN).searchParams;
    expect(Object.fromEntries(q)).toMatchObject({ ref: REF, host: API, kind: "oauth", setup: expect.stringMatching(/^[0-9a-f]{16}$/) });
    const page = await w.http(ada.email, "GET", link);
    expect(page.text).toContain('<option value="oauth" selected>');
    expect(page.text).toContain("<details open>");
    expect(page.text).toContain("Client secret");
    expect((await w.http(ada.email, "POST", "/vault/capture/dismiss", { json: { ref: REF, setup: q.get("setup") } })).status).toBe(200);
    expect((await w.http(ada.email, "GET", link)).status).toBe(410);
    const r = await w.begin(ada.email, { setup: q.get("setup") as string });
    expect(r.status).toBe(400);
    expect(r.text).toContain("VAULT_REF_INVALID");
    expect(w.rows("SELECT state FROM oauth_states")).toEqual([]);
  });

  it("the oauth_states table is a named Vault migration", () => {
    expect(VAULT_MIGRATIONS.map((m) => m.name)).toContain("vault.oauth-states");
  });
});

describe("[F55] OAuth connectors: use, refresh and revoke on the egress path", () => {
  it("a use on a bound host sends the access token as a bearer, writes its audit row and scrubs the echo; an unbound host is refused with its row and nothing sent", async () => {
    const w = oauthWorld("f55-use");
    await w.connect();
    // Sam keeps another key at ELSEWHERE, so that host is listed; the connection is not bound to it.
    expect(await w.vault().capture({ ref: "cred://elsewhere", value: `${w.token}-elsewhere`, hosts: [ELSEWHERE] }, { kind: "person", person: ada.email, via: "capture-form" })).toMatchObject({ ok: true });
    const used = await w.egress(ada.email, `https://${API}/me`, REF);
    expect(used).toMatchObject({ ok: true, status: 200 });
    expect(w.apiCalls().map((r) => [r.url, r.authorization])).toEqual([[`https://${API}/me`, "Bearer access-1"]]);
    // The echoed token comes back as the reference.
    expect(used.ok && JSON.parse(used.body)).toEqual({ echo: `Bearer [redacted ${REF}]` });
    expect(w.vault().audit()[0]).toMatchObject({ ref: REF, host: API, method: "GET", path: "/me", outcome: "resolved" });
    expect(await w.egress(ada.email, `https://${ELSEWHERE}/files`, REF)).toMatchObject({ ok: false, code: "EGRESS_CRED_HOST_DENIED" });
    expect(w.vault().audit()[0]).toMatchObject({ ref: REF, host: ELSEWHERE, outcome: "EGRESS_CRED_HOST_DENIED" });
    expect(w.apiCalls()).toHaveLength(1);
    // Pat's agent cannot use Sam's connection.
    expect(await w.egress(pat.email, `https://${API}/me`, REF)).toMatchObject({ ok: false });
    expect(w.apiCalls()).toHaveLength(1);
  });

  it("an access token within a minute of its end is refreshed before the use: the audit row says refreshed and the API host sees the new token", async () => {
    const w = oauthWorld("f55-refresh");
    await w.connect();
    w.clock.now += 3600_000 - 30_000;
    expect(await w.egress(ada.email, `https://${API}/me`, REF)).toMatchObject({ ok: true });
    const refresh = w.provider.calls[1]!;
    expect(Object.fromEntries(refresh.body)).toEqual({ grant_type: "refresh_token", refresh_token: "refresh-1", client_id: "fletch-client", client_secret: CLIENT_SECRET });
    expect(w.apiCalls().map((r) => r.authorization)).toEqual(["Bearer access-2"]);
    expect(w.vault().audit().slice(0, 2)).toMatchObject([{ host: API, outcome: "resolved" }, { ref: REF, host: AUTH, method: "POST", path: "/oauth/token", outcome: "refreshed" }]);
    expect(outcomeWords("refreshed")).toBe("refreshed at the provider");
    // The refreshed tokens were sealed back: the next use within the new life refreshes nothing.
    expect(await w.egress(ada.email, `https://${API}/me`, REF)).toMatchObject({ ok: true });
    expect(w.provider.calls).toHaveLength(2);
    expect(w.apiCalls().map((r) => r.authorization)).toEqual(["Bearer access-2", "Bearer access-2"]);
    // The next refresh presents the rotated refresh token.
    w.clock.now += 3600_000;
    expect(await w.egress(ada.email, `https://${API}/me`, REF)).toMatchObject({ ok: true });
    expect(w.provider.calls[2]?.body.get("refresh_token")).toBe("refresh-2");
  });

  it("a refused refresh writes rejected, refuses the use EGRESS_OAUTH_REFRESH_FAILED and sends nothing to the bound host", async () => {
    const w = oauthWorld("f55-refresh-refused");
    await w.connect();
    w.provider.token = 401;
    w.clock.now += 3600_000;
    expect(await w.egress(ada.email, `https://${API}/me`, REF)).toMatchObject({ ok: false, code: "EGRESS_OAUTH_REFRESH_FAILED" });
    expect(w.apiCalls()).toEqual([]);
    expect(w.vault().events(ada.email)[0]).toMatchObject({ event: "rejected", ref: REF, by: "provider", detail: "HTTP 401; refresh" });
    expect(w.vault().audit().slice(0, 2)).toMatchObject([{ host: API, outcome: "EGRESS_OAUTH_REFRESH_FAILED" }, { host: AUTH, outcome: "rejected", purpose: "m13_test: HTTP 401" }]);
    expect(w.vault().lastUses(ada.email)[REF]?.outcome).toBe("rejected by the provider (HTTP 401; refresh)");
  });

  it("a refresh attempted outside the egress path is refused and reaches no provider (planted)", async () => {
    const w = oauthWorld("f55-refresh-placement");
    await w.connect();
    w.clock.now += 3600_000;
    const outside = w.vault() as unknown as { refreshOAuth(owner: string, ref: string, path: object | null, ctx: { person: string; purpose: string }): Promise<unknown> };
    for (const path of [{}, null]) expect(await outside.refreshOAuth(ada.email, REF, path, { person: ada.email, purpose: "planted" })).toMatchObject({ ok: false, code: "EGRESS_OAUTH_REFRESH_FAILED" });
    // A fill is not the egress path's fetch, and an oauth row never fills: nothing is refreshed there either.
    expect(await w.fill(ada.email, REF, API)).toMatchObject({ ok: false });
    expect(w.provider.calls).toHaveLength(1);
    // The same refresh on the egress path goes through.
    expect(await w.egress(ada.email, `https://${API}/me`, REF)).toMatchObject({ ok: true });
    expect(w.provider.calls).toHaveLength(2);
  });

  it("a revoke ends the row, posts the refresh token to the revoke URL once, and the next use is EGRESS_CRED_REVOKED; a failed provider revoke leaves the local one standing", async () => {
    const w = oauthWorld("f55-revoke");
    await w.connect();
    expect((await w.http(ada.email, "POST", "/vault/revoke", { json: { ref: REF } })).status).toBe(200);
    const revoke = w.provider.calls.filter((c) => c.path === "/oauth/revoke");
    expect(revoke).toHaveLength(1);
    expect(Object.fromEntries(revoke[0]!.body)).toEqual({ token: "refresh-1", token_type_hint: "refresh_token", client_id: "fletch-client", client_secret: CLIENT_SECRET });
    expect(w.vault().audit()[0]).toMatchObject({ ref: REF, host: AUTH, path: "/oauth/revoke", purpose: "oauth revoke", outcome: "resolved" });
    expect(await w.vault().revoke(REF, { kind: "person", person: ada.email, via: "settings" })).toEqual({ ok: true });
    expect(w.provider.calls.filter((c) => c.path === "/oauth/revoke")).toHaveLength(1);
    expect(await w.egress(ada.email, `https://${API}/me`, REF)).toMatchObject({ ok: false, code: "EGRESS_CRED_REVOKED" });
    expect(w.apiCalls()).toEqual([]);

    const f = oauthWorld("f55-revoke-fails");
    await f.connect();
    f.provider.revoke = 503;
    expect((await f.http(ada.email, "POST", "/vault/revoke", { json: { ref: REF } })).status).toBe(200);
    expect(f.vault().list(ada.email)).toMatchObject([{ ref: REF, status: "revoked" }]);
    expect(f.vault().events(ada.email)[0]).toMatchObject({ event: "rejected", detail: "HTTP 503; revoke" });
  });
});
