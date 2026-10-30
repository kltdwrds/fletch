// Sam's page on a preview slot in headless Chromium (F32): the P5 graders' reads of the Activity tab and the task drawer
// (`P5Page`, scripts/evals/p5-slot.ts), as the tier-1 harness reads them from the panel script
// (`test/evals/p5-activity/harness.ts`), here from the slot's own page with the trial's session. Each read loads the page
// afresh, so a read after a reload is one. The browser is playwright-core's pinned Chromium (AGENTS.md, gotcha 5).
import { type Browser, chromium, type Page } from "playwright-core";
import type { DrawerView, RowView } from "../../test/evals/p5-activity/world.ts";
import type { P5Page } from "./p5-slot.ts";

export const DESKTOP = { width: 1440, height: 900 };
export const PHONE = { width: 390, height: 844 };
export const WAIT_MS = 30_000;

/** The rows of the Activity tab as the tier-1 harness reads them; a glyph is named by the `glyph-<name>` it was cloned from. */
const ROWS = `[...document.getElementById("panel-activity").querySelectorAll(".prow")].map((r) => {
  const tile = r.querySelector(".prow-tile")?.firstElementChild;
  const glyph = tile ? [...document.querySelectorAll('[id^="glyph-"]')].find((g) => g.innerHTML === tile.innerHTML)?.id ?? "" : "";
  return { kind: r.dataset.run ? "run" : "task", title: r.querySelector(".t-sub-m")?.textContent ?? "", desc: r.querySelector(".t-foot")?.textContent ?? "", glyph: glyph.replace(/^glyph-/, "") };
})`;

/** The text of the leaf nodes of the detail pane, one per line, and whether the pane holds no markup a page could run. */
const PANE = `(() => {
  const all = [...document.getElementById("task-pane").querySelectorAll("*")];
  return { text: all.map((e) => (e.children.length ? "" : (e.textContent ?? ""))).join("\\n"), plain: !all.some((e) => ["SCRIPT", "IMG", "IFRAME", "A", "OBJECT"].includes(e.tagName)) };
})()`;

/** Opens Sam's page on `base` at `path` with the session `cookie` (`fletch_session=...`), runs `run` on it and closes Chromium. */
export function pageOpener(base: string, cookie: string) {
  const [name, value] = cookie.split(/=(.*)/s) as [string, string];
  return async <T>(viewport: { width: number; height: number }, run: (p: Page) => Promise<T>, path = "/"): Promise<T> => {
    const browser: Browser = await chromium.launch({ channel: "chromium", headless: true });
    try {
      const context = await browser.newContext({ viewport });
      await context.addCookies([{ name, value, url: base }]);
      const p = await context.newPage();
      await p.goto(`${base}${path}`, { waitUntil: "load" });
      return await run(p);
    } finally {
      await browser.close();
    }
  };
}

/** The Activity tab, read once its route answered: on a phone, the panel's sheet is opened first, as Sam opens it. */
export async function activityTab(p: Page, phone: boolean): Promise<void> {
  if (phone) {
    await p.waitForFunction('!!document.getElementById("open-agent")', null, { timeout: WAIT_MS });
    await p.evaluate('document.getElementById("open-agent").click()');
  }
  await p.waitForFunction('!!document.getElementById("panel-tab-activity")', null, { timeout: WAIT_MS });
  await p.evaluate('document.getElementById("panel-tab-activity").click()');
  // The tab says "Reading…" until the route answers, then its rows, the empty note or an error.
  await p.waitForFunction('!/^Reading/.test(document.getElementById("panel-activity")?.textContent ?? "Reading")', null, { timeout: WAIT_MS });
}

/** Opens task `id`'s drawer from its row, once its steps are drawn; false when no row is the task's. */
export async function openTask(p: Page, id: string): Promise<boolean> {
  const opened = await p.evaluate(`(() => { const row = document.querySelector('#panel-activity .prow[data-task="' + CSS.escape(${JSON.stringify(id)}) + '"]'); row?.click(); return !!row; })()`);
  if (!opened) return false;
  // The drawer draws its steps once the task's route answered.
  await p.waitForFunction('!document.getElementById("task-dialog").hidden && document.getElementById("task-steps").querySelectorAll("li").length > 0', null, { timeout: WAIT_MS });
  return true;
}

/** Sam's page on `base` with the session `cookie` (`fletch_session=...`): each read launches Chromium and closes it. */
export function p5Page(base: string, cookie: string): P5Page {
  const open = pageOpener(base, cookie);
  return {
    rows: async () =>
      (await open(DESKTOP, async (p) => {
        await activityTab(p, false);
        return p.evaluate(ROWS);
      })) as RowView[],
    drawer: async (_chatId, id, phone) =>
      (await open(phone ? PHONE : DESKTOP, async (p) => {
        await activityTab(p, phone);
        if (!(await openTask(p, id))) return null;
        const count = (await p.evaluate('document.getElementById("task-steps").querySelectorAll("li").length')) as number;
        const details: DrawerView["details"] = {};
        let stacked = false;
        for (let i = 0; i < count; i++) {
          const title = (await p.evaluate(`(() => { const li = document.getElementById("task-steps").querySelectorAll("li")[${i}]; li.click(); return li.querySelector(".nm")?.textContent ?? ""; })()`)) as string;
          details[title] = (await p.evaluate(PANE)) as { text: string; plain: boolean };
          if (phone) {
            stacked = (await p.evaluate('document.getElementById("task-body").classList.contains("is-detail")')) as boolean;
            await p.evaluate('document.getElementById("task-back").click()');
          }
        }
        return p.evaluate(`({
          pill: document.getElementById("task-state").textContent ?? "",
          stop: !document.getElementById("task-stop").hidden,
          title: document.getElementById("task-title").textContent ?? "",
          usage: document.getElementById("task-usage").textContent ?? "",
          steps: [...document.getElementById("task-steps").querySelectorAll("li")].map((li) => li.querySelector(".nm")?.textContent ?? ""),
        })`).then((v) => ({ ...(v as Omit<DrawerView, "details" | "stacked">), details, stacked }));
      })) as DrawerView | null,
  };
}
