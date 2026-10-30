// Sam's page on a preview slot in headless Chromium (F30): the P7 graders' reads of the Upcoming tab and the job
// dialog (`P7Page`, scripts/evals/p7-slot.ts), as the tier-1 harness reads them from the panel script
// (`test/evals/p7-scheduling/harness.ts`), here from the slot's own page with the trial's session. Each read loads the
// page afresh, so a read after a reload is one. The browser is playwright-core's pinned Chromium (AGENTS.md, gotcha 5).
import { type Browser, chromium, type Page } from "playwright-core";
import type { DialogView } from "../../test/evals/p7-scheduling/world.ts";
import { DIALOG_CONTROLS } from "../../test/evals/p7-scheduling/world.ts";
import type { P7Page } from "./p7-slot.ts";

const DESKTOP = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };
const WAIT_MS = 30_000;

/** Sam's page on `base` with the session `cookie` (`fletch_session=...`): each read launches Chromium and closes it. */
export function p7Page(base: string, cookie: string): P7Page {
  const [name, value] = cookie.split(/=(.*)/s) as [string, string];
  const open = async (viewport: { width: number; height: number }, run: (p: Page) => Promise<unknown>) => {
    const browser: Browser = await chromium.launch({ channel: "chromium", headless: true });
    try {
      const context = await browser.newContext({ viewport });
      await context.addCookies([{ name, value, url: base }]);
      const p = await context.newPage();
      await p.goto(`${base}/`, { waitUntil: "load" });
      return await run(p);
    } finally {
      await browser.close();
    }
  };
  /** The Upcoming tab, read once its route answered. The page's code runs as strings: this file has no DOM types. */
  const upcoming = async (p: Page) => {
    await p.waitForFunction('!!document.getElementById("panel-tab-upcoming")', null, { timeout: WAIT_MS });
    await p.evaluate('document.getElementById("panel-tab-upcoming").click()');
    // The note says "Reading…" until the route answers, then the empty note, an error, or nothing beside the rows.
    await p.waitForFunction('!/^Reading/.test(document.getElementById("jobs-note")?.textContent ?? "Reading")', null, { timeout: WAIT_MS });
  };
  return {
    groups: async () =>
      (await open(DESKTOP, async (p) => {
        await upcoming(p);
        return p.evaluate('[...document.getElementById("job-list").children].filter((c) => c.tagName === "H3").map((c) => c.textContent ?? "")');
      })) as string[],
    dialog: async (jobId) =>
      (await open(DESKTOP, async (p) => {
        await upcoming(p);
        const opened = await p.evaluate(`(() => { const row = document.querySelector('#job-list [data-job="' + CSS.escape(${JSON.stringify(jobId)}) + '"]'); row?.click(); return !!row; })()`);
        if (!opened) return null;
        await p.waitForFunction('!document.getElementById("job-dialog").hidden && (document.getElementById("job-title")?.textContent ?? "") !== ""', null, { timeout: WAIT_MS });
        return p.evaluate(`(() => {
          const fixed = new Set(${JSON.stringify(DIALOG_CONTROLS)});
          const text = (id) => document.getElementById(id)?.textContent ?? "";
          const els = [...document.getElementById("job-dialog").querySelectorAll("*")];
          return {
            state: text("job-state"),
            title: text("job-title"),
            words: text("job-words"),
            about: text("job-about"),
            controls: els.filter((e) => e.tagName === "BUTTON" || fixed.has(e.id)).map((e) => e.id || (e.textContent ?? "")),
            history: [...document.getElementById("job-runs").querySelectorAll(".job-run, .job-earlier")].map((e) => e.textContent ?? ""),
            otherClickable: els.some((e) => e.onclick !== null && !fixed.has(e.id)),
            historyOpen: document.getElementById("job-runs-toggle")?.getAttribute("aria-expanded") === "true",
          };
        })()`);
      })) as DialogView | null,
    phoneSheet: async () =>
      (await open(PHONE, async (p) => {
        await p.waitForFunction('!!document.getElementById("open-agent")', null, { timeout: WAIT_MS });
        await p.evaluate('document.getElementById("open-agent").click()');
        return p.evaluate('document.getElementById("panel")?.parentElement?.id === "panel-dialog"');
      })) as boolean,
  };
}
