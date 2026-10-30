// Sam's page on a preview slot in headless Chromium (F37): the P9 graders' reads (`P9Page`, scripts/evals/p9-slot.ts)
// from the slot's own page with the trial's session, as the tier-1 harness reads them from the page script
// (`test/evals/p9-connectors/harness.ts` `twoTabs`): Sam's bubbles in two tabs on one chat after a send from the
// first, the first reloaded and the chat opened at phone width; the chat drawn at a width, reloaded and drawn again;
// a settings page loaded at a width. Every request a page makes is kept by its origin, so a grader sees whether
// drawing it reached anywhere but the slot. The browser is playwright-core's pinned Chromium (AGENTS.md, gotcha 5).
import { type Browser, type BrowserContext, chromium, type Page } from "playwright-core";
import type { Tabs } from "../../test/evals/p9-connectors/world.ts";
import { DESKTOP, PHONE, WAIT_MS } from "./p5-page.ts";
import type { P9Page, P9View } from "./p9-slot.ts";

/** Sam's bubbles (the "you" side) as the log draws them. */
const YOURS = '[...document.getElementById("log").children].filter((c) => /\\byou\\b/.test(c.className)).map((c) => c.textContent ?? "")';

/** The chat's composer and log are drawn and, for a chat with entries (`drawn`), the history frame has filled the log. */
async function ready(p: Page, drawn = true): Promise<void> {
  await p.waitForFunction('!!document.getElementById("t") && !!document.getElementById("log")', null, { timeout: WAIT_MS });
  if (drawn) await p.waitForFunction('document.getElementById("log").children.length > 0', null, { timeout: WAIT_MS });
  await settledLog(p);
}

/** Waits until the log stops growing and no capture item is still reading its state. */
async function settledLog(p: Page): Promise<void> {
  let last = "";
  for (let i = 0; i < 20; i++) {
    const n = (await p.evaluate('document.getElementById("log").children.length + "/" + document.querySelectorAll(".capture-item:not([data-state]), .capture-item[data-state=\\"\\"]").length')) as string;
    if (n === last && n.endsWith("/0")) return;
    last = n;
    await p.waitForTimeout(500);
  }
}

/** The view a grader compares across widths and reloads: the first capture item, Sam's typed-key bubble, the Connected names. */
async function viewOf(p: Page): Promise<P9View> {
  return (await p.evaluate(`(async () => {
    const item = document.querySelector(".capture-item");
    const typed = [...document.getElementById("log").children].find((c) => /\\byou\\b/.test(c.className) && /keep it for later/.test(c.textContent ?? ""));
    const r = await fetch("/app/connectors", { credentials: "same-origin" });
    const yours = r.ok ? ((await r.json()).yours ?? []).map((y) => y.name) : ["unread " + r.status];
    return { capture: item ? item.textContent : null, masked: typed ? typed.textContent : null, connected: yours };
  })()`)) as P9View;
}

/** Sam's page on `base` with the session `cookie`. */
export function p9Page(base: string, cookie: string): P9Page {
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
  const chat = (id: string) => `/chats/${encodeURIComponent(id)}`;
  return {
    tabs: (chatId, text, settled) =>
      session(async (open) => {
        const a = await open(DESKTOP, chat(chatId));
        const b = await open(DESKTOP, chat(chatId));
        // A fresh chat draws no entry before the send.
        await ready(a, false);
        await ready(b, false);
        await a.evaluate(`(() => { document.getElementById("t").value = ${JSON.stringify(text)}; document.getElementById("f").requestSubmit(); })()`);
        await settled();
        // Both tabs draw the turn's frames: Sam's bubble and the agent's reply, with nothing still running.
        for (const p of [a, b]) {
          await p.waitForFunction('[...document.getElementById("log").children].some((c) => /\\bagent\\b/.test(c.className)) && document.getElementById("busy")?.hidden !== false', null, { timeout: WAIT_MS });
          await settledLog(p);
        }
        const sending = (await a.evaluate(YOURS)) as string[];
        const other = (await b.evaluate(YOURS)) as string[];
        await a.reload({ waitUntil: "load" });
        await ready(a);
        const phone = await open(PHONE, chat(chatId));
        await ready(phone);
        const reloaded = [...((await a.evaluate(YOURS)) as string[]), ...((await phone.evaluate(YOURS)) as string[])];
        return { sending, other, reloaded, frames: "" };
      }),
    reload: (chatId, width) =>
      session(async (open, origins) => {
        const p = await open(width === "phone" ? PHONE : DESKTOP, chat(chatId));
        await ready(p);
        const before = await viewOf(p);
        await p.reload({ waitUntil: "load" });
        await ready(p);
        return { before, after: await viewOf(p), origins: [...origins] };
      }),
    settings: (path, width) =>
      session(async (open, origins) => {
        const p = await open(width === "phone" ? PHONE : DESKTOP, path);
        const drawn = await p
          .waitForFunction('(() => { const d = document.getElementById("set-dialog"); const pane = document.getElementById("set-pane-connectors"); return !!d && (d.open || !d.hidden) && !!pane && !pane.hidden; })()', null, { timeout: WAIT_MS })
          .then(() => true)
          .catch(() => false);
        const heading = (await p.evaluate('document.getElementById("set-title")?.textContent ?? document.querySelector("h1, h2")?.textContent ?? ""')) as string;
        return { drawn, heading, origins: [...origins] };
      }),
  };
}
