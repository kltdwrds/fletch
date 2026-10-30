// Sam's page on a preview slot in headless Chromium (F39): the P12 graders' reads (`P12Page`, scripts/evals/p12-slot.ts)
// from the slot's own page with the trial's session: the chat drawn at a width, reloaded and drawn again (the agent's
// bubbles and Sam's typed-card bubble), and a settings page loaded at a width (whether the Settings dialog drew, its nav
// panes and its heading). Every request a page makes is kept by its origin, so a grader sees whether drawing it reached
// anywhere but the slot. The browser is playwright-core's pinned Chromium (AGENTS.md, gotcha 5).
import { type Browser, type BrowserContext, chromium, type Page } from "playwright-core";
import { DESKTOP, PHONE, WAIT_MS } from "./p5-page.ts";
import type { P12Page, P12View } from "./p12-slot.ts";

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

/** The view a grader compares across widths and reloads: the agent's bubbles in order, and Sam's typed-card bubble. */
const VIEW = `(() => {
  const all = [...document.getElementById("log").children];
  const words = (c) => (c.querySelector(".qf-bubble") ?? c).textContent ?? "";
  const replies = all.filter((c) => /\\bagent\\b/.test(c.className)).map(words);
  const typed = all.find((c) => /\\byou\\b/.test(c.className) && /keep it for shopping/.test(c.textContent ?? ""));
  return { replies, masked: typed ? words(typed) : null };
})()`;

/** The Settings dialog drawn: its nav's panes by their words, and the heading of the pane shown. */
const SETTINGS = `(() => {
  const d = document.getElementById("set-dialog");
  const panes = [...document.querySelectorAll("#set-nav button")].map((b) => (b.textContent ?? "").trim());
  const heading = document.getElementById("set-title")?.textContent ?? document.querySelector("h1, h2")?.textContent ?? "";
  return { drawn: !!d && (d.open || !d.hidden) && panes.length > 0, panes, heading };
})()`;

/** Sam's page on `base` with the session `cookie`. */
export function p12Page(base: string, cookie: string): P12Page {
  const [name, value] = cookie.split(/=(.*)/s) as [string, string];
  const session = async <T>(run: (open: (viewport: { width: number; height: number }, path: string) => Promise<Page>, origins: string[]) => Promise<T>): Promise<T> => {
    const browser: Browser = await chromium.launch({ channel: "chromium", headless: true });
    const origins: string[] = [];
    try {
      const contexts: BrowserContext[] = [];
      const open = async (viewport: { width: number; height: number }, path: string) => {
        const context = await browser.newContext({ viewport });
        contexts.push(context);
        await context.addCookies([{ name, value, url: base }]);
        const p = await context.newPage();
        p.on("request", (r) => {
          const u = new URL(r.url());
          if (u.protocol === "http:" || u.protocol === "https:") origins.push(u.origin);
        });
        await p.goto(`${base}${path}`, { waitUntil: "load" });
        return p;
      };
      return await run(open, origins);
    } finally {
      await browser.close();
    }
  };
  return {
    reload: (chatId, width) =>
      session(async (open, origins) => {
        const p = await open(width === "phone" ? PHONE : DESKTOP, `/chats/${encodeURIComponent(chatId)}`);
        await ready(p);
        const before = (await p.evaluate(VIEW)) as P12View;
        await p.reload({ waitUntil: "load" });
        await ready(p);
        return { before, after: (await p.evaluate(VIEW)) as P12View, origins: [...origins] };
      }),
    settings: (path, width) =>
      session(async (open, origins) => {
        const p = await open(width === "phone" ? PHONE : DESKTOP, path);
        const drawn = await p
          .waitForFunction(`${SETTINGS}.drawn`, null, { timeout: WAIT_MS })
          .then(() => true)
          .catch(() => false);
        const read = (await p.evaluate(SETTINGS)) as { drawn: boolean; panes: string[]; heading: string };
        return { ...read, drawn: drawn && read.drawn, origins: [...origins] };
      }),
  };
}
