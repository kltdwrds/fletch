// F3: the Search dialog's dismissal, in hermetic Chromium as `m29-6-motion`, every request answered by the authority
// world's routes as Sam of solo-sam and every socket held in the test. Closing a `.qf-scrim2` dialog runs the scrim's
// fade and the card's exit together at `--qf-dur-fast`, so the page is live within it: the node is hidden, its scrim
// gone and no `.is-closing` left, from the rail on a desktop and over the drawer on a tablet. Planted: the page with the
// scrim's exit restored to `--qf-dur-scrim-dialog` (a second of dead, darkened page) fails the same check.
import { type Browser, chromium, type Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { APP_PAGE } from "../../packages/agent/src/http/page.ts";
import { ada, authorityWorld } from "./support/authority-world.ts";
import { SETTLED } from "./support/motion.ts";
import { servePages } from "./support/page-routes.ts";

let browser: Browser;
const w = authorityWorld({ script: [] });
beforeAll(async () => {
  browser = await chromium.launch({ channel: "chromium", headless: true });
});
afterAll(async () => {
  await browser?.close();
});

async function on<T>(o: { width: number; height: number; html?: string }, fn: (pg: Page) => Promise<T>): Promise<T> {
  const ctx = await browser.newContext({ viewport: { width: o.width, height: o.height }, colorScheme: "dark", serviceWorkers: "block", reducedMotion: "no-preference" });
  try {
    await ctx.routeWebSocket(/.*/, () => {});
    await servePages(ctx, (m, p, b) => w.http(ada.email, m, p, b), o.html ?? APP_PAGE);
    const pg = await ctx.newPage();
    await pg.goto("https://solo-sam.example/");
    await pg.waitForFunction('document.querySelectorAll("#chats [data-chat]").length >= 1');
    await pg.evaluate(SETTLED);
    return await fn(pg);
  } finally {
    await ctx.close();
  }
}

const OPENERS = [
  { name: "from the rail on a desktop", width: 1440, height: 900, open: 'document.getElementById("rail-search").click()' },
  { name: "over the drawer on a tablet", width: 900, height: 1000, open: 'document.getElementById("chats-pill").click(); document.getElementById("rail-search").click()' },
];

interface Dismissal {
  /** The fast duration the bundle declares, in ms. */
  fast: number;
  /** The scrim's and the card's exit animations as the close started them: keyframes name and duration. */
  scrim: Array<[string, number]>;
  card: Array<[string, number]>;
  /** How long after the close the node was hidden, its scrim gone and no `.is-closing` left, in ms. */
  doneMs: number;
  /** The drawer under the dialog, when there was one, is still open. */
  drawerOpen: boolean;
}
const running = (sel: string) => `[...document.querySelectorAll(${JSON.stringify(sel)})].flatMap((e) => e.getAnimations().filter((a) => a.animationName).map((a) => [a.animationName, a.effect.getTiming().duration]))`;
/** Opens the dialog, lets its enter finish, closes it with Escape, reads the exit in the same task, then waits for the end. */
async function dismiss(pg: Page, open: string): Promise<Dismissal> {
  await pg.evaluate(`(() => { ${open}; })()`);
  await pg.evaluate(SETTLED);
  const drawerWas = (await pg.evaluate('document.getElementById("drawer").parentElement.id === "scrim"')) as boolean;
  const first = (await pg.evaluate(`(() => {
    const n = document.getElementById("search"), s = n.parentElement; window.__done = null; const t0 = performance.now();
    const check = () => { if (window.__done === null && n.hidden && (s.hidden || !s.isConnected) && !document.querySelector(".is-closing")) window.__done = performance.now() - t0; };
    new MutationObserver(check).observe(document.body, { attributes: true, childList: true, subtree: true });
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    return { fast: parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--qf-dur-fast")) * 1000, scrim: ${running(".qf-scrim2.is-closing:has(> #search)")}, card: ${running("#search-card")} };
  })()`)) as Omit<Dismissal, "doneMs" | "drawerOpen">;
  await pg.waitForFunction("window.__done !== null", null, { timeout: 5000 });
  const doneMs = (await pg.evaluate("window.__done")) as number;
  const drawerOpen = drawerWas && ((await pg.evaluate('document.getElementById("drawer").parentElement.id === "scrim" && !document.getElementById("drawer").hidden')) as boolean);
  return { ...first, doneMs, drawerOpen };
}
/** The claim: both exits at the fast duration, in parallel, and the page live again within it (one frame of slack). */
const live = (d: Dismissal) => d.scrim.length === 1 && d.card.length === 1 && d.scrim[0]?.[1] === d.fast && d.card[0]?.[1] === d.fast && d.doneMs < d.fast + 100;

describe("[F3] the Search dialog is dismissed at one fast duration", () => {
  for (const o of OPENERS)
    it(`${o.name}: the scrim's fade and the card's exit run together at --qf-dur-fast, and within it the node is hidden, the scrim gone and nothing .is-closing`, async () => {
      await on(o, async (pg) => {
        const d = await dismiss(pg, o.open);
        expect([d.fast, d.scrim, d.card]).toEqual([150, [["qf-scrim-out", 150]], [["qf-pop-out", 150]]]);
        expect(d.doneMs, "hidden only after the exits ran").toBeGreaterThanOrEqual(d.fast * 0.9);
        expect(live(d), `live within ${d.fast} ms (done at ${d.doneMs})`).toBe(true);
        if (o.name.includes("drawer")) expect(d.drawerOpen, "the drawer stays open under it").toBe(true);
      });
    }, 60_000);

  it("planted: with the scrim's exit restored to --qf-dur-scrim-dialog, the scrim outlasts the card and the page stays dead past the fast duration", async () => {
    const from = ".qf-scrim2.is-closing{animation:qf-scrim-out var(--qf-dur-fast)";
    expect(APP_PAGE).toContain(from);
    const html = APP_PAGE.replace(from, ".qf-scrim2.is-closing{animation:qf-scrim-out var(--qf-dur-scrim-dialog)");
    for (const o of OPENERS)
      await on({ ...o, html }, async (pg) => {
        const d = await dismiss(pg, o.open);
        expect(d.scrim, o.name).toEqual([["qf-scrim-out", 1000]]);
        expect(d.doneMs, o.name).toBeGreaterThanOrEqual(900);
        expect(live(d), o.name).toBe(false);
      });
  }, 60_000);
});
