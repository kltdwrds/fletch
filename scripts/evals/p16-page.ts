// Sam's page on a preview slot in headless Chromium (F81): the P16 reload reads (`P16Page`, scripts/evals/p16-slot.ts)
// from the slot's own page with the trial's session: the chat's rows drawn at a width, each with the id the page keeps
// for it (a stored message's `data-sid`, a sent one's `data-mid`, a card's `data-card`) and its words, then reloaded and
// drawn again. The phone width is 375 wide, as T-P16-12 names it. The browser is playwright-core's pinned Chromium
// (AGENTS.md, gotcha 5).
import { type Browser, chromium, type Page } from "playwright-core";
import { DESKTOP, WAIT_MS } from "./p5-page.ts";
import type { P16Page, P16View } from "./p16-slot.ts";

export const PHONE_375 = { width: 375, height: 812 };

/** The chat's log is drawn and has stopped growing. */
async function ready(p: Page): Promise<void> {
  await p.waitForFunction('!!document.getElementById("log") && document.getElementById("log").children.length > 0', null, { timeout: WAIT_MS });
  let last = -1;
  for (let i = 0; i < 20; i++) {
    const n = (await p.evaluate('document.getElementById("log").children.length')) as number;
    if (n === last) return;
    last = n;
    await p.waitForTimeout(500);
  }
}

/** The rows that carry an id, in order, with their words. */
const ROWS = `(() => {
  const rows = [...document.getElementById("log").children].map((c) => ({ id: c.dataset.sid || c.dataset.mid || (c.dataset.card ? "card:" + c.dataset.card : ""), text: (c.textContent || "").trim() })).filter((r) => r.id);
  return { ids: rows.map((r) => r.id), texts: rows.map((r) => r.text) };
})()`;

/** Sam's page on `base` with the session `cookie`. */
export function p16Page(base: string, cookie: string): P16Page {
  const [name, value] = cookie.split(/=(.*)/s) as [string, string];
  return {
    async reload(chatId, width) {
      const browser: Browser = await chromium.launch({ channel: "chromium", headless: true });
      try {
        const context = await browser.newContext({ viewport: width === "phone" ? PHONE_375 : DESKTOP });
        await context.addCookies([{ name, value, url: base }]);
        const p = await context.newPage();
        await p.goto(`${base}/chats/${encodeURIComponent(chatId)}`, { waitUntil: "load" });
        await ready(p);
        const before = (await p.evaluate(ROWS)) as P16View;
        await p.reload({ waitUntil: "load" });
        await ready(p);
        return { before, after: (await p.evaluate(ROWS)) as P16View };
      } finally {
        await browser.close();
      }
    },
  };
}
