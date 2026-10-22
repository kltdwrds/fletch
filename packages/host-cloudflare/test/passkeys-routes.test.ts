// Holds decision D-0002: the first passkey needs the one-time setup token, which grants nothing afterwards.
import { describe, expect, it } from "vitest";
import { type LoginCall, type LoginResultOf, runLoginCall } from "../src/passkeys/call.ts";
import { passkeyIdentity, SESSION_COOKIE } from "../src/passkeys/identity.ts";
import { simpleWebAuthn, type Verifier } from "../src/passkeys/webauthn.ts";
import { softAuthenticator } from "./soft-authenticator.ts";
import { memorySql } from "./sql-adapter.ts";

const OWNER = "sam@solo-sam.example";
const ORIGIN = "https://fletch.solo-sam.example";
const SETUP = "fixture-setup-link-0001";
const COOKIE_ATTRS = "HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=2592000";

type Json = Record<string, unknown>;

/** Passes when the credential echoes the challenge it was given; the ceremony itself is the real verifier's test. */
const fakeVerifier: Verifier = {
  registrationOptions: async (o) => ({ challenge: o.challenge, rp: { id: o.rpId, name: "fletch" }, user: { name: o.userName }, excludeCredentials: o.exclude }),
  verifyRegistration: async (o) => {
    const c = o.response as { id?: string; challenge?: string };
    if (c.challenge !== o.challenge) return { ok: false, reason: "challenge does not match" };
    if (o.origin !== ORIGIN || o.rpId !== "fletch.solo-sam.example") return { ok: false, reason: "origin does not match" };
    return { ok: true, credential: { id: c.id ?? "cred-1", publicKey: new Uint8Array([1, 2]), counter: 0, transports: ["internal"] } };
  },
  authenticationOptions: async (o) => ({ challenge: o.challenge, rpId: o.rpId, allowCredentials: o.allow }),
  verifyAuthentication: async (o) => {
    const c = o.response as { challenge?: string };
    if (c.challenge !== o.challenge) return { ok: false, reason: "challenge does not match" };
    return { ok: true, newCounter: o.credential.counter + 1 };
  },
};

function harness(verifier: Verifier = fakeVerifier, setupToken: string | null = SETUP) {
  let t = 5_000_000;
  const clock = {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
  };
  const sql = memorySql();
  const call = async <C extends LoginCall>(c: C): Promise<LoginResultOf<C>> => runLoginCall(sql, clock.now, c);
  const identity = passkeyIdentity({ call, owner: OWNER, tenant: "solo-sam", now: clock.now, verifier, ...(setupToken === null ? {} : { setupToken }) });
  const send = async (method: string, path: string, opts: { body?: unknown; cookie?: string; origin?: string | null } = {}) => {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (opts.origin !== null) headers.origin = opts.origin ?? ORIGIN;
    if (opts.cookie) headers.cookie = opts.cookie;
    const init: RequestInit = { method, headers };
    if (method !== "GET") init.body = JSON.stringify(opts.body ?? {});
    const res = await identity.routes(new Request(ORIGIN + path, init), new URL(ORIGIN + path));
    if (!res) throw new Error(`no route for ${method} ${path}`);
    return res;
  };
  const post = async (path: string, opts: { body?: unknown; cookie?: string; origin?: string | null } = {}) => {
    const res = await send("POST", path, opts);
    const text = await res.text();
    return { res, body: (text ? JSON.parse(text) : null) as Json };
  };
  const owner = async (e: string) => (e === OWNER ? { email: e, role: "owner" as const } : null);
  const verify = (path: string, cookie?: string, lookup = owner) => identity.verify(new Request(ORIGIN + path, cookie ? { headers: { cookie } } : {}), lookup);

  /** The first registration through the fake verifier: the cookie header and the recovery code. */
  const register = async (cookie?: string, id = "cred-1") => {
    const opts = await post("/login/register/options", { body: { setup: SETUP }, ...(cookie ? { cookie } : {}) });
    const challenge = (opts.body.options as Json).challenge;
    const done = await post("/login/register/verify", { body: { setup: SETUP, challengeId: opts.body.challengeId, credential: { id, challenge } }, ...(cookie ? { cookie } : {}) });
    return { ...done, cookie: cookieOf(done.res) };
  };
  return { clock, call, identity, send, post, verify, register };
}

function cookieOf(res: Response): string {
  const set = res.headers.get("set-cookie") ?? "";
  const token = set.match(new RegExp(`${SESSION_COOKIE}=([^;]*)`))?.[1];
  return token ? `${SESSION_COOKIE}=${token}` : "";
}

describe("[F1] login routes", () => {
  it("register-options then register-verify sets the session cookie and returns a 20-character recovery code once", async () => {
    const h = harness();
    const { res, body, cookie } = await h.register();
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toMatch(new RegExp(`^${SESSION_COOKIE}=[A-Za-z0-9_-]{43}; ${COOKIE_ATTRS}$`));
    expect(body.ok).toBe(true);
    expect(String(body.recoveryCode).replaceAll("-", "")).toHaveLength(20);
    expect(await h.verify("/app/chat", cookie)).toEqual({ ok: true, session: { tenant: "solo-sam", person: OWNER, role: "owner" } });
    expect(await h.call({ op: "list" })).toEqual([{ id: "cred-1", email: OWNER, at: 5_000_000 }]);
  });

  it("a second register with no cookie is LOGIN_ALREADY_REGISTERED; with the owner's cookie it is 200 with no recovery code", async () => {
    const h = harness();
    const first = await h.register();
    const refused = await h.post("/login/register/options");
    expect(refused.res.status).toBe(403);
    expect(refused.body).toMatchObject({ ok: false, code: "LOGIN_ALREADY_REGISTERED" });
    expect(String(refused.body.reason)).toMatch(/passkey/);
    const verifyRefused = await h.post("/login/register/verify", { body: { challengeId: "x", credential: { id: "x" } } });
    expect(verifyRefused.body).toMatchObject({ ok: false, code: "LOGIN_ALREADY_REGISTERED" });
    const again = await h.register(first.cookie, "cred-2");
    expect(again.res.status).toBe(200);
    expect(again.body).toEqual({ ok: true });
    expect(await h.call({ op: "count" })).toBe(2);
  });

  it("verify: no cookie is SESSION_MISSING, a random cookie SESSION_UNKNOWN, an old one SESSION_EXPIRED, a non-member NOT_A_MEMBER", async () => {
    const h = harness();
    expect(await h.verify("/app/chat")).toMatchObject({ ok: false, code: "SESSION_MISSING", status: 401 });
    expect(await h.verify("/app/chat", `${SESSION_COOKIE}=not-a-token`)).toMatchObject({ ok: false, code: "SESSION_UNKNOWN", status: 401 });
    const { cookie } = await h.register();
    h.clock.advance(30 * 24 * 3600 * 1000 + 1);
    expect(await h.verify("/app/chat", cookie)).toMatchObject({ ok: false, code: "SESSION_EXPIRED", status: 401 });
    // The owner's session, once the Company no longer lists the owner as a member.
    const token = await h.call({ op: "mint", email: OWNER, needsPasskey: false });
    expect(await h.verify("/app/chat", `other=1; ${SESSION_COOKIE}=${token}`, async () => null)).toMatchObject({ ok: false, code: "NOT_A_MEMBER", status: 403 });
  });

  it("after /login/recover the session is PASSKEY_REQUIRED on /app/chat and ok on /login; adding a passkey then clears it and issues a fresh code", async () => {
    const h = harness();
    const { body: first } = await h.register();
    const wrong = await h.post("/login/recover", { body: { email: OWNER, code: "AAAAA-AAAAA-AAAAA-AAAAA" } });
    expect(wrong.res.status).toBe(403);
    expect(wrong.body).toMatchObject({ ok: false, code: "RECOVERY_CODE_INVALID" });
    const stranger = await h.post("/login/recover", { body: { email: "someone-else", code: first.recoveryCode } });
    expect(stranger.body).toMatchObject({ ok: false, code: "RECOVERY_CODE_INVALID" });

    const rec = await h.post("/login/recover", { body: { email: " Sam@Solo-Sam.example ", code: first.recoveryCode } });
    expect(rec.res.status).toBe(200);
    expect(rec.body).toEqual({ ok: true, needsPasskey: true });
    const cookie = cookieOf(rec.res);
    expect(await h.verify("/app/chat", cookie)).toMatchObject({ ok: false, code: "PASSKEY_REQUIRED", status: 403 });
    expect(await h.verify("/login", cookie)).toMatchObject({ ok: true });
    expect(await h.verify("/login/register/options", cookie)).toMatchObject({ ok: true });
    const spent = await h.post("/login/recover", { body: { email: OWNER, code: first.recoveryCode } });
    expect(spent.body).toMatchObject({ ok: false, code: "RECOVERY_CODE_SPENT" });

    const added = await h.register(cookie, "cred-2");
    expect(added.res.status).toBe(200);
    expect(String(added.body.recoveryCode).replaceAll("-", "")).toHaveLength(20);
    expect(await h.verify("/app/chat", added.cookie)).toMatchObject({ ok: true });
    expect(await h.verify("/app/chat", cookie)).toMatchObject({ ok: false, code: "SESSION_UNKNOWN" });
  });

  it("/logout revokes the session and clears the cookie; verify is then SESSION_MISSING", async () => {
    const h = harness();
    const { cookie } = await h.register();
    const out = await h.send("POST", "/logout", { cookie });
    expect(out.status).toBe(204);
    expect(out.headers.get("set-cookie")).toBe(`${SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`);
    expect(await h.verify("/app/chat")).toMatchObject({ ok: false, code: "SESSION_MISSING" });
    expect(await h.verify("/app/chat", cookie)).toMatchObject({ ok: false, code: "SESSION_UNKNOWN" });
  });

  it("the options endpoints embed a challenge that takeChallenge later consumes; a used or stale one is LOGIN_CHALLENGE_EXPIRED", async () => {
    const h = harness();
    const reg = await h.post("/login/register/options", { body: { setup: SETUP } });
    expect(reg.res.status).toBe(200);
    const challenge = (reg.body.options as Json).challenge;
    expect(challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await h.call({ op: "takeChallenge", id: String(reg.body.challengeId), kind: "register" })).toBe(challenge);
    const used = await h.post("/login/register/verify", { body: { setup: SETUP, challengeId: reg.body.challengeId, credential: { id: "c", challenge } } });
    expect(used.res.status).toBe(400);
    expect(used.body).toMatchObject({ ok: false, code: "LOGIN_CHALLENGE_EXPIRED" });

    await h.register();
    const auth = await h.post("/login/options");
    expect(auth.body.options).toMatchObject({ allowCredentials: [{ id: "cred-1" }] });
    expect(await h.call({ op: "takeChallenge", id: String(auth.body.challengeId), kind: "authenticate" })).toBe((auth.body.options as Json).challenge);

    const stale = await h.post("/login/options");
    h.clock.advance(300_001);
    const late = await h.post("/login/verify", { body: { challengeId: stale.body.challengeId, credential: { id: "cred-1", challenge: (stale.body.options as Json).challenge } } });
    expect(late.body).toMatchObject({ ok: false, code: "LOGIN_CHALLENGE_EXPIRED" });
  });

  it("sign-in: login/options then login/verify bumps the counter and sets the cookie; an unknown or failing credential is refused", async () => {
    const h = harness();
    await h.register();
    const sign = async (credential: (challenge: unknown) => Json) => {
      const o = await h.post("/login/options");
      return h.post("/login/verify", { body: { challengeId: o.body.challengeId, credential: credential((o.body.options as Json).challenge) } });
    };
    const ok = await sign((challenge) => ({ id: "cred-1", challenge }));
    expect(ok.res.status).toBe(200);
    expect(ok.body).toEqual({ ok: true });
    expect(ok.res.headers.get("set-cookie")).toContain(COOKIE_ATTRS);
    expect(await h.verify("/app/chat", cookieOf(ok.res))).toMatchObject({ ok: true });
    expect((await h.call({ op: "byId", id: "cred-1" }))?.counter).toBe(1);

    const unknown = await sign((challenge) => ({ id: "nope", challenge }));
    expect(unknown.res.status).toBe(400);
    expect(unknown.body).toMatchObject({ ok: false, code: "LOGIN_PASSKEY_UNKNOWN" });
    const bad = await sign(() => ({ id: "cred-1", challenge: "forged" }));
    expect(bad.res.status).toBe(400);
    expect(bad.body).toEqual({ ok: false, code: "LOGIN_PASSKEY_INVALID", reason: "challenge does not match" });
    const empty = await h.post("/login/verify", { body: "not an object" });
    expect(empty.body).toMatchObject({ ok: false, code: "LOGIN_BODY_INVALID" });
  });

  it("a passkey registered under another address does not sign in", async () => {
    const h = harness();
    await h.register();
    await h.call({ op: "add", id: "foreign", email: "a-former-owner", publicKey: new Uint8Array([1]), counter: 0, transports: [] });
    const o = await h.post("/login/options");
    const r = await h.post("/login/verify", { body: { challengeId: o.body.challengeId, credential: { id: "foreign", challenge: (o.body.options as Json).challenge } } });
    expect(r.res.status).toBe(403);
    expect(r.body).toMatchObject({ ok: false, code: "LOGIN_NOT_OWNER" });
  });

  it("refuses a state-changing request whose Origin is missing or foreign with LOGIN_ORIGIN", async () => {
    const h = harness();
    for (const origin of [null, "https://evil.example"]) {
      for (const path of ["/login/register/options", "/login/register/verify", "/login/options", "/login/verify", "/login/recover", "/logout"]) {
        const r = await h.post(path, { origin });
        expect(r.res.status, path).toBe(403);
        expect(r.body, path).toMatchObject({ ok: false, code: "LOGIN_ORIGIN" });
      }
      const del = await h.send("DELETE", "/login/passkeys/cred-1", { origin });
      expect(del.status).toBe(403);
    }
  });

  it("DELETE /login/passkeys/:id: owner session only, 404 for an unknown id, never the last passkey, else 204", async () => {
    const h = harness();
    const first = await h.register();
    // Adding a passkey rotates the session: the cookie it sets replaces the one it was given.
    const { cookie } = await h.register(first.cookie, "cred-2");
    expect(await h.verify("/app/chat", first.cookie)).toMatchObject({ ok: false, code: "SESSION_UNKNOWN" });
    const del = async (id: string, c?: string) => {
      const res = await h.send("DELETE", `/login/passkeys/${id}`, c ? { cookie: c } : {});
      const text = await res.text();
      return { status: res.status, body: text ? (JSON.parse(text) as Json) : null };
    };
    expect(await del("cred-2")).toMatchObject({ status: 401, body: { ok: false, code: "SESSION_MISSING" } });
    const code = await h.call({ op: "issueRecovery", email: OWNER });
    const rec = await h.post("/login/recover", { body: { email: OWNER, code } });
    expect(await del("cred-2", cookieOf(rec.res))).toMatchObject({ status: 403, body: { ok: false, code: "PASSKEY_REQUIRED" } });
    expect(await del("nope", cookie)).toMatchObject({ status: 404, body: { ok: false, code: "LOGIN_PASSKEY_UNKNOWN" } });
    expect(await del("cred-2", cookie)).toEqual({ status: 204, body: null });
    expect(await h.call({ op: "count" })).toBe(1);
    expect(await del("cred-1", cookie)).toMatchObject({ status: 409, body: { ok: false, code: "LOGIN_LAST_PASSKEY" } });
    const listed = await h.send("GET", "/login/passkeys", { cookie });
    expect(await listed.json()).toEqual({ ok: true, passkeys: [{ id: "cred-1", at: 5_000_000 }] });
  });

  it("GET /login serves the page: Create passkey before any is registered, Sign in after, under a strict CSP", async () => {
    const h = harness();
    const first = await h.send("GET", `/login?setup=${SETUP}`);
    expect(first.headers.get("x-content-type-options")).toBe("nosniff");
    expect(first.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(first.headers.get("content-security-policy")).toMatch(/default-src 'none'; script-src 'sha256-[A-Za-z0-9+/]+=*'/);
    const html = await first.text();
    expect(html).toContain("Create passkey");
    expect(html).not.toMatch(/\son[a-z]+=/);
    expect(html.match(/<script>/g)).toHaveLength(1);
    const { cookie } = await h.register();
    expect(await (await h.send("GET", "/login")).text()).toContain("Sign in");
    expect(await (await h.send("GET", "/login", { cookie })).text()).toContain("Add a passkey");
  });

  it("answers only its own paths", async () => {
    const h = harness();
    expect(await h.identity.routes(new Request(`${ORIGIN}/app/chat`), new URL(`${ORIGIN}/app/chat`))).toBeNull();
    expect(await h.identity.routes(new Request(`${ORIGIN}/login/verify`), new URL(`${ORIGIN}/login/verify`))).toBeNull();
  });

  it("the real ceremony: simplewebauthn verifies a software ES256 passkey's registration and assertion end to end", async () => {
    const h = harness(simpleWebAuthn);
    const key = await softAuthenticator(ORIGIN, "fletch.solo-sam.example");
    const ro = await h.post("/login/register/options", { body: { setup: SETUP } });
    const options = ro.body.options as { challenge: string; rp: { id: string; name: string }; authenticatorSelection: Json; attestation: string };
    expect(options.rp).toEqual({ id: "fletch.solo-sam.example", name: "fletch" });
    expect(options.attestation).toBe("none");
    expect(options.authenticatorSelection).toMatchObject({ residentKey: "preferred", userVerification: "preferred" });
    const reg = await h.post("/login/register/verify", { body: { setup: SETUP, challengeId: ro.body.challengeId, credential: await key.create(options) } });
    expect(reg.body).toMatchObject({ ok: true });
    expect((await h.call({ op: "list" }))[0]?.id).toBe(key.id);

    const lo = await h.post("/login/options");
    const assertion = await key.get(lo.body.options as { challenge: string });
    const signed = await h.post("/login/verify", { body: { challengeId: lo.body.challengeId, credential: assertion } });
    expect(signed.body).toEqual({ ok: true });
    expect((await h.call({ op: "byId", id: key.id }))?.counter).toBe(1);

    // A replayed assertion under a fresh challenge fails the real check, with the reason in words.
    const again = await h.post("/login/options");
    const replay = await h.post("/login/verify", { body: { challengeId: again.body.challengeId, credential: assertion } });
    expect(replay.res.status).toBe(400);
    expect(replay.body).toMatchObject({ ok: false, code: "LOGIN_PASSKEY_INVALID" });
    expect(String(replay.body.reason)).toMatch(/challenge/i);

    // A response made for another origin fails too.
    const foreign = await softAuthenticator("https://evil.example", "fletch.solo-sam.example");
    const ro2 = await h.post("/login/register/options", { cookie: cookieOf(signed.res) });
    const forged = await h.post("/login/register/verify", { cookie: cookieOf(signed.res), body: { challengeId: ro2.body.challengeId, credential: await foreign.create(ro2.body.options as { challenge: string }) } });
    expect(forged.body).toMatchObject({ ok: false, code: "LOGIN_PASSKEY_INVALID" });
  });
});

describe("[F1] first-run setup and session hygiene", () => {
  it("first registration needs the setup token: none or a wrong one is LOGIN_SETUP_REQUIRED and names no owner; the right one succeeds", async () => {
    const h = harness();
    for (const body of [{}, { setup: "wrong" }, { setup: `${SETUP}x` }]) {
      const o = await h.send("POST", "/login/register/options", { body });
      expect(o.status).toBe(403);
      const text = await o.text();
      expect(JSON.parse(text)).toMatchObject({ ok: false, code: "LOGIN_SETUP_REQUIRED" });
      expect(text.toLowerCase()).not.toContain("sam");
      const v = await h.post("/login/register/verify", { body: { ...body, challengeId: "x", credential: { id: "x" } } });
      expect(v.body).toMatchObject({ ok: false, code: "LOGIN_SETUP_REQUIRED" });
    }
    expect(await h.call({ op: "count" })).toBe(0);
    const { res } = await h.register();
    expect(res.status).toBe(200);
    // Once a passkey exists the token grants nothing: adding one needs the owner's session.
    const again = await h.post("/login/register/options", { body: { setup: SETUP } });
    expect(again.body).toMatchObject({ ok: false, code: "LOGIN_ALREADY_REGISTERED" });
  });

  it("with no SETUP_TOKEN configured first registration fails closed with LOGIN_SETUP_UNAVAILABLE", async () => {
    const h = harness(fakeVerifier, null);
    for (const path of ["/login/register/options", "/login/register/verify"]) {
      const r = await h.post(path, { body: { setup: SETUP, challengeId: "x", credential: { id: "x" } } });
      expect(r.res.status, path).toBe(503);
      expect(r.body, path).toMatchObject({ ok: false, code: "LOGIN_SETUP_UNAVAILABLE" });
      // The commands it names exist today: create-fletch runs from a checkout (no `npm create fletch` yet).
      expect(String(r.body.reason)).toContain("pnpm --dir <checkout> create-fletch");
      expect(String(r.body.reason)).toContain("wrangler secret put SETUP_TOKEN");
      expect(String(r.body.reason)).not.toMatch(/npm create fletch|fletch init/);
    }
  });

  it("GET /login before setup without a valid ?setup= explains the setup link, the same page whether or not a token is configured", async () => {
    const h = harness();
    const unset = harness(fakeVerifier, null);
    const missing = await (await h.send("GET", "/login")).text();
    expect(missing).toContain("setup link");
    expect(missing).toContain("pnpm --dir &lt;checkout&gt; create-fletch");
    expect(missing).not.toMatch(/npm create fletch|fletch init/);
    expect(missing).not.toContain("Create passkey");
    expect(await (await h.send("GET", "/login?setup=wrong")).text()).toBe(missing);
    expect(await (await unset.send("GET", "/login")).text()).toBe(missing);
    expect(await (await unset.send("GET", `/login?setup=${SETUP}`)).text()).toBe(missing);
    expect(await (await h.send("GET", `/login?setup=${SETUP}`)).text()).toContain("Create passkey");
  });

  it("two concurrent first registrations: one passkey is stored, the other is LOGIN_ALREADY_REGISTERED", async () => {
    const h = harness();
    const start = async (id: string) => {
      const o = await h.post("/login/register/options", { body: { setup: SETUP } });
      return { setup: SETUP, challengeId: o.body.challengeId, credential: { id, challenge: (o.body.options as Json).challenge } };
    };
    const [a, b] = [await start("cred-a"), await start("cred-b")];
    const results = await Promise.all([h.post("/login/register/verify", { body: a }), h.post("/login/register/verify", { body: b })]);
    expect(results.map((r) => r.res.status).sort()).toEqual([200, 403]);
    expect(results.find((r) => r.res.status === 403)?.body).toMatchObject({ ok: false, code: "LOGIN_ALREADY_REGISTERED" });
    expect(await h.call({ op: "count" })).toBe(1);
  });

  it("/login/verify and /login/recover revoke the session the request already carries", async () => {
    const h = harness();
    const { cookie, body } = await h.register();
    const o = await h.post("/login/options");
    const signed = await h.post("/login/verify", { cookie, body: { challengeId: o.body.challengeId, credential: { id: "cred-1", challenge: (o.body.options as Json).challenge } } });
    expect(signed.res.status).toBe(200);
    expect(await h.verify("/app/chat", cookie)).toMatchObject({ ok: false, code: "SESSION_UNKNOWN" });
    const fresh = cookieOf(signed.res);
    const rec = await h.post("/login/recover", { cookie: fresh, body: { email: OWNER, code: body.recoveryCode } });
    expect(rec.res.status).toBe(200);
    expect(await h.verify("/app/chat", fresh)).toMatchObject({ ok: false, code: "SESSION_UNKNOWN" });
  });

  it("JSON answers carry nosniff", async () => {
    const h = harness();
    const r = await h.post("/login/options");
    expect(r.res.headers.get("x-content-type-options")).toBe("nosniff");
    expect((await h.send("POST", "/logout")).headers.get("x-content-type-options")).toBe("nosniff");
  });
});
