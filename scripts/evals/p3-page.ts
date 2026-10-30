// Sam's page on a preview slot in headless Chromium (F34): the P3 graders' reads of a task drawer's sub-agent sections and
// of the thread (`P3Page`, scripts/evals/p3-slot.ts), as the tier-1 harness reads them from the page script
// (`test/evals/p3-delegation/harness.ts` `sections`, `threadDom`), here from the slot's own page with the trial's
// session. Each read loads the page afresh. The browser is playwright-core's pinned Chromium (AGENTS.md, gotcha 5).
import type { Page } from "playwright-core";
import type { DrawnSection, ThreadDom } from "../../test/evals/p3-delegation/world.ts";
import type { P3Page } from "./p3-slot.ts";
import { activityTab, DESKTOP, openTask, PHONE, pageOpener, WAIT_MS } from "./p5-page.ts";

/** The drawer's sections as the tier-1 harness reads them: each head, then its rows, each row's nested steps. */
const SECTIONS = `(() => {
  const out = [];
  for (const n of document.getElementById("task-steps").children) {
    const cls = n.className.split(" ");
    if (cls.includes("qf-items-head")) out.push({ n: n.dataset.section ?? "", head: [...n.children].map((c) => c.textContent).join(" | "), rows: [] });
    else if (n.className === "task-sub") out.at(-1)?.rows.push({ id: n.dataset.row ?? "", depth: Number(n.dataset.depth), line: n.textContent ?? "", steps: [] });
    else if (n.tagName === "OL" && cls.includes("qf-tl--nested")) out.at(-1)?.rows.at(-1)?.steps.push(...[...n.querySelectorAll("li")].map((li) => li.querySelector(".nm")?.textContent ?? ""));
  }
  return out;
})()`;

/** The thread as the tier-1 harness reads it: the bubbles, every list in the log, each entry's kind by its class. */
const THREAD = `(() => {
  const log = document.getElementById("log");
  const entries = [...log.children];
  return {
    bubbles: entries.filter((c) => /\\b(you|agent)\\b/.test(c.className)).map((c) => ({ side: /\\byou\\b/.test(c.className) ? "you" : "agent", text: c.textContent ?? "" })),
    lists: [...log.querySelectorAll("ol, ul")].map((n) => ({ tag: n.tagName.toLowerCase(), start: n.getAttribute("start"), items: [...n.children].map((c) => c.textContent ?? "") })),
    kinds: entries.map((c) => c.className.split(" ").filter((x) => x && x !== "m").join(" ")),
  };
})()`;

/** Waits until the log has drawn the history and stopped growing. */
async function drawn(p: Page): Promise<void> {
  await p.waitForFunction('(document.getElementById("log")?.children.length ?? 0) > 0', null, { timeout: WAIT_MS });
  let last = -1;
  for (let i = 0; i < 20; i++) {
    const n = (await p.evaluate('document.getElementById("log").children.length')) as number;
    if (n === last) return;
    last = n;
    await p.waitForTimeout(500);
  }
}

/** Sam's page on `base` with the session `cookie`: each read launches Chromium and closes it. */
export function p3Page(base: string, cookie: string): P3Page {
  const open = pageOpener(base, cookie);
  return {
    sections: (_chatId, taskId, phone) =>
      open(phone ? PHONE : DESKTOP, async (p) => {
        await activityTab(p, phone);
        if (!(await openTask(p, taskId))) return [];
        return (await p.evaluate(SECTIONS)) as DrawnSection[];
      }),
    threadDom: (chatId, phone) =>
      open(
        phone ? PHONE : DESKTOP,
        async (p) => {
          await drawn(p);
          return (await p.evaluate(THREAD)) as ThreadDom;
        },
        `/chats/${encodeURIComponent(chatId)}`,
      ),
  };
}
