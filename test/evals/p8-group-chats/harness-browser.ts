// T-P8-10's harness (Q60): P8's tier-1 world (`P8Tier1World`: Sam Solo's chats `c1` and `c2`, Pat Solo's colleague
// request and Sam's mail store) with Sam's app drawn in hermetic Chromium, on the pattern of P14's `harness-browser.ts`:
// every request the page makes answered by the world's own routes as Sam (`servePages`), every socket held in the test,
// every other origin aborted. Turn, beside P8's:
//   - `page` (payload `width`, 1280 or 390): `/chats/<c1>` drawn at that width, the list's rows awaited, the chats drawer
//     opened where it is one (390), every menu the page offers opened in turn (`aria-haspopup="menu"`, visible), and the rendered DOM read: each control's tag, id,
//     words and labels, and the kind of each chat row the list drew (its `data-chat` id against the list the page was
//     answered with).
// `plant` alters what the page is served, for `planted.test.ts`: the page's markup (a control drawn) or the chat list's
// body (a room listed), so a minefield fires through Chromium as it would on a deploy.
import { type Browser, type BrowserContext, chromium, type Page as Tab } from "playwright-core";
import { APP_PAGE } from "../../../packages/agent/src/http/page.ts";
import type { TaskHarness, Turn } from "../../support/task.ts";
import { PAGE_ORIGIN, servePages } from "../../workers/support/page-routes.ts";
import { type P8HarnessOptions, P8Tier1World, sam } from "./harness.ts";
import type { P8World } from "./world.ts";

type Chats = { chats?: Array<{ id?: string; kind?: string }> };
export interface P8BrowserPlant {
  /** The page's markup as served, altered. */
  html?: (html: string) => string;
  /** The body of each `GET /app/chats` the page is answered with, altered. */
  chats?: (body: Chats) => Chats;
}

/** Every control in the rendered DOM, hidden ones included (a menu's static items live there): tag, id, words and labels. */
const CONTROLS = `(() => [...document.querySelectorAll("button, a, input, select, textarea, [role=button], [role=menuitem], [role=tab]")].map((e) => {
  const words = (e.textContent || "").replace(/\\s+/g, " ").trim();
  const labels = ["aria-label", "title", "placeholder", "value"].map((a) => e.getAttribute(a) || "").filter(Boolean).join(" ");
  return (e.tagName.toLowerCase() + "#" + (e.id || "") + ": " + words + " " + labels).trim();
}))()`;
/** The menu buttons a person can press now: visible, with a box. */
const MENUS = `(() => [...document.querySelectorAll('[aria-haspopup="menu"]')].map((e, i) => (e.setAttribute("data-p8-menu", String(i)), e)).filter((e) => e.checkVisibility() && e.getBoundingClientRect().width > 0).map((e) => e.getAttribute("data-p8-menu")))()`;
/** The open menu's items as drawn. */
const MENU_ITEMS = `[...document.querySelectorAll("#menu button, #menu a, #menu [role=menuitem]")].map((e) => ("menu#" + (e.id || "") + ": " + (e.textContent || "").replace(/\\s+/g, " ").trim() + " " + (e.getAttribute("aria-label") || "")).trim())`;

export class P8BrowserWorld extends P8Tier1World {
  chromiumRun: Browser | null = null;
  plant: P8BrowserPlant = {};

  private async context(width: 1280 | 390, kinds: Map<string, string>): Promise<BrowserContext> {
    if (!this.chromiumRun) throw new Error("P8_BROWSER_CLOSED");
    const ctx = await this.chromiumRun.newContext({ viewport: { width, height: width > 600 ? 900 : 844 }, serviceWorkers: "block", reducedMotion: "reduce" });
    await ctx.routeWebSocket(/.*/, () => {});
    const html = this.plant.html ? this.plant.html(APP_PAGE) : APP_PAGE;
    await servePages(
      ctx,
      async (m, p, body) => {
        const r = await this.w.http(sam.email, m, p, body);
        if (m === "GET" && p.split("?")[0] === "/app/chats" && r.status === 200) {
          const listed = this.plant.chats ? this.plant.chats(r.body as Chats) : (r.body as Chats);
          for (const c of listed.chats ?? []) if (c.id) kinds.set(c.id, String(c.kind));
          return { status: r.status, body: listed };
        }
        return r;
      },
      html,
    );
    return ctx;
  }

  private async read(pg: Tab, kinds: Map<string, string>): Promise<{ controls: string[]; kinds: string[] }> {
    await pg.waitForFunction("document.readyState === 'complete'");
    await pg.waitForSelector("#chats [data-chat]", { state: "attached" });
    const controls = (await pg.evaluate(CONTROLS)) as string[];
    // At phone width the chat list is a drawer behind its button: opened first, so its menus can be pressed.
    if (await pg.evaluate('document.getElementById("open-chats").checkVisibility()')) {
      await pg.evaluate('document.getElementById("open-chats").click()');
      await pg.waitForFunction('!document.getElementById("drawer").hidden');
    }
    for (const m of (await pg.evaluate(MENUS)) as string[]) {
      await pg.evaluate(`document.querySelector('[data-p8-menu="${m}"]').click()`);
      controls.push(...((await pg.evaluate(MENU_ITEMS)) as string[]));
      await pg.keyboard.press("Escape");
    }
    const rows = (await pg.evaluate(`[...document.querySelectorAll("#chats [data-chat]")].map((r) => r.dataset.chat)`)) as string[];
    return { controls, kinds: [...new Set(rows.map((id) => kinds.get(id) ?? `unlisted:${id}`))].sort() };
  }

  override async play(turn: Turn): Promise<void> {
    if (turn.kind !== "event" || turn.name !== "page") return super.play(turn);
    const width = turn.payload?.width === "390" ? 390 : 1280;
    const kinds = new Map<string, string>();
    const ctx = await this.context(width, kinds);
    try {
      const pg = await ctx.newPage();
      await pg.goto(`${PAGE_ORIGIN}/chats/${this.chatId("c1")}`);
      this.pages.push({ width, ...(await this.read(pg, kinds)) });
    } finally {
      await ctx.close();
    }
  }
}

/** P8's tier-1 harness with one launched Chromium for the `page` turns; `close` ends it. */
export function p8BrowserHarness(o: P8HarnessOptions & { plant?: P8BrowserPlant }): TaskHarness<P8World> & { close(): Promise<void> } {
  let browser: Browser | null = null;
  return {
    setup: async () => {
      browser ??= await chromium.launch({ channel: "chromium", headless: true });
      const w = new P8BrowserWorld({ script: o.script });
      w.chromiumRun = browser;
      w.plant = o.plant ?? {};
      await w.open();
      await w.w.host(sam.email).memory.standingFiles();
      await w.activity();
      w.before = w.tables();
      return w;
    },
    play: async (world, turn) => (world as P8BrowserWorld).play(turn),
    close: async () => {
      await browser?.close();
      browser = null;
    },
  };
}
