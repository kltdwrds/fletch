// F1: the login page in hermetic Chromium, end to end. Every request the browser makes goes through the production
// `serve()` with the real `passkeyIdentity` over a harnessed Company (sessions and passkeys in its storage) and the
// production WebAuthn verifier; the authenticator is Chromium's own virtual one (CDP `WebAuthn`). The path is the
// owner's first visit: a signed-out visit to `/` lands on the sign-in page, the setup link creates the passkey and
// shows the recovery code once (tap to copy, a confirmed leave), the app's Log out ends the session and returns to sign-in, the passkey signs in
// again, and a session revoked under the open app sends its next API call to sign-in.
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { type Browser, chromium, type Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from "vitest";
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
    // On CI this test timed out at its 60 s budget with no step named (2026-11-08, three runs of six): the step in
    // progress is kept here and printed on failure, so a timeout says where the page stopped (it was the last step).
    let at = "start";
    // The last requests the deploy answered name a 401 that arrived late (the flake of run 42548430932, below).
    onTestFailed(() => console.error(`f1-login-browser: failed at step "${at}", page at ${pg.url()}; last requests ${JSON.stringify(d.seen.slice(-6))}`));
    // Every navigation request to /login the browser issues: the page leaves for sign-in once, however many 401s land.
    const leaves: string[] = [];
    pg.on("request", (r) => {
      if (r.isNavigationRequest() && new URL(r.url()).pathname === "/login") leaves.push(r.url());
    });
    try {
      // Signed out, the app's own address sends the browser to sign-in; before any passkey that is the setup notice.
      at = "signed out: / sends to /login";
      await pg.goto(`${ORIGIN}/`);
      expect(new URL(pg.url()).pathname).toBe("/login");
      expect(await stateOf(pg)).toBe("setup");
      expect(d.seen[0]).toEqual({ method: "GET", path: "/", status: 302 });

      // The setup link: create the passkey; the recovery code is shown once.
      at = "setup link: register the passkey";
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

      at = "recovery code: copy feedback";
      // Tapping the code copies it. A missing clipboard and a refused write each say so and select the code instead;
      // the keyboard reaches the same copy.
      const feedback = (text: string) => pg.locator("#copied", { hasText: text }).waitFor();
      const clear = () => pg.evaluate('document.getElementById("copied").textContent = ""; getSelection().removeAllRanges()');
      await pg.evaluate("Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true })");
      await pg.click("#code");
      await feedback("Could not copy it here.");
      expect(await pg.evaluate("getSelection().toString().trim()")).toBe(code);
      await clear();
      await pg.evaluate("Object.defineProperty(navigator, 'clipboard', { value: { writeText: () => Promise.reject(new Error('denied')) }, configurable: true })");
      await pg.focus("#code");
      await pg.keyboard.press("Enter");
      await feedback("Could not copy it here.");
      expect(await pg.textContent("#copied")).not.toContain("Copied");
      await clear();
      await pg.evaluate("delete navigator.clipboard");
      await pg.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin: ORIGIN });
      await pg.keyboard.press(" ");
      await feedback("Copied.");
      expect(await pg.evaluate("navigator.clipboard.readText()")).toBe(code);

      at = "done: first click arms";
      // The first click on the done button only arms it, since the code is gone once the page is left; the second leaves.
      await pg.click("#done");
      await pg.locator("#done", { hasText: "It is not shown again. Click again to leave" }).waitFor();
      expect(new URL(pg.url()).pathname).toBe("/login");
      expect(await shown(pg, "saved")).toBe(true);

      at = "done: second click, wait for /";
      // On to the app, which reads this owner's session. The wait starts before the click: the app moves on from `/` to
      // its open chat as soon as it loads, so a wait begun after the click can miss `/` and hang to the timeout.
      await Promise.all([pg.waitForURL(`${ORIGIN}/`), pg.click("#done")]);
      at = "app: logout button wired";
      await pg.waitForFunction('typeof document.getElementById("logout")?.onclick === "function"');
      at = "app: boot settled (the open chat's address, the panel's /me drawn)";
      // The boot's reads are still in flight when the button is wired (the chat list moves the address to the open
      // chat, the panel reads /me into #handle). Log out clears the cookie, so a read answered after it is a 401, and
      // a 401 leaves for /login too: wait for the boot to settle on state, never on time (CI run 42548430932 logged out
      // at 1.2 s and the second leave aborted the first, `net::ERR_ABORTED` under waitForURL).
      await pg.waitForURL(/\/chats\/[^/]+$/);
      await pg.locator("#handle", { hasText: `${ada.email}/agent` }).waitFor({ state: "attached" });
      expect(d.seen.some((s) => s.path === "/me" && s.status === 200)).toBe(true);

      at = "log out: POST /logout, wait for /login";
      // Log out: a same-origin POST to /logout, then sign-in. The URL wait starts before the click (gotcha 5).
      leaves.length = 0;
      await Promise.all([pg.waitForURL(`${ORIGIN}/login`), pg.evaluate('document.getElementById("logout").click()')]);
      expect(d.seen).toContainEqual({ method: "POST", path: "/logout", status: 204 });
      expect(leaves).toHaveLength(1);
      expect(await stateOf(pg)).toBe("authenticate");
      at = "signed out again: / sends to /login, /me is 401";
      // The session is gone: the app's address sends the browser back to sign-in, and an API call is a JSON 401.
      await pg.goto(`${ORIGIN}/`);
      expect(new URL(pg.url()).pathname).toBe("/login");
      const api = await pg.evaluate("fetch('/me').then(async (r) => [r.status, (await r.json()).code])");
      expect(api).toEqual([401, "SESSION_MISSING"]);

      at = "sign in with the passkey, wait for /";
      // Sign in with the passkey: back in the app.
      await Promise.all([pg.waitForURL(`${ORIGIN}/`), pg.click("#go")]);
      expect(await pg.evaluate("fetch('/me').then((r) => r.json())")).toMatchObject({ person: ada.email, shape: "standalone" });
      // A standalone deploy's owner is offered no Invite (spec section 4).
      expect(await shown(pg, "head-invite")).toBe(false);

      at = "revoked elsewhere: next API call sends to /login";
      // The session ends under the open app (revoked elsewhere): the app's next API call sends it to sign-in.
      const cookie = (await pg.context().cookies()).find((c) => c.name === SESSION_COOKIE);
      expect(cookie?.httpOnly).toBe(true);
      await d.company.loginCall({ op: "revoke", token: cookie?.value ?? "" });
      // The page's api() leaves for /login on the 401 (`toLogin`), so the calls are fired and not awaited inside the
      // page (an awaited promise there has no context to settle in once the navigation commits, and the evaluate hung
      // to the test's timeout on CI), and the URL wait starts before them, as above. Two reads answered 401 back to
      // back are one leave: the page issues one navigation to /login, not a second that aborts the first.
      leaves.length = 0;
      const since = d.seen.length;
      await Promise.all([pg.waitForURL(`${ORIGIN}/login`), pg.evaluate("void Promise.all([getJson('/me'), getJson('/app/chats')]).catch(() => null)")]);
      expect(await stateOf(pg)).toBe("authenticate");
      expect(d.seen.slice(since).filter((s) => s.status === 401)).toHaveLength(2);
      expect(leaves).toHaveLength(1);
    } finally {
      await b.close();
      await site.close();
    }
  }, 60_000);
});
