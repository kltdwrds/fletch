// M29.2: the shell from the re-seeded system (design review 1's rows A2–A5 and D1): the column dividers, the list
// column's and the panel's resize separators, the panel pinned inline from 768 with the Chats pill, one agent avatar
// on the page, and the panel header's one X. Layout is a browser's question, so each claim runs the shipped page in
// hermetic Chromium, every request answered by the authority world's routes as Ada or Bo of solo-sam and every
// socket held in the test. Each guard is planted against master's behaviour: the page served with the guard rewritten
// to what master did, and the same check must fail on it.
import { type Browser, chromium, type Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ic } from "../../packages/agent/src/http/app/icons.ts";
import { PANEL_TEXT } from "../../packages/agent/src/http/app/panel.ts";
import { COLUMNS, SHELL_TEXT, WIDTHS_KEY } from "../../packages/agent/src/http/app/shell.ts";
import { APP_PAGE } from "../../packages/agent/src/http/page.ts";
import { ada, authorityWorld } from "./support/authority-world.ts";
import { SETTLED } from "./support/motion.ts";
import { page } from "./support/page-harness.ts";
import { servePages } from "./support/page-routes.ts";

/** Swaps one exact piece of the shipped page, and fails when the piece is not there (a plant that missed proves nothing). */
const swap = (html: string, from: string, to: string, all = false) => {
  expect(html).toContain(from);
  return all ? html.replaceAll(from, to) : html.replace(from, to);
};

let browser: Browser;
const w = authorityWorld();
beforeAll(async () => {
  browser = await chromium.launch({ channel: "chromium", headless: true });
}, 120_000);
afterAll(async () => {
  await browser?.close();
});

interface Viewer {
  pg: Page;
  close(): Promise<void>;
}
/**
 * A viewer's own browser (its own storage) on the person's page at a width: the page (or a planted copy) and every
 * request it makes answered by the world's routes as that person, sockets held here. `blockStorage` makes every use
 * of localStorage throw, as a private window or blocked site data does.
 */
async function viewer(o: { who?: string; width: number; height?: number; scheme?: "dark" | "light"; html?: string; blockStorage?: boolean }): Promise<Viewer> {
  const ctx = await browser.newContext({ viewport: { width: o.width, height: o.height ?? 900 }, colorScheme: o.scheme ?? "dark", serviceWorkers: "block" });
  await ctx.routeWebSocket(/.*/, () => {});
  if (o.blockStorage) await ctx.addInitScript('Object.defineProperty(window, "localStorage", { get() { throw new Error("SecurityError: storage is blocked"); } });');
  await servePages(ctx, (m, p, b) => w.http(o.who ?? ada.email, m, p, b), o.html ?? APP_PAGE);
  const pg = await ctx.newPage();
  await load(pg);
  return { pg, close: () => ctx.close() };
}
async function load(pg: Page, reload = false) {
  if (reload) await pg.reload();
  else await pg.goto("https://solo-sam.example/");
  await pg.waitForFunction('document.querySelectorAll("#chats [data-chat]").length >= 1');
}
/** Runs `f` on a viewer and closes it after, pass or fail. */
async function on<T>(o: Parameters<typeof viewer>[0], f: (pg: Page) => Promise<T>): Promise<T> {
  const v = await viewer(o);
  try {
    return await f(v.pg);
  } finally {
    await v.close();
  }
}

// ---- (1) the dividers ----

interface Edges {
  divider: string;
  rail: { start: string; end: string };
  list: { start: string; end: string; line: string; lineW: number; lineAtEnd: boolean; lineFull: boolean };
  stage: { start: string; end: string };
  panel: { start: string; end: string };
}
/** Each column edge's border (`<width> <colour>`, or `none`), the list's resize line, and fill-divider as computed. */
const READ_EDGES = `(() => {
  const cs = (id) => getComputedStyle(document.getElementById(id));
  const edge = (id, side) => { const s = cs(id); const w = parseFloat(s["border-" + side + "-width"]); return w > 0 && s["border-" + side + "-style"] !== "none" ? w + "px " + s["border-" + side + "-color"] : "none"; };
  const probe = document.createElement("i"); probe.style.color = "var(--fill-divider)"; document.getElementById("app").append(probe);
  const divider = getComputedStyle(probe).color; probe.remove();
  const line = document.querySelector("#drawer .qf-colresize-line"), lr = line.getBoundingClientRect(), dr = document.getElementById("drawer").getBoundingClientRect();
  const col = (id) => ({ start: edge(id, "left"), end: edge(id, "right") });
  return {
    divider,
    rail: col("rail"),
    list: { ...col("drawer"), line: getComputedStyle(line).backgroundColor, lineW: lr.width, lineAtEnd: Math.abs(lr.right - dr.right) < 0.5, lineFull: lr.top <= dr.top + 0.5 && lr.bottom >= dr.bottom - 0.5 },
    stage: col("stage"),
    panel: col("panel-pin"),
  };
})()`;
const readEdges = (pg: Page) => pg.evaluate(READ_EDGES) as Promise<Edges>;
/** The three dividers the system draws, in fill-divider, and no border on any other column edge. */
function dividersAsDrawn(e: Edges) {
  const d = `1px ${e.divider}`;
  expect(e.list.start, "rail | list").toBe(d);
  expect([e.list.line, e.list.lineW, e.list.lineAtEnd, e.list.lineFull], "list | stage").toEqual([e.divider, 1, true, true]);
  expect(e.panel.start, "stage | panel").toBe(d);
  expect([e.rail.start, e.rail.end, e.list.end, e.stage.start, e.stage.end, e.panel.end], "other edges").toEqual(["none", "none", "none", "none", "none", "none"]);
}

describe("[M29.2] the column dividers", () => {
  it("rail|list, list|stage and stage|panel are 1px fill-divider in light and dark, and no other column edge has a border, for Ada and Bo", async () => {
    const seen: Record<string, string> = {};
    for (const who of [ada.email])
      for (const scheme of ["light", "dark"] as const) {
        const e = await on({ who, width: 1440, scheme }, readEdges);
        dividersAsDrawn(e);
        seen[scheme] = e.divider;
      }
    // fill-divider is the system's per theme: black at 10 % in light, white at 12 % in dark.
    expect(seen).toEqual({ light: "rgba(0, 0, 0, 0.1)", dark: "rgba(255, 255, 255, 0.12)" });
  }, 120_000);

  it("planted: master's columns had no divider, and the check fails", async () => {
    const html = swap(APP_PAGE, "border-inline-start:1px solid var(--fill-divider)", "", true);
    const e = await on({ width: 1440, html }, readEdges);
    expect([e.list.start, e.panel.start]).toEqual(["none", "none"]);
    expect(() => dividersAsDrawn(e)).toThrow();
  }, 60_000);
});

// ---- (2) the resize separators ----

const LIST_SEP = "#list-resize";
const PANEL_SEP = "#panel-resize";
const widthOf = (pg: Page, sel: string) => pg.evaluate(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); return e && e.checkVisibility() ? Math.round(e.getBoundingClientRect().width) : 0; })()`) as Promise<number>;
const shownNow = (pg: Page, sel: string) => pg.evaluate(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); return !!e && e.checkVisibility() && e.getBoundingClientRect().width > 0; })()`) as Promise<boolean>;
/** Drags a separator by `dx` from its centre, in steps, as a pointer does. */
async function drag(pg: Page, sel: string, dx: number) {
  const b = await pg.locator(sel).boundingBox();
  if (!b) throw new Error(`${sel} is not drawn`);
  const [x, y] = [b.x + b.width / 2, b.y + b.height / 2];
  await pg.mouse.move(x, y);
  await pg.mouse.down();
  await pg.mouse.move(x + dx, y, { steps: 6 });
  await pg.mouse.up();
}
/** The list column's width as the separator moves it: keys to each end, then drags past both ends. */
async function listUnderSeparator(pg: Page) {
  const seen: Record<string, number | string> = { start: await widthOf(pg, "#drawer"), now: (await pg.getAttribute(LIST_SEP, "aria-valuenow")) ?? "" };
  await pg.focus(LIST_SEP);
  await pg.keyboard.press("ArrowLeft");
  seen.keyUnderMin = await widthOf(pg, "#drawer");
  await pg.keyboard.press("ArrowRight");
  seen.keyStep = await widthOf(pg, "#drawer");
  await pg.keyboard.press("End");
  await pg.keyboard.press("ArrowRight");
  seen.keyOverMax = await widthOf(pg, "#drawer");
  await pg.keyboard.press("Home");
  await drag(pg, LIST_SEP, 500);
  seen.dragOverMax = await widthOf(pg, "#drawer");
  await drag(pg, LIST_SEP, -120);
  seen.dragTo = await widthOf(pg, "#drawer");
  seen.valuenow = (await pg.getAttribute(LIST_SEP, "aria-valuenow")) ?? "";
  return seen;
}
const CLAMPED = { start: 240, now: "240", keyUnderMin: 240, keyStep: 256, keyOverMax: 420, dragOverMax: 420, dragTo: 300, valuenow: "300" };

describe("[M29.2] the list column and the panel resize", () => {
  it("the list separator clamps 240–420 by key and by drag, collapses under its threshold, and Ada's stored width and collapse come back after a reload; Bo's browser keeps the default", async () => {
    expect([COLUMNS.list.min, COLUMNS.list.max, COLUMNS.list.def, COLUMNS.panel.def]).toEqual([240, 420, 240, 360]);
    const a = await viewer({ who: ada.email, width: 1440 });
    try {
      expect(await listUnderSeparator(a.pg)).toEqual(CLAMPED);
      await load(a.pg, true);
      expect([await widthOf(a.pg, "#drawer"), await a.pg.getAttribute(LIST_SEP, "aria-valuenow")]).toEqual([300, "300"]);
      // Dragged under the threshold the column collapses and the Chats pill stands in for it, after a reload too.
      await drag(a.pg, LIST_SEP, -(300 - COLUMNS.list.collapseAt) - 40);
      const collapsed = async () => [await shownNow(a.pg, "#drawer"), await shownNow(a.pg, "#chats-pill"), await a.pg.getAttribute("#shell", "class")];
      expect(await collapsed()).toEqual([false, true, "qf-shell is-list-collapsed"]);
      await load(a.pg, true);
      expect(await collapsed()).toEqual([false, true, "qf-shell is-list-collapsed"]);
      // On a desktop the pill gives the column back at its default width.
      await a.pg.click("#chats-pill");
      expect([await widthOf(a.pg, "#drawer"), await shownNow(a.pg, "#chats-pill"), await a.pg.getAttribute("#shell", "class")]).toEqual([240, false, "qf-shell"]);
    } finally {
      await a.close();
    }
    // Widths are each viewer's own: Bo's browser has stored nothing and draws the default.
    expect(await on({ width: 1440 }, (pg) => widthOf(pg, "#drawer"))).toBe(240);
  }, 120_000);

  it("the panel's separator moves its width, by drag and by key, within 320–480, and the width comes back after a reload", async () => {
    const a = await viewer({ who: ada.email, width: 1440 });
    try {
      const seen = [await widthOf(a.pg, "#panel-pin")];
      await drag(a.pg, PANEL_SEP, -60);
      seen.push(await widthOf(a.pg, "#panel-pin"));
      await a.pg.focus(PANEL_SEP);
      await a.pg.keyboard.press("ArrowLeft");
      seen.push(await widthOf(a.pg, "#panel-pin"));
      await drag(a.pg, PANEL_SEP, -400);
      seen.push(await widthOf(a.pg, "#panel-pin"));
      await drag(a.pg, PANEL_SEP, 600);
      seen.push(await widthOf(a.pg, "#panel-pin"));
      await a.pg.keyboard.press("ArrowLeft");
      seen.push(await widthOf(a.pg, "#panel-pin"));
      expect(seen).toEqual([360, 420, 436, 480, 320, 336]);
      await load(a.pg, true);
      expect(await widthOf(a.pg, "#panel-pin")).toBe(336);
    } finally {
      await a.close();
    }
  }, 120_000);

  it("with storage blocked the page draws the defaults and the separators still move the columns", async () => {
    const seen = await on({ width: 1440, blockStorage: true }, async (pg) => {
      const at = [await widthOf(pg, "#drawer"), await widthOf(pg, "#panel-pin")];
      await drag(pg, LIST_SEP, 60);
      return [...at, await widthOf(pg, "#drawer")];
    });
    expect(seen).toEqual([240, 360, 300]);
  }, 60_000);

  it("a stored width outside the bounds is drawn clamped, and a stored value that is not a width draws the default", async () => {
    const at = (stored: string) =>
      on({ width: 1440 }, async (pg) => {
        await pg.evaluate(`localStorage.setItem(${JSON.stringify(WIDTHS_KEY)}, ${JSON.stringify(stored)})`);
        await load(pg, true);
        return [await widthOf(pg, "#drawer"), await widthOf(pg, "#panel-pin")];
      });
    expect(await at(JSON.stringify({ list: 900, panel: 10 }))).toEqual([420, 320]);
    expect(await at("not json")).toEqual([240, 360]);
  }, 60_000);

  it("planted: master's fixed column (no resizer) and an unclamped drag each fail the check", async () => {
    const fixed = swap(APP_PAGE, 'resizer($("list-resize"), "list");', "");
    expect(await on({ width: 1440, html: fixed }, listUnderSeparator)).not.toEqual(CLAMPED);
    const unclamped = swap(APP_PAGE, "const clampW = (k, w) => Math.max(COLS[k].min, Math.min(COLS[k].max, Math.round(w)));", "const clampW = (k, w) => Math.round(w);");
    const seen = await on({ width: 1440, html: unclamped }, listUnderSeparator);
    expect(seen.dragOverMax).toBeGreaterThan(420);
    expect(seen).not.toEqual(CLAMPED);
  }, 120_000);
});

// ---- (3) the panel from 768 and the Chats pill ----

/** What is on the page: the pinned panel's box, the stage's end edge, any open dialog, the list's form and place. */
const READ_PIN = `(() => {
  const box = (id) => { const e = document.getElementById(id); const r = e.getBoundingClientRect(); return e.checkVisibility() && r.width > 0 ? { x: Math.round(r.x), w: Math.round(r.width) } : null; };
  const dialogs = [...document.querySelectorAll('[role="dialog"], [role="alertdialog"], .qf-scrim2, .qf-drawer-wrap')].filter((d) => d.checkVisibility() && d.getBoundingClientRect().width > 0).map((d) => d.id || d.className);
  const stage = document.getElementById("stage").getBoundingClientRect();
  return { pin: box("panel-pin"), stageEnd: Math.round(stage.right), dialogs, panelIn: document.getElementById("panel").parentElement.id, list: box("drawer"), listClass: document.getElementById("drawer").className, pill: box("chats-pill") };
})()`;
interface Pin {
  pin: { x: number; w: number } | null;
  stageEnd: number;
  dialogs: string[];
  panelIn: string;
  list: { x: number; w: number } | null;
  listClass: string;
  pill: { x: number; w: number } | null;
}
/** Read at rest: an overlay's enter or exit (M29.6) has run before the page is read. */
const readPin = async (pg: Page) => {
  await pg.evaluate(SETTLED);
  return (await pg.evaluate(READ_PIN)) as Pin;
};
/** Closes the pinned panel on its X, opens it again from the header's avatar, and reads the page. */
async function reopenFromAvatar(pg: Page) {
  await pg.click("#close-sheet");
  const closed = await readPin(pg);
  await pg.click("#open-agent");
  return { closed, open: await readPin(pg) };
}
/** Pinned inline at 360 at the end edge, beside the stage and not over it, with no dialog anywhere. */
function pinnedInline(p: Pin, width: number) {
  expect(p.pin).toEqual({ x: width - 360, w: 360 });
  expect([p.stageEnd, p.dialogs, p.panelIn]).toEqual([width - 360, [], "panel-pin"]);
}

describe("[M29.2] the panel pins from 768 and the Chats pill", () => {
  it("at 768 and 1024 opening the agent from the header's avatar pins #panel-pin inline at 360 with no dialog, for Ada and Bo", async () => {
    for (const who of [ada.email])
      for (const width of [768, 1024]) {
        const { closed, open } = await on({ who, width, height: 1024 }, reopenFromAvatar);
        expect([closed.pin, closed.dialogs]).toEqual([null, []]);
        pinnedInline(open, width);
      }
  }, 120_000);

  it("from 768 to 1023 the list column is the Chats pill, which opens the list as the overlay beside the rail; at 1024 the column is inline", async () => {
    const tablet = await on({ width: 768, height: 1024 }, async (pg) => {
      const before = await readPin(pg);
      await pg.click("#chats-pill");
      const over = await readPin(pg);
      // A chat opened from the overlay closes it, and the list goes back to its column form.
      await pg.click("#chats [data-chat] .qf-listrow");
      // The switch runs inside a view transition (M29.6), whose update comes a frame later: wait for it, then the exit.
      await pg.waitForFunction('document.getElementById("drawer").className === "qf-listcol qf-listcol--chat"');
      return { before, over, after: await readPin(pg) };
    });
    expect([tablet.before.list, tablet.before.pill === null]).toEqual([null, false]);
    expect([tablet.over.list, tablet.over.listClass, tablet.over.dialogs]).toEqual([{ x: 72, w: 240 }, "qf-listcol qf-listcol--over", ["scrim"]]);
    expect([tablet.after.list, tablet.after.listClass, tablet.after.dialogs]).toEqual([null, "qf-listcol qf-listcol--chat", []]);
    const desktop = await on({ width: 1024 }, readPin);
    expect([desktop.list, desktop.pill, desktop.listClass]).toEqual([{ x: 72, w: 240 }, null, "qf-listcol qf-listcol--chat"]);
  }, 120_000);

  it("below 768 the panel is still the phone's bottom sheet", async () => {
    const p = await on({ width: 390, height: 844 }, async (pg) => {
      await pg.click("#open-agent");
      return readPin(pg);
    });
    expect([p.pin, p.panelIn, p.dialogs]).toEqual([null, "panel-dialog", ["scrim", "panel-dialog"]]);
  }, 60_000);

  it("planted: master's panel pinned only from 1280 opens a dialog at 768, and the check fails", async () => {
    let html = swap(APP_PAGE, 'const pinnable = () => shown === "chat" && device() !== "phone";', 'const pinnable = () => shown === "chat" && innerWidth >= 1280;');
    html = swap(html, '<aside id="panel-pin" class="qf-panel qf-hide-phone"', '<aside id="panel-pin" class="qf-panel qf-only-wide"');
    html = swap(html, "pinned = chat && d !== \"phone\" && !panelClosed;", "pinned = chat && innerWidth >= 1280 && !panelClosed;");
    const planted = await on({ width: 768, height: 1024, html }, async (pg) => {
      await pg.click("#open-agent");
      return readPin(pg);
    });
    expect(planted.dialogs).toContain("panel-dialog");
    expect(() => pinnedInline(planted, 768)).toThrow();
  }, 60_000);
});

// ---- (4) one agent avatar ----

/** The agent's avatars a person can see: every `.agent-av` drawn and visible. */
const AVATARS = `[...document.querySelectorAll(".agent-av")].filter((a) => a.checkVisibility({ visibilityProperty: true }) && a.getBoundingClientRect().width > 0).map((a) => (a.closest("[id]") || {}).id + ":" + Math.round(a.getBoundingClientRect().width))`;
const avatars = (pg: Page) => pg.evaluate(AVATARS) as Promise<string[]>;
/** The visible avatars with the panel open and then closed (on a phone: the sheet open, then closed). */
async function openAndClosed(pg: Page, width: number) {
  if (width < 768) {
    const closed = await avatars(pg);
    await pg.click("#open-agent");
    const open = await avatars(pg);
    return { open, closed };
  }
  const open = await avatars(pg);
  await pg.click("#close-sheet");
  return { open, closed: await avatars(pg) };
}

describe("[M29.2] one agent avatar", () => {
  it("no #rail-agent and no .sock on the page; the rail's bottom is Get the app and Settings", () => {
    expect(APP_PAGE).not.toMatch(/id="rail-agent"|id="rail-sock"|id="sock"|class="sock"|\.sock\b/);
    const rail = APP_PAGE.slice(APP_PAGE.indexOf('<nav id="rail"'), APP_PAGE.indexOf("</nav>", APP_PAGE.indexOf('<nav id="rail"')));
    const bottom = rail.slice(rail.indexOf("qf-rail-spacer"));
    expect([...bottom.matchAll(/aria-label="([^"]+)"/g)].map((m) => m[1])).toEqual([SHELL_TEXT.getApp, SHELL_TEXT.settings]);
    expect(bottom).toContain(ic("phone", "lg"));
  });

  it("exactly one visible agent avatar with the panel open and closed, at 390, 768 and 1440, for Ada and Bo", async () => {
    for (const who of [ada.email])
      for (const [width, height] of [
        [390, 844],
        [768, 1024],
        [1440, 900],
      ] as const) {
        const seen = await on({ who, width, height }, (pg) => openAndClosed(pg, width));
        // Open: the panel's 100 px avatar (the header's under a phone's sheet, which draws none); closed: the header's 48.
        expect(seen, `${who} at ${width}`).toEqual(width < 768 ? { open: ["open-agent:48"], closed: ["open-agent:48"] } : { open: ["panel:100"], closed: ["open-agent:48"] });
      }
  }, 180_000);

  it("planted: master's header avatar beside the open panel makes two, and the check fails", async () => {
    const html = swap(APP_PAGE, '$("open-agent").hidden = !chat || pinned;', '$("open-agent").hidden = !chat;');
    const seen = await on({ width: 1440, html }, (pg) => openAndClosed(pg, 1440));
    expect(seen.open).toHaveLength(2);
  }, 60_000);
});

// ---- (5) the panel header's one X ----

interface Head {
  controls: string[];
  label: string;
  glyph: string[];
  endGap: number;
  startHalf: boolean;
}
/** The controls above the panel's avatar, and the X's label, glyph and place against the panel's end edge. */
const READ_HEAD = `(() => {
  const pin = document.getElementById("panel-pin"), pr = pin.getBoundingClientRect();
  const top = pin.querySelector(".panel-hero .agent-av").getBoundingClientRect().top;
  const controls = [...pin.querySelectorAll("button, a[href], input, select, textarea, [role=button]")].filter((c) => c.checkVisibility() && c.getBoundingClientRect().bottom <= top).map((c) => c.id);
  const x = document.getElementById("close-sheet"), xr = x.getBoundingClientRect();
  return { controls, label: x.getAttribute("aria-label"), glyph: [...x.querySelectorAll("path")].map((p) => p.getAttribute("d")), endGap: Math.round(pr.right - xr.right), startHalf: xr.left < pr.left + pr.width / 2 };
})()`;
/** The x glyph's strokes, as the shell's icon set draws it. */
const X_PATHS = [...ic("x", "md").matchAll(/ d="([^"]+)"/g)].map((m) => m[1]);
const readHead = (pg: Page) => pg.evaluate(READ_HEAD) as Promise<Head>;
function oneX(h: Head) {
  expect(h).toEqual({ controls: ["close-sheet"], label: PANEL_TEXT.close, glyph: X_PATHS, endGap: 12, startHalf: false });
}

describe("[M29.2] the panel header holds only the X", () => {
  it("the pinned panel's header has one control, a right-aligned X labelled Close, at 768 and 1440", async () => {
    expect(PANEL_TEXT.close).toBe("Close");
    for (const width of [768, 1440]) oneX(await on({ width, height: 1024 }, readHead));
  }, 60_000);

  it("in the page script's DOM, #panel's controls before its tabs are the X alone, and it closes the panel", async () => {
    const p = await page({ onSend() {} }, { desktop: true });
    const panel = p.byId("panel");
    const head = panel.children.slice(0, panel.children.findIndex((c) => c.id.startsWith("panel-tab")));
    expect(head.filter((c) => c.tag === "button").map((c) => c.id)).toEqual(["close-sheet"]);
    await p.byId("close-sheet").onclick?.();
    expect([p.byId("panel-pin").hidden, p.byId("open-agent").hidden]).toEqual([true, false]);
  });

  it("planted: master's start-edge panel toggle fails the check", async () => {
    const html = swap(
      APP_PAGE,
      `<button id="close-sheet" class="qf-ibtn qf-panel-x" aria-label="Close">${ic("x", "md")}`,
      `<button id="close-sheet" class="qf-ibtn" style="position:absolute;left:12px;top:12px" aria-label="Close your agent's panel">${ic("panelr", "md")}`,
    );
    const h = await on({ width: 1440, html }, readHead);
    expect(h.startHalf).toBe(true);
    expect(() => oneX(h)).toThrow();
  }, 60_000);
});
