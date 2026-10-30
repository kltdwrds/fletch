// Sam's page on a preview slot in headless Chromium (F41): the P14 graders' reads (`P14Page`, scripts/evals/p14-slot.ts)
// from the slot's own page with the trial's session: the chat at a width with the agent's drawn name (the header, the
// panel and the Identity card, its controls and the handle line), the chat reloaded at a width, and a settings route
// loaded and reloaded at a width (whether the Settings dialog drew, its heading, and the mode this browser stores
// before and after). Every request a page makes is kept by its origin, so a grader sees whether drawing it reached
// anywhere but the slot. The browser is playwright-core's pinned Chromium (AGENTS.md, gotcha 5).
import { type Browser, chromium, type Page } from "playwright-core";
import { DESKTOP, PHONE, WAIT_MS } from "./p5-page.ts";
import type { P14Page } from "./p14-slot.ts";

/** The key the page stores the mode under (`MODE_KEY` in `packages/agent/src/http/app/settings-panes.ts`, which imports
 * Worker code this Node script cannot load; `test/workers/f41-evals-p14.test.ts` holds the two equal). */
export const PAGE_MODE_KEY = "qyvr-mode";

/** The chat's composer and log are drawn and the history frame has filled the log, which has stopped growing. */
async function ready(p: Page): Promise<void> {
  await p.waitForFunction('!!document.getElementById("t") && !!document.getElementById("log") && document.getElementById("log").children.length > 0', null, { timeout: WAIT_MS });
  let last = -1;
  for (let i = 0; i < 20; i++) {
    const n = (await p.evaluate('document.getElementById("log").children.length')) as number;
    if (n === last) return;
    last = n;
    await p.waitForTimeout(500);
  }
}

/** The agent's drawn identity, as the tier-1 world reads it from the markup: the names, the card, its controls, the handle. */
const LOOK = `(() => {
  const t = (e) => ((e && e.textContent) || "").replace(/\\s+/g, " ").trim();
  const card = document.querySelector("#panel-identity .qf-idname");
  const h3 = card ? card.querySelector("h3") : null;
  const controls = [...document.querySelectorAll("#panel-identity button, #panel-identity a, #panel-identity input, #panel-identity textarea, #panel-identity select")]
    .map((e) => ({ id: e.id || e.tagName.toLowerCase(), words: t(e) }))
    .filter((c) => !/^tile-(soul|memory)$/.test(c.id))
    .map((c) => c.id + ": " + c.words);
  return {
    header: t(document.querySelector("#open-agent .nm")),
    panelName: t(document.querySelector(".panel-hero.panel-name")),
    cardName: t(h3),
    cardNote: card ? t(card).slice(t(h3).length).trim() : "",
    controls,
    handle: t(document.getElementById("handle")),
  };
})()`;

/** The Settings dialog drawn with its nav, and the heading of the pane shown. */
const SETTINGS = `(() => {
  const d = document.getElementById("set-dialog");
  const panes = document.querySelectorAll("#set-nav button").length;
  return { drawn: !!d && (d.open || !d.hidden) && panes > 0, heading: (document.getElementById("set-title") || {}).textContent || "" };
})()`;
const MODE = `localStorage.getItem(${JSON.stringify(PAGE_MODE_KEY)})`;

/** Sam's page on `base` with the session `cookie`. */
export function p14Page(base: string, cookie: string): P14Page {
  const [name, value] = cookie.split(/=(.*)/s) as [string, string];
  const session = async <T>(width: "desktop" | "phone", path: string, run: (p: Page) => Promise<T>): Promise<T & { origins: string[] }> => {
    const browser: Browser = await chromium.launch({ channel: "chromium", headless: true });
    const origins: string[] = [];
    try {
      const context = await browser.newContext({ viewport: width === "phone" ? PHONE : DESKTOP });
      await context.addCookies([{ name, value, url: base }]);
      const p = await context.newPage();
      p.on("request", (r) => {
        const u = new URL(r.url());
        if (u.protocol === "http:" || u.protocol === "https:") origins.push(u.origin);
      });
      await p.goto(`${base}${path}`, { waitUntil: "load" });
      return { ...(await run(p)), origins: [...origins] };
    } finally {
      await browser.close();
    }
  };
  return {
    look: (chatId, width) =>
      session(width, `/chats/${encodeURIComponent(chatId)}`, async (p) => {
        await ready(p);
        // The handle line is filled from `/me` once the page has read it.
        await p.waitForFunction('(document.getElementById("handle")?.textContent ?? "").trim().length > 0', null, { timeout: WAIT_MS }).catch(() => undefined);
        return { drawn: (await p.evaluate(LOOK)) as Awaited<ReturnType<P14Page["look"]>>["drawn"] };
      }),
    reload: (chatId, width) =>
      session(width, `/chats/${encodeURIComponent(chatId)}`, async (p) => {
        await ready(p);
        await p.reload({ waitUntil: "load" });
        await ready(p);
        return {};
      }),
    settings: (route, width) =>
      session(width, route, async (p) => {
        const drawnNow = () =>
          p
            .waitForFunction(`${SETTINGS}.drawn`, null, { timeout: WAIT_MS })
            .then(() => true)
            .catch(() => false);
        const first = await drawnNow();
        const before = (await p.evaluate(MODE)) as string | null;
        await p.reload({ waitUntil: "load" });
        const second = await drawnNow();
        const read = (await p.evaluate(SETTINGS)) as { drawn: boolean; heading: string };
        return { drawn: first && second && read.drawn, heading: read.heading, mode: { before, after: (await p.evaluate(MODE)) as string | null } };
      }),
  };
}
