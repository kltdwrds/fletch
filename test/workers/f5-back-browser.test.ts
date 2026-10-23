// F5: back closes what opened, in hermetic Chromium with a real session history (the F4 route helper), every request
// answered by the authority world's routes as Sam of solo-sam and every socket held in the test. On a tablet the
// drawer and the Search dialog are opened from the rail over `/chats/<b>`; `page.goBack()` closes the dialog, a second
// closes the drawer, a third leaves `/chats/<b>` for the chat before it, measured on `page.url()` and the nodes'
// `hidden`. Planted: the page with a close that leaves its entry, where back after Escape stays on the page.
import { type Browser, chromium, type Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { APP_PAGE } from "../../packages/agent/src/http/page.ts";
import { ada, authorityWorld } from "./support/authority-world.ts";
import { PAGE_ORIGIN, servePages } from "./support/page-routes.ts";

let browser: Browser;
const w = authorityWorld({ script: [{ text: "One." }, { text: "Two." }] });
let a = "";
let b = "";
beforeAll(async () => {
  a = (await w.say(ada.email, "First chat")).chatId;
  b = (await w.say(ada.email, "Second chat")).chatId;
  browser = await chromium.launch({ channel: "chromium", headless: true });
});
afterAll(async () => {
  await browser?.close();
});

/** Sam's page on a tablet at `/chats/<a>`, then at `/chats/<b>` by a row picked in the drawer: the history is [a, b] (after the tab's about:blank). */
async function on(html: string, fn: (pg: Page) => Promise<void>) {
  const ctx = await browser.newContext({ viewport: { width: 900, height: 1000 }, serviceWorkers: "block", reducedMotion: "reduce" });
  try {
    await ctx.routeWebSocket(/.*/, () => {});
    await servePages(ctx, (m, p, body) => w.http(ada.email, m, p, body), html);
    const pg = await ctx.newPage();
    await pg.goto(`${PAGE_ORIGIN}/chats/${a}`);
    await pg.waitForFunction(`document.querySelector('#chats [data-chat="${b}"]') !== null`);
    await pg.click("#chats-pill");
    await pg.click(`#chats [data-chat="${b}"] > :first-child`);
    await pg.waitForURL(`${PAGE_ORIGIN}/chats/${b}`);
    await pg.waitForFunction('document.getElementById("drawer").parentElement.id !== "scrim"');
    // The tab's first entry is about:blank, so [blank, a, b] is three.
    expect(await pg.evaluate("history.length")).toBe(3);
    await fn(pg);
  } finally {
    await ctx.close();
  }
}

const drawerOpen = 'document.getElementById("drawer").parentElement.id === "scrim" && !document.getElementById("drawer").hidden';
const searchOpen = '!document.getElementById("search").hidden';
const state = async (pg: Page) => [pg.url(), await pg.evaluate(drawerOpen), await pg.evaluate(searchOpen)];

describe("[F5] back closes what opened, in Chromium with a real history", () => {
  it("the drawer and the Search dialog from the rail: back closes the dialog, then the drawer, then leaves /chats/<id> for the previous page", async () => {
    await on(APP_PAGE, async (pg) => {
      // The drawer's click catcher covers the rail on a tablet, so the rail's Search is clicked as F3 opens it.
      await pg.click("#chats-pill");
      await pg.evaluate('document.getElementById("rail-search").click()');
      expect(await state(pg)).toEqual([`${PAGE_ORIGIN}/chats/${b}`, true, true]);
      expect(await pg.evaluate("history.length")).toBe(5);
      await pg.goBack();
      await pg.waitForFunction(`!(${searchOpen})`);
      expect(await state(pg)).toEqual([`${PAGE_ORIGIN}/chats/${b}`, true, false]);
      await pg.goBack();
      await pg.waitForFunction(`!(${drawerOpen})`);
      expect(await state(pg)).toEqual([`${PAGE_ORIGIN}/chats/${b}`, false, false]);
      await pg.goBack();
      await pg.waitForURL(`${PAGE_ORIGIN}/chats/${a}`);
      expect(await state(pg)).toEqual([`${PAGE_ORIGIN}/chats/${a}`, false, false]);
    });
  }, 60_000);

  it("Escape pops the dialog's entry, so one back leaves the page; planted: a close that leaves its entry spends that back", async () => {
    const leave = "if (!keep) unown(closing);";
    expect(APP_PAGE).toContain(leave);
    for (const planted of [false, true]) {
      await on(planted ? APP_PAGE.replace(leave, "") : APP_PAGE, async (pg) => {
        await pg.click("#rail-search");
        await pg.keyboard.press("Escape");
        await pg.waitForFunction(`!(${searchOpen})`);
        if (!planted) await pg.waitForFunction("history.state === null");
        await pg.goBack();
        if (planted) {
          await pg.waitForFunction("history.state === null");
          expect([planted, pg.url()]).toEqual([true, `${PAGE_ORIGIN}/chats/${b}`]);
        } else {
          await pg.waitForURL(`${PAGE_ORIGIN}/chats/${a}`);
          expect([planted, pg.url()]).toEqual([false, `${PAGE_ORIGIN}/chats/${a}`]);
        }
      });
    }
  }, 60_000);
});
