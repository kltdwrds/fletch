// M29.5: the panel's X in its own header row (design review 1, I1). At 390 the X sat on the agent sheet's segment
// control, and in the pinned panel it scrolled away with the body. Layout is a browser's question, so each claim runs
// the shipped page in hermetic Chromium, every request answered by the authority world's routes as Ada or Bo of
// solo-sam and every socket held in the test. Each person's journal holds twenty activity rows, so the panel's body
// is long enough to scroll in every form. The guard is planted against master: the page served with master's X and
// rules put back, and the same check must fail on it.
import { type Browser, chromium, type Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ic } from "../../packages/agent/src/http/app/icons.ts";
import { PANEL_TEXT } from "../../packages/agent/src/http/app/panel.ts";
import { APP_PAGE } from "../../packages/agent/src/http/page.ts";
import { ada, authorityWorld } from "./support/authority-world.ts";
import { SETTLED } from "./support/motion.ts";
import { servePages } from "./support/page-routes.ts";

/** Swaps one exact piece of the shipped page, and fails when the piece is not there (a plant that missed proves nothing). */
const swap = (html: string, from: string, to: string) => {
  expect(html).toContain(from);
  return html.replace(from, to);
};

let browser: Browser;
const w = authorityWorld({ script: [] });
beforeAll(async () => {
  browser = await chromium.launch({ channel: "chromium", headless: true });
  // Twenty rows in the owner's Activity: one proposed mail a turn.
  for (const [who, to] of [[ada.email, ada.email]] as const)
    for (let i = 0; i < 20; i++) {
      w.fake.enqueue({ toolCall: { id: `m${i}`, name: "mail_send", arguments: { to, body: "Notes." } } });
      await w.say(who, `Mail the notes, part ${i}.`);
    }
}, 120_000);
afterAll(async () => {
  await browser?.close();
});

/** The person's page at a width (or a planted copy), every request answered by the world's routes as them. */
async function on<T>(o: { who: string; width: number; height: number; html?: string }, fn: (pg: Page) => Promise<T>): Promise<T> {
  const ctx = await browser.newContext({ viewport: { width: o.width, height: o.height }, colorScheme: "dark", serviceWorkers: "block" });
  try {
    await ctx.routeWebSocket(/.*/, () => {});
    await servePages(ctx, (m, p, b) => w.http(o.who, m, p, b), o.html ?? APP_PAGE);
    const pg = await ctx.newPage();
    await pg.goto("https://solo-sam.example/");
    await pg.waitForFunction('document.querySelectorAll("#chats [data-chat]").length >= 1');
    return await fn(pg);
  } finally {
    await ctx.close();
  }
}

interface Look {
  /** The panel's form: the phone's sheet or the pinned column. */
  host: string;
  /** Every other visible element inside the panel whose visible box meets the X's. */
  hits: string[];
  xTop: number;
  label: string;
  glyph: string[];
  /** The panel's controls that sit on the X's row: the X alone. */
  row: string[];
  /** The X's end edge against the panel's, and whether it sits in the end half. */
  endGap: number;
  endHalf: boolean;
  /** The grabber's top and bottom against the X's (on a phone), null in the pinned column. */
  grab: { top: number; bottom: number } | null;
  rows: number;
}
/**
 * Reads the open panel. An element's visible box is its box cut by every ancestor that clips its overflow, so a row the
 * body has scrolled out of view under the header is not drawn there; the X, its own contents and the elements that
 * contain it are not "other". Browser code is a string, as design-screens writes it: the agent package's types carry
 * no DOM.
 */
const LOOK = `(() => {
  const x = document.getElementById("close-sheet"), host = x.closest("#panel-dialog, #panel-pin");
  const seen = (e) => { let r = e.getBoundingClientRect(), L = r.left, T = r.top, R = r.right, B = r.bottom;
    for (let a = e.parentElement; a && a !== document.documentElement; a = a.parentElement) {
      const s = getComputedStyle(a); if (s.overflowX === "visible" && s.overflowY === "visible") continue;
      const q = a.getBoundingClientRect(); L = Math.max(L, q.left); T = Math.max(T, q.top); R = Math.min(R, q.right); B = Math.min(B, q.bottom);
    }
    return R - L > 0.5 && B - T > 0.5 ? { L, T, R, B } : null; };
  const xr = seen(x), hr = host.getBoundingClientRect(), xb = x.getBoundingClientRect();
  const shown = [...host.querySelectorAll("*")].filter((e) => e !== x && !x.contains(e) && !e.contains(x) && e.checkVisibility({ visibilityProperty: true, opacityProperty: true }));
  const name = (e) => e.id || (e.getAttribute("class") || e.tagName.toLowerCase()).split(" ")[0] + (e.textContent ? ":" + e.textContent.trim().slice(0, 24) : "");
  const hits = xr ? shown.map((e) => [e, seen(e)]).filter(([, r]) => r && r.L < xr.R - 0.5 && xr.L < r.R - 0.5 && r.T < xr.B - 0.5 && xr.T < r.B - 0.5).map(([e]) => name(e)) : ["the X is not drawn"];
  const controls = shown.filter((e) => e.matches("button, a[href], input, select, textarea, [role=button], [role=tab]")).filter((e) => { const r = seen(e); return r && r.T < xb.bottom && r.B > xb.top; });
  const g = host.querySelector(".qf-grab"), gr = g && g.checkVisibility() ? g.getBoundingClientRect() : null;
  return { host: host.id, hits, xTop: Math.round(xb.top * 2) / 2, label: x.getAttribute("aria-label"), glyph: [...x.querySelectorAll("path")].map((p) => p.getAttribute("d")),
    row: [x, ...controls].map((e) => e.id), endGap: Math.round(hr.right - xb.right), endHalf: xb.left > hr.left + hr.width / 2,
    grab: gr ? { top: gr.top - xb.top, bottom: gr.bottom - xb.bottom } : null, rows: document.querySelectorAll("#panel-activity .prow").length };
})()`;
/** Scrolls whatever scrolls inside the panel to its end and says how far it went. */
const SCROLL_END = `(() => {
  const host = document.getElementById("close-sheet").closest("#panel-dialog, #panel-pin");
  let moved = 0;
  for (const e of [host, ...host.querySelectorAll("*")]) {
    if (!/(auto|scroll)/.test(getComputedStyle(e).overflowY) || e.scrollHeight <= e.clientHeight + 1) continue;
    const before = e.scrollTop; e.scrollTop = e.scrollHeight; moved += e.scrollTop - before;
  }
  return moved;
})()`;
const look = (pg: Page) => pg.evaluate(LOOK) as Promise<Look>;

/** The panel open at a width (the phone opens its sheet from the header's avatar), read, scrolled to the end, read. */
async function scrolled(pg: Page, width: number) {
  if (width < 768) await pg.click("#open-agent");
  await pg.waitForFunction('document.querySelectorAll("#panel-activity .prow").length === 20');
  await pg.evaluate(SETTLED);
  const before = await look(pg);
  const moved = (await pg.evaluate(SCROLL_END)) as number;
  await pg.evaluate("new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))");
  return { before, moved, after: await look(pg) };
}
type Seen = Awaited<ReturnType<typeof scrolled>>;

const X_PATHS = [...ic("x", "md").matchAll(/ d="([^"]+)"/g)].map((m) => m[1]);
const FORMS = [
  [390, 844],
  [768, 1024],
  [1440, 900],
] as const;
/** The claim: the X meets nothing before or after the body scrolls to its end, it stays put, and it is the row's one control. */
function ownRow(s: Seen, width: number) {
  expect(s.before.host).toBe(width < 768 ? "panel-dialog" : "panel-pin");
  expect(s.before.rows).toBe(20);
  expect(s.moved, "the body scrolls").toBeGreaterThan(0);
  expect(s.before.hits, "before scrolling").toEqual([]);
  expect(s.after.hits, "scrolled to the end").toEqual([]);
  expect(s.after.xTop, "the X stays put").toBe(s.before.xTop);
  for (const l of [s.before, s.after]) {
    expect([l.row, l.label, l.glyph, l.endHalf]).toEqual([["close-sheet"], PANEL_TEXT.close, X_PATHS, true]);
    expect(l.endGap).toBe(width < 768 ? 16 : 12);
  }
}

describe("[M29.5] the panel's X in its own header row", () => {
  for (const [width, height] of FORMS)
    it(`at ${width} (${width < 768 ? "the sheet" : "pinned"}) the X's box meets no other visible element in the panel, before and after the body scrolls to its end, and its top stays put, for Ada and Bo`, async () => {
      for (const who of [ada.email]) ownRow(await on({ who, width, height }, (pg) => scrolled(pg, width)), width);
    }, 120_000);

  it("at 390 the X is on the grabber's row: the grabber's line lies within the X's height, before and after scrolling; pinned, there is no grabber", async () => {
    const s = await on({ who: ada.email, width: 390, height: 844 }, (pg) => scrolled(pg, 390));
    for (const l of [s.before, s.after]) {
      const g = l.grab as { top: number; bottom: number };
      expect(g).not.toBeNull();
      expect([g.top >= 0, g.bottom <= 0]).toEqual([true, true]);
    }
    const pinned = await on({ who: ada.email, width: 1440, height: 900 }, (pg) => scrolled(pg, 1440));
    expect([pinned.before.grab, pinned.after.grab]).toEqual([null, null]);
  }, 60_000);

  it("planted: master's X, absolute over the sheet's first row and inside the pinned panel's scroller, fails the check at every width", async () => {
    let html = swap(APP_PAGE, `<div class="panel-head"><button id="close-sheet"`, `<button id="close-sheet"`);
    html = swap(html, `${ic("x", "md")}</button></div>\n  <div class="panel-scroll">`, `${ic("x", "md")}</button>\n  <div style="display:contents">`);
    for (const [now, then] of MASTER_RULES) html = swap(html, now, then);
    for (const [width, height] of FORMS) {
      const s = await on({ who: ada.email, width, height, html }, (pg) => scrolled(pg, width));
      expect(() => ownRow(s, width), `master at ${width}`).toThrow();
      // The reason, per form: the sheet's first row under the X; the pinned X scrolled away with the body.
      if (width < 768) expect(s.before.hits.length, "master's X over the sheet's row").toBeGreaterThan(0);
      else expect(s.after.xTop !== s.before.xTop || s.after.hits.length > 0, `master's X moves at ${width}`).toBe(true);
    }
  }, 180_000);
});

/** The shell's panel rules as this part writes them, and as master wrote them (M29.2). */
const MASTER_RULES = [
  [
    `#panel { display: flex; flex-direction: column; flex: 1 1 auto; min-height: 0; width: 100%; }
.panel-head { position: relative; flex: none; width: 100%; height: 56px; }
.panel-scroll { display: flex; flex-direction: column; align-items: center; gap: 12px; flex: 1 1 auto; min-height: 0; width: 100%; padding: 0 16px 44px; overflow: auto; }
#panel-pin { position: relative; padding: 0; overflow: hidden; }
#panel-dialog { padding-top: 0; }
#panel-dialog .panel-head { height: 48px; }
#panel-dialog #close-sheet { inset-inline-end: 16px; top: 8px; }
`,
    `#panel { display: flex; flex-direction: column; align-items: center; gap: 12px; width: 100%; }
#panel-pin { position: relative; padding-top: 56px; }
#panel-dialog #close-sheet { inset-inline-end: 16px; top: 16px; }
`,
  ],
  ["#panel-dialog .panel-scroll { padding: 4px 16px 8px; }", "#panel-dialog > #panel { padding: 8px 16px; overflow: auto; }"],
] as const;
