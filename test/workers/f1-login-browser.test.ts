// F1: the login page in hermetic Chromium, end to end. Every request the browser makes goes through the production
// `serve()` with the real `passkeyIdentity` over a harnessed Company (sessions and passkeys in its storage) and the
// production WebAuthn verifier; the authenticator is Chromium's own virtual one (CDP `WebAuthn`). The path is the
// owner's first visit: a signed-out visit to `/` lands on the sign-in page, the setup link creates the passkey and
// shows the recovery code once, the app's Log out ends the session and returns to sign-in, the passkey signs in
// again, and a session revoked under the open app sends its next API call to sign-in.
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { type Browser, chromium, type Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { passkeyIdentity, SESSION_COOKIE } from "@qyvr/host-cloudflare";
import { serve } from "../../packages/agent/src/http/serve.ts";
import { ada, authorityWorld, TENANT } from "./support/authority-world.ts";

const SETUP_TOKEN = "setup-token-for-the-browser-test";

let browser: Browser;
beforeAll(async () => {
  browser = await chromium.launch({ channel: "chromium", headless: true });
}, 120_000);
afterAll(async () => {
  await browser?.close();
});

/** A self-host deploy's request path: the world's objects behind `serve()`, the passkey identity over its Company. */
function deploy() {
  const w = authorityWorld({ shape: "standalone" });
  const company = w.companyHarness().instance;
  const identity = passkeyIdentity({ call: async (c) => company.loginCall(c) as never, owner: ada.email, tenant: TENANT, now: () => Date.now(), setupToken: SETUP_TOKEN });
  const env = { ...w.env, QYVR_ENV: "self-host", OWNER_EMAIL: ada.email, HOST: { ...w.env.HOST, identity } };
  const seen: Array<{ method: string; path: string; status: number }> = [];
  const handle = async (request: Request) => {
    const res = await serve(request, env as never, { tenant: TENANT }, { dir: w.dir, now: () => Date.now() });
    seen.push({ method: request.method, path: new URL(request.url).pathname, status: res.status });
    return res;
  };
  return { w, company, handle, seen };
}

/**
 * The deploy on a local port: Chromium does not route the request a fulfilled redirect leads to, so the requests reach a
 * real server, which hands each one to `handle` as a Worker would. localhost is a secure context, so WebAuthn (rpId
 * `localhost`) and the session's Secure cookie work over plain http.
 */
async function listen(handle: (r: Request) => Promise<Response>): Promise<{ origin: string; close(): Promise<void> }> {
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers.set(k, v);
    const method = req.method ?? "GET";
    const answer = await handle(new Request(`http://localhost:${port}${req.url}`, { method, headers, ...(method !== "GET" && method !== "HEAD" ? { body: Buffer.concat(chunks) } : {}) }));
    const out: Record<string, string | string[]> = {};
    answer.headers.forEach((v, k) => {
      if (k !== "set-cookie") out[k] = v;
    });
    const cookies = answer.headers.getSetCookie();
    if (cookies.length) out["set-cookie"] = cookies;
    res.writeHead(answer.status, out);
    res.end(Buffer.from(await answer.arrayBuffer()));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;
  return { origin: `http://localhost:${port}`, close: () => new Promise((r) => server.close(() => r())) };
}

/** A browser with a virtual platform authenticator. */
async function owner(): Promise<{ pg: Page; close(): Promise<void> }> {
  const ctx = await browser.newContext({ serviceWorkers: "block", timezoneId: "UTC", locale: "en-US" });
  await ctx.routeWebSocket(/.*/, () => {});
  const pg = await ctx.newPage();
  const cdp = await ctx.newCDPSession(pg);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  });
  return { pg, close: () => ctx.close() };
}

const stateOf = (pg: Page) => pg.evaluate("document.body.dataset.state") as Promise<string | undefined>;
const shown = (pg: Page, id: string) => pg.evaluate(`!document.getElementById(${JSON.stringify(id)}).hidden`) as Promise<boolean>;

describe("[F1] the login page in a browser", () => {
  it("setup link, passkey, recovery code, Log out, sign in again: each step through serve() and the real verifier", async () => {
    const d = deploy();
    const site = await listen(d.handle);
    const ORIGIN = site.origin;
    const b = await owner();
    const pg = b.pg;
    try {
      // Signed out, the app's own address sends the browser to sign-in; before any passkey that is the setup notice.
      await pg.goto(`${ORIGIN}/`);
      expect(new URL(pg.url()).pathname).toBe("/login");
      expect(await stateOf(pg)).toBe("setup");
      expect(d.seen[0]).toEqual({ method: "GET", path: "/", status: 302 });

      // The setup link: create the passkey; the recovery code is shown once.
      await pg.goto(`${ORIGIN}/login?setup=${SETUP_TOKEN}`);
      expect(await stateOf(pg)).toBe("register");
      await pg.click("#go");
      // A locator's wait, not waitForFunction: the page's CSP allows only its own script, so no string is evaluated in it.
      await pg.locator("#saved:not([hidden]), #error:not([hidden])").first().waitFor();
      expect(await shown(pg, "error")).toBe(false);
      expect(await shown(pg, "saved")).toBe(true);
      const code = (await pg.textContent("#code"))?.trim() ?? "";
      expect(code.length).toBeGreaterThanOrEqual(16);
      expect(await d.company.loginCall({ op: "count" })).toBe(1);

      // On to the app, which reads this owner's session.
      await pg.click("#done");
      await pg.waitForURL(`${ORIGIN}/`);
      await pg.waitForFunction('typeof document.getElementById("logout")?.onclick === "function"');
      expect(d.seen.some((s) => s.path === "/me" && s.status === 200)).toBe(true);

      // Log out: a same-origin POST to /logout, then sign-in.
      await pg.evaluate('document.getElementById("logout").click()');
      await pg.waitForURL(`${ORIGIN}/login`);
      expect(d.seen).toContainEqual({ method: "POST", path: "/logout", status: 204 });
      expect(await stateOf(pg)).toBe("authenticate");
      // The session is gone: the app's address sends the browser back to sign-in, and an API call is a JSON 401.
      await pg.goto(`${ORIGIN}/`);
      expect(new URL(pg.url()).pathname).toBe("/login");
      const api = await pg.evaluate("fetch('/me').then(async (r) => [r.status, (await r.json()).code])");
      expect(api).toEqual([401, "SESSION_MISSING"]);

      // Sign in with the passkey: back in the app.
      await pg.click("#go");
      await pg.waitForURL(`${ORIGIN}/`);
      expect(await pg.evaluate("fetch('/me').then((r) => r.json())")).toMatchObject({ person: ada.email, shape: "standalone" });
      // A standalone deploy's owner is offered no Invite (spec section 4).
      expect(await shown(pg, "head-invite")).toBe(false);

      // The session ends under the open app (revoked elsewhere): the app's next API call sends it to sign-in.
      const cookie = (await pg.context().cookies()).find((c) => c.name === SESSION_COOKIE);
      expect(cookie?.httpOnly).toBe(true);
      await d.company.loginCall({ op: "revoke", token: cookie?.value ?? "" });
      await pg.evaluate("getJson('/me').catch(() => null)");
      await pg.waitForURL(`${ORIGIN}/login`);
      expect(await stateOf(pg)).toBe("authenticate");
    } finally {
      await b.close();
      await site.close();
    }
  }, 60_000);
});
