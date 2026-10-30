// T-P14-07's harness (F40): the m27 settings and panel world in hermetic Chromium. Sam of a standalone deploy, every
// request answered by the authority world's routes (`servePages`, F4's), every socket held in the test, and every
// request the page makes recorded by its origin before the route answers or aborts it. Turns:
//   - `route` (payload `route`, `width`): the route drawn, read, reloaded and read again; `panel` is `/chats/<c1>` with
//     the panel's Identity tab open;
//   - `mode` (payload `mode`): `/settings/general` at 1280, the mode's button pressed, the page reloaded, and the stored
//     and applied mode read.
import { type Browser, type BrowserContext, chromium, type Page } from "playwright-core";
import { MODE_KEY } from "../../../packages/agent/src/http/app/settings.ts";
import { APP_PAGE } from "../../../packages/agent/src/http/page.ts";
import type { Snapshot } from "../../support/scenario.ts";
import type { TaskHarness, Turn } from "../../support/task.ts";
import { ada, authorityWorld } from "../../workers/support/authority-world.ts";
import { PAGE_ORIGIN, servePages } from "../../workers/support/page-routes.ts";
import type { ModeRead, P14BrowserWorld, RouteDraw } from "./world.ts";

/** The visible controls whose right edge passes the viewport's, outside any box that scrolls sideways. */
const CLIPPED = `(() => {
  const scrolls = (e) => { for (let p = e.parentElement; p; p = p.parentElement) { const o = getComputedStyle(p).overflowX; if (o === "auto" || o === "scroll" || o === "hidden") return true; } return false; };
  return [...document.querySelectorAll("button, a, input, select, textarea, [role=tab], [role=switch]")]
    .filter((e) => e.checkVisibility() && e.getBoundingClientRect().width > 0 && e.getBoundingClientRect().right > innerWidth + 0.5 && !scrolls(e))
    .map((e) => e.tagName.toLowerCase() + (e.id ? "#" + e.id : "") + (e.className && typeof e.className === "string" ? "." + e.className.split(" ")[0] : ""));
})()`;

export class P14Browser implements P14BrowserWorld {
  readonly routes: RouteDraw[] = [];
  mode: ModeRead | null = null;
  readonly origin = PAGE_ORIGIN;
  private readonly seen: Array<{ origin: string; url: string; body: string }> = [];
  private readonly browser: Browser;
  private readonly w: ReturnType<typeof authorityWorld>;
  private readonly chat: string;
  constructor(browser: Browser, w: ReturnType<typeof authorityWorld>, chat: string) {
    this.browser = browser;
    this.w = w;
    this.chat = chat;
  }

  /** The page writes nothing a snapshot counts: the turns only read and switch this browser's mode. */
  snapshot(): Snapshot {
    return { journal: [], vault: [], r2: [] };
  }

  origins(): string[] {
    return this.seen.map((s) => s.origin);
  }

  private async context(width: number): Promise<BrowserContext> {
    const ctx = await this.browser.newContext({ viewport: { width, height: width > 600 ? 900 : 844 }, serviceWorkers: "block", reducedMotion: "reduce" });
    await ctx.routeWebSocket(/.*/, () => {});
    ctx.on("request", (r) => {
      const u = new URL(r.url());
      if (u.protocol !== "data:" && u.protocol !== "blob:") this.seen.push({ origin: u.origin, url: r.url(), body: r.postData() ?? "" });
    });
    await servePages(ctx, (m, p, body) => this.w.http(ada.email, m, p, body), APP_PAGE);
    return ctx;
  }

  private async read(pg: Page, route: string, width: 1280 | 390, when: "before" | "after"): Promise<void> {
    await pg.waitForFunction("document.readyState === 'complete'");
    let card: string | null = null;
    if (route === "panel") {
      await pg.waitForSelector("#open-agent", { state: "attached" });
      await pg.evaluate('document.getElementById("open-agent").click()');
      await pg.evaluate('document.getElementById("panel-tab-identity").click()');
      await pg.waitForFunction('!document.getElementById("panel-identity").hidden');
      card = ((await pg.textContent(".qf-idname")) ?? "").replace(/\s+/g, " ").trim();
    }
    this.routes.push({ route, width, when, missing: await pg.evaluate('!document.getElementById("nowhere").hidden'), clipped: await pg.evaluate(CLIPPED), card });
  }

  async play(turn: Turn): Promise<void> {
    if (turn.kind !== "event") throw new Error(`P14_BROWSER_TURN: ${turn.kind}`);
    const p = (turn.payload ?? {}) as { route?: string; width?: string; mode?: string };
    if (turn.name === "route") {
      const width = p.width === "390" ? 390 : 1280;
      const route = p.route ?? "/settings";
      const ctx = await this.context(width);
      try {
        const pg = await ctx.newPage();
        await pg.goto(`${PAGE_ORIGIN}${route === "panel" ? `/chats/${this.chat}` : route}`);
        await this.read(pg, route, width, "before");
        await pg.reload();
        await this.read(pg, route, width, "after");
      } finally {
        await ctx.close();
      }
    } else if (turn.name === "mode") {
      const ctx = await this.context(1280);
      try {
        const pg = await ctx.newPage();
        await pg.goto(`${PAGE_ORIGIN}/settings/general`);
        await pg.waitForSelector(`#mode-${p.mode}`, { state: "attached" });
        const from = this.seen.length;
        await pg.evaluate(`document.getElementById("mode-${p.mode}").click()`);
        await pg.reload();
        await pg.waitForFunction("document.readyState === 'complete'");
        const wrote = this.seen.slice(from).filter((s) => s.body.includes(String(p.mode)) || new URL(s.url).search.includes(String(p.mode))).map((s) => s.url);
        this.mode = { stored: await pg.evaluate(`localStorage.getItem(${JSON.stringify(MODE_KEY)})`), applied: await pg.evaluate('document.body.getAttribute("data-theme")'), wrote };
      } finally {
        await ctx.close();
      }
    } else throw new Error(`P14_BROWSER_EVENT: ${turn.name}`);
  }
}

/** The browser harness over one launched Chromium; `close` ends it. */
export function p14BrowserHarness(): TaskHarness<P14BrowserWorld> & { close(): Promise<void> } {
  let browser: Browser | null = null;
  return {
    setup: async () => {
      browser = await chromium.launch({ channel: "chromium", headless: true });
      const w = authorityWorld({ script: [{ text: "One." }], shape: "standalone" });
      const chat = (await w.say(ada.email, "p14 probe: first chat")).chatId;
      return new P14Browser(browser, w, chat);
    },
    play: async (world, turn) => (world as P14Browser).play(turn),
    close: async () => {
      await browser?.close();
    },
  };
}
