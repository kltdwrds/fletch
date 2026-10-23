// M29.3: the header, the list, the composer and the menu from the re-seeded system (design review 1's rows B2, B3, C2,
// F1 and G1): Invite's popover and sheet with its clipboard fallback, the agent's name label under its avatar, a chat
// row's time and kebab on hover or focus with its Menu, the composer's opaque footer and its even padding, and the
// rail Settings menu's rows on one centre line. Layout is a browser's question, so each claim runs the shipped page in
// hermetic Chromium, every request answered by the authority world's routes as Ada or Bo of solo-sam, every socket
// held in the test, and the page's clock fixed. Each guard is planted: the page served with the guard rewritten to
// what master did (or with the rule taken out), and the same check must fail on it.
import { type Browser, chromium, type Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { INVITE_TEXT, SETTINGS_MENU, SHELL_TEXT } from "../../packages/agent/src/http/app/shell.ts";
import { APP_PAGE } from "../../packages/agent/src/http/page.ts";
import { ada, authorityWorld, T0 } from "./support/authority-world.ts";
import { SETTLED } from "./support/motion.ts";
import { servePages } from "./support/page-routes.ts";

/** Swaps one exact piece of the shipped page, and fails when the piece is not there (a plant that missed proves nothing). */
const swap = (html: string, from: string, to: string, all = false) => {
  expect(html).toContain(from);
  return all ? html.replaceAll(from, to) : html.replace(from, to);
};

let browser: Browser;
beforeAll(async () => {
  browser = await chromium.launch({ channel: "chromium", headless: true });
}, 120_000);
afterAll(async () => {
  await browser?.close();
});

type World = ReturnType<typeof authorityWorld>;
interface ViewerOpts {
  w: World;
  who?: string;
  width: number;
  height?: number;
  html?: string;
  /** The page's clock (UTC); the rows' times are read against it. */
  now?: number;
  /** "refuse" makes the clipboard refuse every write, as a browser without the permission does; "grant" records each. */
  clipboard?: "refuse" | "grant";
}
/** A viewer's own browser on the person's page at a width, every request answered by the world's routes as that person. */
async function viewer(o: ViewerOpts): Promise<{ pg: Page; close(): Promise<void> }> {
  const ctx = await browser.newContext({ viewport: { width: o.width, height: o.height ?? 900 }, colorScheme: "dark", serviceWorkers: "block", timezoneId: "UTC", locale: "en-US" });
  await ctx.routeWebSocket(/.*/, () => {});
  if (o.clipboard === "refuse") await ctx.addInitScript('Object.defineProperty(navigator, "clipboard", { value: { writeText: () => Promise.reject(new DOMException("Write permission denied.", "NotAllowedError")) } });');
  if (o.clipboard === "grant") await ctx.addInitScript('window.__copied = []; Object.defineProperty(navigator, "clipboard", { value: { writeText: async (t) => { window.__copied.push(t); } } });');
  await servePages(ctx, (m, p, b) => o.w.http(o.who ?? ada.email, m, p, b), o.html ?? APP_PAGE);
  const pg = await ctx.newPage();
  await pg.clock.setFixedTime(new Date(o.now ?? T0 + 2 * 3600_000));
  const me = pg.waitForResponse((r) => new URL(r.url()).pathname === "/me");
  await pg.goto("https://solo-sam.example/");
  await pg.waitForFunction('document.querySelectorAll("#chats [data-chat]").length >= 1');
  // Invite shows once /me has said the person is an admin (Ada); the frame draws it as /me's answer is read.
  await me;
  if ((o.who ?? ada.email) === ada.email) await pg.waitForFunction('!document.getElementById("head-invite").hidden');
  else await pg.evaluate("new Promise((r) => setTimeout(r, 0))");
  return { pg, close: () => ctx.close() };
}
async function on<T>(o: ViewerOpts, f: (pg: Page) => Promise<T>): Promise<T> {
  const v = await viewer(o);
  try {
    return await f(v.pg);
  } finally {
    await v.close();
  }
}
const rect = (pg: Page, sel: string) => pg.evaluate(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, top: r.top, bottom: r.bottom, left: r.left, right: r.right }; })()`) as Promise<{ x: number; y: number; w: number; h: number; top: number; bottom: number; left: number; right: number } | null>;
/**
 * Waits out the page's finite animations (a Menu zooms in from 95 %, a closing popover runs its exit before it is
 * hidden), so what is read is what stays drawn.
 */
const settle = (pg: Page) => pg.evaluate(SETTLED);
const visible = async (pg: Page, sel: string) => {
  await settle(pg);
  return (await pg.evaluate(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); return !!e && e.checkVisibility({ opacityProperty: true, visibilityProperty: true }) && e.getBoundingClientRect().width > 0; })()`)) as boolean;
};

// ---- (1) Invite ----

interface InviteSeen {
  open: boolean;
  form: string;
  parent: string;
  scrim: boolean;
  title: string;
  body: string;
  copy: string;
  artH: number;
  artRadius: string;
  grab: boolean;
  belowPill: boolean;
  rightAligned: boolean;
  atBottom: boolean;
}
const READ_INVITE = `(() => {
  const n = document.getElementById("invite-pop"), pill = document.getElementById("head-invite");
  const r = n.getBoundingClientRect(), p = pill.getBoundingClientRect(), art = n.querySelector(".invite-art");
  const scrim = document.getElementById("scrim");
  return {
    open: n.checkVisibility() && r.width > 0,
    form: n.className.includes("qf-pop") ? "popover" : n.className.includes("qf-dlg") ? "sheet" : n.className,
    parent: n.parentElement.id || n.parentElement.className,
    scrim: !scrim.hidden && scrim.className.includes("qf-scrim2--sheet"),
    title: n.querySelector("h2").textContent,
    body: n.querySelector(".invite-in p").textContent,
    copy: document.getElementById("invite-pop-copy").textContent,
    artH: art.getBoundingClientRect().height,
    artRadius: getComputedStyle(art).borderTopLeftRadius,
    grab: n.querySelector(".qf-grab").checkVisibility(),
    belowPill: r.top >= p.bottom && r.top - p.bottom <= 12,
    rightAligned: Math.abs(r.right - p.right) <= 1,
    atBottom: Math.abs(r.bottom - innerHeight) <= 1,
  };
})()`;
const readInvite = async (pg: Page) => {
  await settle(pg);
  return (await pg.evaluate(READ_INVITE)) as InviteSeen;
};
const CONTENT = { title: INVITE_TEXT.title, body: INVITE_TEXT.body, copy: INVITE_TEXT.copy, artH: 150 };
/** From 768 a popover hung under the pill and right-aligned to it, on no scrim; the canvas's content in it. */
function popoverAsDrawn(s: InviteSeen) {
  expect([s.open, s.form, s.parent, s.scrim, s.grab, s.belowPill, s.rightAligned]).toEqual([true, "popover", "app", false, false, true, true]);
  expect({ title: s.title, body: s.body, copy: s.copy, artH: s.artH }).toEqual(CONTENT);
}
/** At 390 the same content as a BottomSheet: on the sheet scrim, its grabber shown, the frame's bottom edge, the art at r24. */
function sheetAsDrawn(s: InviteSeen) {
  expect([s.open, s.form, s.parent, s.scrim, s.grab, s.atBottom, s.artRadius]).toEqual([true, "sheet", "scrim", true, true, true, "24px"]);
  expect({ title: s.title, body: s.body, copy: s.copy, artH: s.artH }).toEqual(CONTENT);
}
interface CopySeen {
  field: boolean;
  readOnly: boolean;
  value: string;
  focused: boolean;
  selected: boolean;
  note: string;
  copy: string;
  pill: string;
}
const READ_COPY = `(() => {
  const f = document.getElementById("invite-pop-link"), note = document.getElementById("invite-pop-note");
  return {
    field: f.checkVisibility() && f.getBoundingClientRect().width > 0, readOnly: f.readOnly, value: f.value,
    focused: document.activeElement === f, selected: f.selectionStart === 0 && f.selectionEnd === f.value.length && f.value.length > 0,
    note: note.hidden ? "" : note.textContent, copy: document.getElementById("invite-pop-copy").textContent,
    pill: document.getElementById("head-invite").textContent.trim(),
  };
})()`;
const readCopy = async (pg: Page) => {
  await settle(pg);
  return (await pg.evaluate(READ_COPY)) as CopySeen;
};
/** A refused clipboard: the link in a read-only field, focused and selected, said in words; no label says it failed. */
function fallbackAsDrawn(c: CopySeen) {
  expect(c).toEqual({ field: true, readOnly: true, value: "https://solo-sam.example/", focused: true, selected: true, note: INVITE_TEXT.manual, copy: INVITE_TEXT.copy, pill: SHELL_TEXT.invite });
}

describe("[M29.3] Invite's popover and sheet", () => {

  it("at 768 it is the popover too, and at 390 the same content is a BottomSheet", async () => {
    const w = authorityWorld();
    await on({ w, width: 768 }, async (pg) => {
      await pg.click("#head-invite");
      popoverAsDrawn(await readInvite(pg));
    });
    await on({ w, width: 390, height: 844 }, async (pg) => {
      await pg.click("#head-invite");
      sheetAsDrawn(await readInvite(pg));
      await pg.keyboard.press("Escape");
      expect([await visible(pg, "#invite-pop"), await pg.getAttribute("#head-invite", "aria-expanded")]).toEqual([false, "false"]);
    });
  }, 120_000);

  it("a refused clipboard leaves the link in a selected, read-only field and the button's own words, which are its own again on reopening", async () => {
    const w = authorityWorld();
    for (const [width, height] of [[1440, 900], [390, 844]] as const)
      await on({ w, width, height, clipboard: "refuse" }, async (pg) => {
        await pg.click("#head-invite");
        await pg.click("#invite-pop-copy");
        fallbackAsDrawn(await readCopy(pg));
        // It never says "Could not copy", and closing and opening Invite again starts it fresh.
        expect(await pg.evaluate('document.getElementById("app").textContent.includes("Could not copy")')).toBe(false);
        await pg.keyboard.press("Escape");
        await pg.click("#head-invite");
        expect(await readCopy(pg)).toMatchObject({ field: false, note: "", copy: INVITE_TEXT.copy, pill: SHELL_TEXT.invite });
      });
  }, 120_000);

  it("a clipboard that takes the link says Link copied on the button, and the label resets when Invite opens again", async () => {
    const w = authorityWorld();
    await on({ w, width: 1440, clipboard: "grant" }, async (pg) => {
      await pg.click("#head-invite");
      await pg.click("#invite-pop-copy");
      expect([await pg.evaluate("window.__copied"), await readCopy(pg)]).toEqual([["https://solo-sam.example/"], expect.objectContaining({ field: false, copy: INVITE_TEXT.copied, pill: SHELL_TEXT.invite })]);
      await pg.keyboard.press("Escape");
      await pg.click("#head-invite");
      expect((await readCopy(pg)).copy).toBe(INVITE_TEXT.copy);
    });
  }, 120_000);

  it("planted: master's Invite copied at once and wrote its label, and both checks fail", async () => {
    const w = authorityWorld();
    const master = swap(APP_PAGE, '$("head-invite").onclick = openInvite;', '$("head-invite").onclick = async () => { let ok = false; try { await navigator.clipboard.writeText(location.origin + "/"); ok = true; } catch (e) {} $("head-invite-label").textContent = ok ? "Link copied" : "Could not copy"; };');
    await on({ w, width: 1440, html: master, clipboard: "refuse" }, async (pg) => {
      await pg.click("#head-invite");
      const s = await readInvite(pg);
      expect(() => popoverAsDrawn(s)).toThrow();
      expect(await pg.textContent("#head-invite")).toContain("Could not copy");
    });
    // Without the fallback, a refused copy leaves nothing to copy from, and the check fails.
    const noField = swap(APP_PAGE, "f.value = link; f.hidden = false;", "");
    await on({ w, width: 1440, html: noField, clipboard: "refuse" }, async (pg) => {
      await pg.click("#head-invite");
      await pg.click("#invite-pop-copy");
      const c = await readCopy(pg);
      expect(() => fallbackAsDrawn(c)).toThrow();
    });
  }, 120_000);
});

// ---- (2) the name label ----

interface LabelSeen {
  text: string;
  overlaps: boolean;
  below: boolean;
  centred: boolean;
  avatarOnTop: boolean;
}
const READ_LABEL = `(() => {
  const b = document.getElementById("open-agent"), av = b.querySelector(".qf-avatar"), nm = b.querySelector(".nm");
  const a = av.getBoundingClientRect(), n = nm.getBoundingClientRect();
  const hit = document.elementFromPoint(n.left + n.width / 2, n.top + 2);
  return {
    text: nm.textContent,
    overlaps: n.top < a.bottom - 0.5 && n.top >= a.bottom - 8.5,
    below: n.bottom > a.bottom && n.top > a.top + a.height / 2,
    centred: Math.abs((n.left + n.right) / 2 - (a.left + a.right) / 2) <= 0.5,
    avatarOnTop: !!hit && av.contains(hit),
  };
})()`;
const readLabel = async (pg: Page) => {
  await settle(pg);
  return (await pg.evaluate(READ_LABEL)) as LabelSeen;
};
/** The name pill tucks its top 8 px under the avatar's bottom edge, centred, with the avatar stacked over it. */
function labelAsDrawn(s: LabelSeen) {
  expect(s).toEqual({ text: SHELL_TEXT.agent, overlaps: true, below: true, centred: true, avatarOnTop: true });
}

describe("[M29.3] the agent's name label", () => {

  it("planted: a label that does not tuck under the avatar fails the check", async () => {
    const w = authorityWorld();
    const html = swap(APP_PAGE, ".qf-side-av .nm{position:relative;z-index:0;margin-top:-8px;", ".qf-side-av .nm{position:relative;z-index:0;margin-top:0;");
    await on({ w, width: 390, height: 844, html }, async (pg) => {
      const s = await readLabel(pg);
      expect(s.overlaps).toBe(false);
      expect(() => labelAsDrawn(s)).toThrow();
    });
  }, 60_000);
});

// ---- (3) a chat row's time and kebab ----

interface RowSeen {
  endOpacity: string;
  time: string;
  timeShown: boolean;
  kebabShown: boolean;
  kebabGlyph: number;
}
const rowSel = (title: string) => `[...document.querySelectorAll("#chats [data-chat]")].find((r) => r.querySelector(".qf-lbl").textContent === ${JSON.stringify(title)})`;
const readRow = async (pg: Page, title: string) => {
  await settle(pg);
  return (await pg.evaluate(`(() => {
    const r = ${rowSel(title)}, end = r.querySelector(".qf-row-end"), t = end.querySelector(".qf-row-time"), k = end.querySelector("button");
    const shown = (e) => !!e && e.checkVisibility({ opacityProperty: true }) && e.getBoundingClientRect().width > 0;
    return { endOpacity: getComputedStyle(end).opacity, time: t.textContent, timeShown: shown(t) && t.textContent !== "", kebabShown: shown(k), kebabGlyph: k ? k.querySelector("svg").getBoundingClientRect().width : 0 };
  })()`)) as RowSeen;
};
async function hoverRow(pg: Page, title: string) {
  const b = await pg.evaluateHandle(`(${rowSel(title)}).querySelector(".qf-listrow")`);
  const box = await b.asElement()?.boundingBox();
  if (!box) throw new Error(`row ${title} is not drawn`);
  await pg.mouse.move(box.x + 20, box.y + box.height / 2);
}
const TRIP = "Trip planning";
/** Ada with a side chat she said something in at T0; Bo with one of his own. */
async function twoWithChats() {
  const w = authorityWorld();
  const a = await w.say(ada.email, "Plan the offsite.");
  await w.http(ada.email, "POST", `/app/chats/${a.chatId}/rename`, { title: TRIP });
  return { w, ada: a.chatId };
}
/** At rest nothing shows at the row's end; on hover the time and the kebab at the canvas's 16 px tier (M29.6). */
function hiddenAtRest(r: RowSeen) {
  expect([r.endOpacity, r.timeShown, r.kebabShown]).toEqual(["0", false, false]);
}

describe("[M29.3] a chat row's time and kebab", () => {

  it("the time reads Yesterday, the weekday within the week, and the date after that", async () => {
    const s = await twoWithChats();
    const DAY = 86400_000;
    for (const [now, label] of [[T0 + DAY, "Yesterday"], [T0 + 3 * DAY, "Tue"], [T0 + 10 * DAY, "Oct 13"]] as const)
      await on({ w: s.w, width: 1440, now }, async (pg) => {
        await hoverRow(pg, TRIP);
        expect((await readRow(pg, TRIP)).time).toBe(label);
      });
  }, 120_000);

  it("the Chat answers its time only to its owner: Bo asking for Ada's chat is refused", async () => {
    const s = await twoWithChats();
    const dir = (s.w.dir as unknown as { app: { chatLast(p: string, c: string): Promise<unknown> } }).app;
    expect(await dir.chatLast(ada.email, s.ada)).toEqual({ ok: true, at: T0 });
    // A time the Chat could not answer is drawn as none, with its code, never as some other time.
    const failing = { ...dir, chatLast: async () => { throw new Error("chat unreachable"); } };
    (s.w.dir as unknown as { app: unknown }).app = failing;
    const view = await s.w.http(ada.email, "GET", "/app/chats");
    expect((view.body.chats as Array<{ lastAt: unknown; lastCode?: string }>).map((c) => [c.lastAt, c.lastCode])).toEqual([[null, "APP_READ_FAILED"], [null, "APP_READ_FAILED"]]);
  }, 60_000);

  it("at 1440 the kebab opens a role=menu anchored under it, and the row's end stays shown while the menu is open; at 390 it is the sheet", async () => {
    const s = await twoWithChats();
    await on({ w: s.w, width: 1440 }, async (pg) => {
      await hoverRow(pg, TRIP);
      const kebab = await pg.evaluateHandle(`(${rowSel(TRIP)}).querySelector(".qf-row-end button")`);
      await kebab.asElement()?.click();
      const k = (await kebab.asElement()?.boundingBox()) as { x: number; y: number; width: number; height: number };
      await settle(pg);
      const m = await rect(pg, "#menu");
      expect([await pg.getAttribute("#menu", "role"), await pg.getAttribute("#menu", "data-form"), await visible(pg, "#menu")]).toEqual(["menu", "popover", true]);
      expect(await pg.evaluate('[...document.querySelectorAll("#menu > *")].map((n) => n.id)')).toEqual(["rename", "archive"]);
      anchoredUnder(m, k);
      await pg.mouse.move(900, 500);
      expect((await readRow(pg, TRIP)).kebabShown).toBe(true);
    });
    await on({ w: s.w, width: 390, height: 844 }, async (pg) => {
      await pg.click("#open-chats");
      await pg.evaluate(`(${rowSel(TRIP)}).querySelector(".qf-row-end button").click()`);
      expect([await pg.getAttribute("#menu", "data-form"), await pg.getAttribute("#menu", "class")]).toEqual(["sheet", "qf-menu qf-menu--sheet"]);
    });
  }, 120_000);

  it("planted: a row end that is always shown, and a kebab that opens a drawer at 1440, each fail the check", async () => {
    const s = await twoWithChats();
    const always = swap(APP_PAGE, ".qf-row-end{position:absolute;inset-block:0;inset-inline-end:4px;display:flex;align-items:center;gap:2px;opacity:0;pointer-events:none}", ".qf-row-end{position:absolute;inset-block:0;inset-inline-end:4px;display:flex;align-items:center;gap:2px}");
    await on({ w: s.w, width: 1440, html: always }, async (pg) => {
      await pg.mouse.move(900, 500);
      const r = await readRow(pg, TRIP);
      expect(() => hiddenAtRest(r)).toThrow();
    });
    const drawer = swap(APP_PAGE, 'sheet = device() === "phone"', "sheet = true");
    await on({ w: s.w, width: 1440, html: drawer }, async (pg) => {
      await hoverRow(pg, TRIP);
      const kebab = await pg.evaluateHandle(`(${rowSel(TRIP)}).querySelector(".qf-row-end button")`);
      await kebab.asElement()?.click();
      const k = (await kebab.asElement()?.boundingBox()) as { x: number; y: number; width: number; height: number };
      await settle(pg);
      const m = await rect(pg, "#menu");
      expect(() => anchoredUnder(m, k)).toThrow();
    });
  }, 120_000);
});
/** The menu hangs just under the kebab (within 12 px) and starts at or before its left edge, overlapping it. */
function anchoredUnder(m: { top: number; left: number; right: number } | null, k: { x: number; y: number; width: number; height: number }) {
  expect(m).not.toBeNull();
  const menu = m as { top: number; left: number; right: number };
  expect([menu.top >= k.y + k.height - 0.5 && menu.top - (k.y + k.height) <= 12, menu.left <= k.x + 0.5 && menu.right >= k.x + k.width]).toEqual([true, true]);
}

// ---- (4) the composer's footer ----

interface FootSeen {
  bg: string;
  bgPrimary: string;
  fullWidth: boolean;
  covered: boolean;
  underFoot: boolean;
  padTop: number;
  padBottom: number;
  rowGapTop: number;
  rowGapBottom: number;
  gutter: number;
}
/** Draws `n` agent messages, scrolls the thread so the last ones pass under the footer, and reads what is on top there. */
const READ_FOOT = `(() => {
  const foot = document.querySelector(".composerwrap"), f = document.getElementById("f"), row = f.querySelector(".composer-row"), stage = document.getElementById("chat");
  const probe = document.createElement("i"); probe.style.background = "var(--bg-primary)"; document.getElementById("app").append(probe);
  const bgPrimary = getComputedStyle(probe).backgroundColor; probe.remove();
  const fr = foot.getBoundingClientRect(), sr = stage.getBoundingClientRect(), pr = f.getBoundingClientRect(), rr = row.getBoundingClientRect();
  // A message under the footer band, at a point beside the pill (the band's own area, not the pill's).
  const msgs = [...document.querySelectorAll("#log > .m")];
  const under = msgs.find((m) => { const r = m.getBoundingClientRect(); return r.bottom > fr.top + 2 && r.top < fr.bottom - 2; });
  let covered = false;
  if (under) {
    const r = under.getBoundingClientRect(), y = Math.max(r.top, fr.top) + 1;
    const xs = [sr.left + 4, (pr.left + sr.left) / 2, pr.left - 2].filter((x) => x > sr.left && x < pr.left && x >= r.left && x <= r.right);
    const x = xs.length ? xs[0] : r.left + 2;
    const hit = document.elementFromPoint(x, y);
    covered = !!hit && foot.contains(hit) && !under.contains(hit);
  }
  const cs = getComputedStyle(f);
  return {
    bg: getComputedStyle(foot).backgroundColor, bgPrimary, fullWidth: Math.abs(fr.left - sr.left) <= 0.5 && Math.abs(fr.right - sr.right) <= 0.5,
    covered, underFoot: !!under,
    padTop: parseFloat(cs.paddingTop), padBottom: parseFloat(cs.paddingBottom),
    rowGapTop: Math.round(((([...f.children].find((c) => !c.hidden && c.getBoundingClientRect().height > 0) || row).getBoundingClientRect().top) - pr.top) * 2) / 2, rowGapBottom: Math.round((pr.bottom - rr.bottom) * 2) / 2,
    gutter: Math.round((fr.bottom - pr.bottom) * 2) / 2,
  };
})()`;
async function fillThread(pg: Page, n = 40) {
  await pg.evaluate(`(() => { for (let i = 0; i < ${n}; i++) add(i % 2 ? "you" : "agent", "Message " + i + " about the offsite agenda and who brings what."); const s = document.getElementById("chat-scroll"); s.scrollTop = -260; })()`);
}
const readFoot = async (pg: Page) => {
  await settle(pg);
  return (await pg.evaluate(READ_FOOT)) as FootSeen;
};
/** The footer band is bg-primary, opaque, the stage's width, and the thread's messages under it are hidden by it. */
function footAsDrawn(s: FootSeen) {
  expect([s.bg, s.fullWidth, s.underFoot, s.covered]).toEqual([s.bgPrimary, true, true, true]);
  expect(s.bgPrimary).toMatch(/^rgb\(/);
}
/** 12 px above the composer's first line (the chips when there are any, else the row) and 12 below its row. */
function evenPadding(s: FootSeen) {
  expect([s.padTop, s.padBottom, s.rowGapTop === s.rowGapBottom]).toEqual([12, 12, true]);
}

describe("[M29.3] the composer's footer", () => {
  it("the thread's last messages scroll under an opaque footer in bg-primary, the stage's width, 16 px under the pill, for Ada and Bo", async () => {
    const w = authorityWorld();
    for (const who of [ada.email])
      await on({ w, who, width: 1440 }, async (pg) => {
        await fillThread(pg);
        const s = await readFoot(pg);
        footAsDrawn(s);
        expect(s.gutter).toBe(16);
      });
    await on({ w, width: 390, height: 844 }, async (pg) => {
      await fillThread(pg);
      footAsDrawn(await readFoot(pg));
      // On a phone the band sits on the tab bar, 8 px under the pill.
      const [foot, tabs] = [await rect(pg, ".composerwrap"), await rect(pg, "#tabs")];
      expect(Math.abs((foot?.bottom ?? 0) - (tabs?.top ?? 0))).toBeLessThanOrEqual(0.5);
      expect((await readFoot(pg)).gutter).toBe(8);
    });
  }, 120_000);

  it("the composer pads its row 12 above and 12 below at one line and with an attachment chip stacked over it", async () => {
    const w = authorityWorld();
    await on({ w, width: 1440 }, async (pg) => {
      const one = await readFoot(pg);
      evenPadding(one);
      // 12 inside the pill's 1 px border: one line is 1 + 12 + 32 + 12 + 1 = 58.
      expect([one.rowGapTop, one.padTop]).toEqual([13, 12]);
      await pg.evaluate('(() => { const a = document.getElementById("attached"); const c = document.createElement("span"); c.className = "qf-chip chip"; c.textContent = "plan.pdf"; a.append(c); a.hidden = false; })()');
      evenPadding(await readFoot(pg));
    });
  }, 60_000);

  it("planted: master's floating composer lets the thread show beside the pill, and its padding is uneven; both checks fail", async () => {
    const w = authorityWorld();
    let html = swap(APP_PAGE, '<div class="composerwrap qf-composer-foot">', '<div class="composerwrap">');
    html = swap(html, ".composerwrap { flex-direction: column; align-items: center; gap: 8px; }", ".composerwrap { position: absolute; left: 16px; right: 16px; bottom: 16px; z-index: 15; display: flex; flex-direction: column; align-items: center; gap: 8px; pointer-events: none; }\n.composerwrap > * { pointer-events: auto; }");
    html = swap(html, "#f { max-width: 736px; }", "#f { flex-direction: column; align-items: stretch; gap: 0; max-width: 736px; }");
    html = swap(html, 'class="qf-composer qf-composer--stack"', 'class="qf-composer"');
    html = swap(html, 'id="attach" class="qf-ibtn qf-ibtn--32"', 'id="attach" class="qf-ibtn qf-ibtn--28"');
    await on({ w, width: 1440, html }, async (pg) => {
      await fillThread(pg);
      const s = await readFoot(pg);
      expect(s.covered).toBe(false);
      expect(() => footAsDrawn(s)).toThrow();
      expect(() => evenPadding(s)).toThrow();
    });
  }, 60_000);
});

// ---- (5) the Settings menu ----

interface MenuRowSeen {
  id: string;
  label: string;
  kbd: string;
  disabled: boolean;
  lead: number;
  offs: number[];
}
const READ_MENU = `(() => [...document.querySelectorAll("#menu > .qf-menu-item")].map((b) => {
  const r = b.getBoundingClientRect(), c = r.top + r.height / 2;
  const mid = (e) => { if (!e) return null; const x = e.getBoundingClientRect(); return x.top + x.height / 2 - c; };
  const lead = b.querySelector(".qf-menu-lead"), lbl = b.querySelector(".qf-lbl"), kbd = b.querySelector(".qf-kbd"), svg = lead && lead.querySelector("svg");
  return {
    id: b.id, label: lbl ? lbl.textContent : b.textContent, kbd: kbd ? kbd.textContent : "", disabled: b.disabled && b.getAttribute("aria-disabled") === "true",
    lead: lead ? lead.getBoundingClientRect().width : 0,
    offs: [mid(lead), mid(svg), mid(lbl), mid(kbd)].filter((v) => v !== null).map((v) => Math.round(v * 100) / 100),
  };
}))()`;
const readMenu = async (pg: Page) => {
  await settle(pg);
  return (await pg.evaluate(READ_MENU)) as MenuRowSeen[];
};
const ROWS = [
  ["settings-menu-keys", "Keyboard shortcuts", "⌘/", true],
  ["settings-menu-apps", "Download apps", "", true],
  ["settings-menu-report", SHELL_TEXT.report, "", false],
  ["settings-menu-open", SHELL_TEXT.settings, "⌘,", false],
];
/** The canvas's rows in order, the stubs disabled, and every row's lead box, glyph, label and shortcut on its centre line. */
function menuAsDrawn(rows: MenuRowSeen[]) {
  expect(rows.map((r) => [r.id, r.label, r.kbd, r.disabled])).toEqual(ROWS);
  for (const r of rows) {
    expect(r.lead, r.id).toBe(20);
    for (const o of r.offs) expect(Math.abs(o), `${r.id} off its centre line by ${o}`).toBeLessThanOrEqual(0.5);
  }
}

describe("[M29.3] the rail Settings menu", () => {
  it("its rows are the canvas's, Keyboard shortcuts and Download apps disabled stubs, each row's parts on one centre line within 0.5px, for Ada and Bo", async () => {
    const w = authorityWorld();
    expect(SETTINGS_MENU.map((r) => r.id)).toEqual(["settings-menu-keys", "settings-menu-apps", "settings-menu-report", "settings-menu-sep", "settings-menu-open"]);
    for (const who of [ada.email])
      await on({ w, who, width: 1440 }, async (pg) => {
        await pg.click("#to-settings");
        menuAsDrawn(await readMenu(pg));
        expect(await pg.evaluate('[...document.querySelectorAll("#menu > *")].map((n) => n.id)')).toEqual(SETTINGS_MENU.map((r) => r.id));
        // A stub does nothing: the menu stays and no dialog opens; Settings opens the dialog.
        await pg.click("#settings-menu-keys", { force: true });
        expect([await visible(pg, "#menu"), await visible(pg, "#set-dialog")]).toEqual([true, false]);
        await pg.click("#settings-menu-open");
        expect([await visible(pg, "#menu"), await visible(pg, "#set-dialog")]).toEqual([false, true]);
      });
  }, 120_000);

  it("planted: master's three rows, and rows whose parts are not centred, each fail the check", async () => {
    const w = authorityWorld();
    const master = swap(APP_PAGE, 'const SETTINGS_ROWS = ["settings-menu-keys","settings-menu-apps","settings-menu-report","settings-menu-sep","settings-menu-open"];', 'const SETTINGS_ROWS = ["settings-menu-report","settings-menu-sep","settings-menu-open"];');
    await on({ w, width: 1440, html: master }, async (pg) => {
      await pg.click("#to-settings");
      const rows = await readMenu(pg);
      expect(() => menuAsDrawn(rows)).toThrow();
    });
    const offLine = swap(APP_PAGE, ".qf-menu-item{display:flex;align-items:center;", ".qf-menu-item{display:flex;align-items:flex-start;");
    await on({ w, width: 1440, html: offLine }, async (pg) => {
      await pg.click("#to-settings");
      const rows = await readMenu(pg);
      expect(() => menuAsDrawn(rows)).toThrow();
    });
  }, 120_000);
});
