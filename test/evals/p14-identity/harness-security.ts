// T-P14-04's harness (F41): Settings > Security in hermetic Chromium over the production request path. Every request
// the browser makes reaches a local server that hands it to the production `serve()` with the real `passkeyIdentity`
// over a harnessed Company (its sessions and passkeys in its own storage), as `f1-login-browser.test.ts` does; the
// host's login routes answer `/login/passkeys` unchanged. Sam (`sam@solo-sam.example`) owns the deploy and has two
// passkeys, added 3 March and 14 September 2026; Pat (`pat@solo-sam.example`) is a member of the company tenant with a
// session of her own and no passkey (a passkey deploy registers only its owner's, and the routes list every one on it);
// Sam's second session is a recovery sign-in (`needsPasskey`). Turns:
//   - `security` (payload `as`, `width`): the pane read at 1280 or 390. Sam's and Pat's open `/settings/security`
//     under their own session. A recovery session cannot load the app at all (the host refuses every page with
//     PASSKEY_REQUIRED, recorded as `refusedLoad`), so the recovery pane is the one a recovery sign-in in another tab
//     leaves an open page with: the app is open under Sam's passkey session, the browser's cookie becomes the
//     recovery session's, and Security is opened from General;
//   - `remove` (payload `which`: `first` or `last`): Remove pressed on Sam's open pane at 1280, the DELETE's answer and
//     the rows after the redraw recorded;
//   - `add`: Add a passkey pressed on that pane, and where the browser went (`added`, and the sign-in page's state);
//   - `reload` (payload `route`, `width`): the route opened at that width, reloaded, and whether Security was drawn
//     both times.
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { passkeyIdentity, runLoginCall, SESSION_COOKIE } from "@qyvr/host-cloudflare";
import { type Browser, type BrowserContext, chromium, type Page } from "playwright-core";
import { serve } from "../../../packages/agent/src/http/serve.ts";
import type { Snapshot } from "../../support/scenario.ts";
import type { TaskHarness, Turn } from "../../support/task.ts";
import { authorityWorld, TENANT } from "../../workers/support/authority-world.ts";
import { pat, sam } from "./harness.ts";
import type { P14SecurityWorld } from "./world.ts";

type As = "sam" | "sam-recovery" | "pat";
/** The two passkeys' dates, the specimen's. */
export const ADDED = [Date.UTC(2026, 2, 3, 12), Date.UTC(2026, 8, 14, 12)];

/** The deploy: the authority world's objects behind `serve()`, the passkey identity over its Company. */
export function securityDeploy() {
  const w = authorityWorld({ shape: "company", seed: [sam, pat] as never });
  const company = w.companyHarness().instance;
  const identity = passkeyIdentity({ call: async (c) => company.loginCall(c) as never, owner: sam.email, tenant: TENANT, now: () => Date.now() });
  const env = { ...w.env, QYVR_ENV: "self-host", OWNER_EMAIL: sam.email, HOST: { ...w.env.HOST, identity } };
  const handle = (request: Request) => serve(request, env as never, { tenant: TENANT }, { dir: w.dir, now: () => Date.now() });
  const storage = (company as unknown as { ctx: { storage: DurableObjectStorage } }).ctx.storage;
  const seed = async () => {
    // The store stamps a passkey with its clock: each is added at its own date, through the store's own op.
    for (const [i, at] of ADDED.entries()) await runLoginCall(storage, () => at, { op: "add", id: `passkey-${i + 1}`, email: sam.email, publicKey: new Uint8Array(65).fill(i + 1), counter: 0, transports: ["internal"] });
    return {
      sam: await company.loginCall({ op: "mint", email: sam.email, needsPasskey: false }),
      "sam-recovery": await company.loginCall({ op: "mint", email: sam.email, needsPasskey: true }),
      pat: await company.loginCall({ op: "mint", email: pat.email, needsPasskey: false }),
    } as Record<As, string>;
  };
  return { w, company, handle, seed };
}

/** The deploy on a local port, as a Worker would take each request (localhost is a secure context, so the session's cookie works). */
export async function listen(handle: (r: Request) => Promise<Response>): Promise<{ origin: string; close(): Promise<void> }> {
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

const PANE = "#set-pane-security";
const DRAWN = '#passkey-card[aria-busy="false"]';
const ROWS = '#passkey-card [data-kind="passkey"]';
/** Whether the pane was drawn: its card done reading, or else the router's not-found view (a page without the pane). */
const settle = (pg: Page) =>
  pg.locator(`${DRAWN}, #nowhere:not([hidden])`).first().waitFor({ state: "attached", timeout: 20_000 }).then(
    async () => (await pg.locator(DRAWN).count()) > 0,
    () => false,
  );

export class P14Security implements P14SecurityWorld {
  readonly pane: P14SecurityWorld["pane"] = [];
  readonly removed: P14SecurityWorld["removed"] = [];
  added: string | null = null;
  /** The sign-in page's state where Add a passkey went (`add` for the owner's session). */
  addState: string | null = null;
  routeReload: P14SecurityWorld["routeReload"] = null;
  /** The recovery session's own page load of `/settings/security`: its status and code. */
  refusedLoad: { status: number; code: string | null } | null = null;
  private samPage: Page | null = null;
  private readonly contexts: BrowserContext[] = [];
  private readonly browser: Browser;
  private readonly origin: string;
  private readonly tokens: Record<As, string>;
  constructor(browser: Browser, origin: string, tokens: Record<As, string>) {
    this.browser = browser;
    this.origin = origin;
    this.tokens = tokens;
  }

  /** The pane writes nothing a snapshot counts: the passkeys are the Company's login store, read and removed by the host's routes. */
  snapshot(): Snapshot {
    return { journal: [], vault: [], r2: [] };
  }

  private async context(width: number, as: As): Promise<BrowserContext> {
    const ctx = await this.browser.newContext({ viewport: { width, height: width > 600 ? 900 : 844 }, serviceWorkers: "block", reducedMotion: "reduce", timezoneId: "UTC", locale: "en-GB" });
    await ctx.routeWebSocket(/.*/, () => {});
    await this.as(ctx, as);
    this.contexts.push(ctx);
    return ctx;
  }

  private as(ctx: BrowserContext, as: As) {
    return ctx.addCookies([{ name: SESSION_COOKIE, value: this.tokens[as], url: this.origin }]);
  }

  private async read(pg: Page, as: As, width: "desktop" | "phone"): Promise<void> {
    if (!(await settle(pg))) {
      this.pane.push({ as, width, rows: [], words: "", dom: "" });
      return;
    }
    const rows = (await pg.locator(ROWS).allInnerTexts()).map((t) => t.replace(/\s+/g, " ").trim());
    this.pane.push({ as, width, rows, words: (await pg.locator(PANE).innerText()).replace(/\s+/g, " ").trim(), dom: await pg.locator(PANE).innerHTML() });
  }

  private async sam(): Promise<Page> {
    if (!this.samPage) {
      this.samPage = await (await this.context(1280, "sam")).newPage();
      await this.samPage.goto(`${this.origin}/settings/security`);
      await settle(this.samPage);
    }
    return this.samPage;
  }

  async play(turn: Turn): Promise<void> {
    if (turn.kind !== "event") throw new Error(`P14_SECURITY_TURN: ${turn.kind}`);
    const p = (turn.payload ?? {}) as { as?: As; width?: string; which?: string; route?: string };
    const width = p.width === "phone" ? "phone" : "desktop";
    const px = width === "phone" ? 390 : 1280;
    if (turn.name === "security") {
      const as = p.as ?? "sam";
      const ctx = await this.context(px, as === "sam-recovery" ? "sam" : as);
      const pg = await ctx.newPage();
      if (as === "sam-recovery") {
        const load = await ctx.request.get(`${this.origin}/settings/security`, { headers: { cookie: `${SESSION_COOKIE}=${this.tokens["sam-recovery"]}` }, maxRedirects: 0 });
        this.refusedLoad = { status: load.status(), code: ((await load.json().catch(() => ({}))) as { code?: string }).code ?? null };
        await pg.goto(`${this.origin}/settings/general`);
        await pg.locator("#set-security").waitFor({ state: "attached" });
        await this.as(ctx, "sam-recovery");
        await pg.locator("#set-security").click();
      } else await pg.goto(`${this.origin}/settings/security`);
      await this.read(pg, as, width);
    } else if (turn.name === "remove") {
      const pg = await this.sam();
      const buttons = pg.locator(`${ROWS} button`);
      if ((await buttons.count()) === 0) return;
      const del = pg.waitForResponse((r) => r.request().method() === "DELETE");
      const redraw = pg.waitForResponse((r) => r.request().method() === "GET" && new URL(r.url()).pathname === "/login/passkeys");
      await (p.which === "last" ? buttons.last() : buttons.first()).click();
      const d = await del;
      await redraw;
      await pg.locator(DRAWN).waitFor({ state: "attached" });
      const body = d.status() === 204 ? {} : ((await d.json().catch(() => ({}))) as { code?: string });
      this.removed.push({ id: decodeURIComponent(new URL(d.url()).pathname.split("/").pop() ?? ""), status: d.status(), code: body.code ?? null, rowsAfter: await pg.locator(ROWS).count() });
    } else if (turn.name === "add") {
      const pg = await this.sam();
      if (!(await pg.locator("#passkey-add").isVisible())) return;
      const nav = pg.waitForRequest((r) => r.isNavigationRequest());
      await pg.locator("#passkey-add").click();
      this.added = new URL((await nav).url()).pathname;
      await pg.waitForLoadState("load");
      this.addState = (await pg.evaluate("document.body.dataset.state")) as string | null;
    } else if (turn.name === "reload") {
      const route = p.route ?? "/settings/security";
      const pg = await (await this.context(px, "sam")).newPage();
      const drawn = async () => {
        if (!(await settle(pg))) return false;
        return (await pg.locator(PANE).isVisible()) && (await pg.locator("#set-title").innerText()) === "Security" && !(await pg.locator("#nowhere").isVisible());
      };
      await pg.goto(`${this.origin}${route}`);
      const before = await drawn();
      await pg.reload();
      this.routeReload = { route, drawn: before && (await drawn()) };
    } else throw new Error(`P14_SECURITY_EVENT: ${turn.name}`);
  }

  async close(): Promise<void> {
    for (const c of this.contexts) await c.close();
  }
}

type Handle = (r: Request) => Promise<Response>;
/** A planted fault: the request path with something taken out of it, given the deploy and its sessions. */
export type Plant = (handle: Handle, d: { company: ReturnType<typeof securityDeploy>["company"]; tokens: Record<As, string> }) => Handle;

let shared: Promise<Browser> | null = null;
/** The one Chromium every T-P14-04 harness in a file opens its contexts in, launched on first use. */
const sharedBrowser = () => (shared ??= chromium.launch({ channel: "chromium", headless: true }));
/** Closes the shared Chromium, after every harness over it is closed. */
export async function closeSecurityBrowser(): Promise<void> {
  const b = shared;
  shared = null;
  await (await b)?.close();
}

/** T-P14-04's harness over the shared Chromium; `close` ends its contexts and server. `plant` wraps the request path (the planted runs). */
export function p14SecurityHarness(o: { plant?: Plant } = {}): TaskHarness<P14SecurityWorld> & { close(): Promise<void>; last(): P14Security | null } {
  const sites: Array<{ close(): Promise<void> }> = [];
  let world: P14Security | null = null;
  return {
    setup: async () => {
      const browser = await sharedBrowser();
      const d = securityDeploy();
      const tokens = await d.seed();
      const site = await listen(o.plant ? o.plant(d.handle, { company: d.company, tokens }) : d.handle);
      sites.push(site);
      world = new P14Security(browser, site.origin, tokens);
      return world;
    },
    play: async (w, turn) => (w as P14Security).play(turn),
    last: () => world,
    close: async () => {
      await world?.close();
      for (const s of sites) await s.close();
    },
  };
}
