// M29.1: the code bugs of Fletch design review 1 (`proposals/2026-10-19-fletch-design-review-1.md`, rows A1, C1, E1
// and B1). The DOM claims run the shipped script under the page harness, its requests going to the agent script's
// real `route` as Ada or Bo of solo-sam; each guard is planted on the production path by rewriting the shipped
// script, and the planted page must fail the same check. Layout (an svg centred in its button, the drawer's "+" clear
// of the list options) needs a browser: the same page in hermetic Chromium, every request answered by the world's
// routes and every socket held in the test, at 390 and 1440.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type Browser, chromium, type Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ICO, icoGlyphs } from "../../scripts/ds-tokens.ts";
import { CHATS_TEXT } from "../../packages/agent/src/http/app/chats-list.ts";
import { LIBRARY_TEXT } from "../../packages/agent/src/http/app/library.ts";
import { SETTINGS_MENU, SHELL_TEXT } from "../../packages/agent/src/http/app/shell.ts";
import { APP_PAGE } from "../../packages/agent/src/http/page.ts";
import { ada, authorityWorld } from "./support/authority-world.ts";
import { type El, page } from "./support/page-harness.ts";

const root = join(import.meta.dirname, "../..");
const settle = async () => {
  for (let i = 0; i < 40; i++) await new Promise((r) => setImmediate(r));
};
type World = ReturnType<typeof authorityWorld>;
type Layout = NonNullable<Parameters<typeof page>[1]>;

/** A person's page whose requests go to the world's real routes as that person; `plant` rewrites the shipped script. */
async function pageOf(w: World, person: string, layout: Layout = {}, plant?: (js: string) => string) {
  const p = await page(
    {
      onSend() {},
      fetch: async (path, init) => {
        const r = await w.http(person, init?.method ?? "GET", path, init?.body ? JSON.parse(init.body) : undefined);
        return new Response(JSON.stringify(r.body), { status: r.status });
      },
    },
    layout,
    plant,
  );
  await settle();
  return p;
}
/** Swaps one exact piece of the shipped script, and fails when the piece is not there (a plant that missed proves nothing). */
const swap = (from: string, to: string) => (js: string) => {
  expect(js).toContain(from);
  return js.replace(from, to);
};

/** `#shell`'s element children as the markup writes them. */
const MARKUP_ORDER = (() => {
  const at = APP_PAGE.indexOf('<div id="shell"');
  const shell = APP_PAGE.slice(at, APP_PAGE.indexOf('<nav id="tabs"', at));
  return [...shell.matchAll(/\n<(?:nav|aside|div) id="([^"]+)"/g)].map((m) => m[1]);
})();
const order = (p: { byId(id: string): El }) => p.byId("shell").children.map((c) => c.id);

/**
 * Opens the phone's drawer, closes it, then widens through 768, 1024 and 1440; the shell's order after each step. The
 * page has no 1280 rule since M29.2 (the panel pins from 768), so 1440 is the desktop's bucket again.
 */
async function drawerThenWiden(p: Awaited<ReturnType<typeof pageOf>>) {
  const seen: string[][] = [];
  await p.byId("open-chats").onclick?.();
  expect(p.byId("drawer").parent?.id).toBe("scrim");
  await p.byId("close-drawer").onclick?.();
  seen.push(order(p));
  p.resize({ tablet: true });
  seen.push(order(p));
  p.resize({ desktop: true });
  seen.push(order(p));
  p.resize({ desktop: true });
  seen.push(order(p));
  return seen;
}

describe("[M29.1] the chats column goes back to its place", () => {
  it("the drawer opened at 390, closed and then widened to 768, 1024 and 1440 leaves #shell's children in the markup's order, for Ada and Bo", async () => {
    expect(MARKUP_ORDER).toEqual(["rail", "drawer", "lib-col", "stage", "panel-pin"]);
    const w = authorityWorld();
    for (const who of [ada.email]) {
      const p = await pageOf(w, who);
      expect(order(p)).toEqual(MARKUP_ORDER);
      expect(await drawerThenWiden(p)).toEqual([MARKUP_ORDER, MARKUP_ORDER, MARKUP_ORDER, MARKUP_ORDER]);
      // From 768 the column is the list column again, beside the rail and before the stage.
      expect([p.byId("drawer").className, p.byId("drawer").hidden]).toEqual(["qf-listcol qf-listcol--chat", false]);
    }
  });

  it("a width change that closes the open drawer puts it back in place too, and the panel and a menu's items go home in their order", async () => {
    const w = authorityWorld();
    const p = await pageOf(w, ada.email);
    await p.byId("open-chats").onclick?.();
    p.resize({ tablet: true });
    expect([p.byId("drawer").parent?.id, order(p)]).toEqual(["shell", MARKUP_ORDER]);
    // The panel borrows #panel into its dialog on a phone (M29.2: it pins from 768) and gives it back to the pinned column.
    const pin = p.byId("panel-pin").children.map((c) => c.id);
    p.resize({});
    await p.byId("open-agent").onclick?.();
    expect(p.byId("panel").parent?.id).toBe("panel-dialog");
    p.key("Escape");
    expect(p.byId("panel-pin").children.map((c) => c.id)).toEqual(pin);
    // The rail's Settings menu borrows its static rows from #menu-home and returns them where they stood.
    const home = p.byId("menu-home").children.map((c) => c.id);
    await p.byId("to-settings").onclick?.();
    expect(p.byId("menu").children.map((c) => c.id)).toEqual(SETTINGS_MENU.map((r) => r.id));
    p.key("Escape");
    expect(p.byId("menu-home").children.map((c) => c.id)).toEqual(home);
  });

  it("planted: the old append puts the drawer after the stage and the panel's column, and the check fails", async () => {
    const w = authorityWorld();
    const p = await pageOf(w, ada.email, {}, swap("h.parent.insertBefore(node, h.next)", "h.parent.append(node)"));
    const seen = await drawerThenWiden(p);
    expect(seen.at(-1)).toEqual(["rail", "lib-col", "stage", "panel-pin", "drawer"]);
    expect(seen.at(-1)).not.toEqual(MARKUP_ORDER);
  });
});

/** The list's head as drawn: its text and the ids of what it holds. */
const listHead = (p: { byId(id: string): El }) => {
  const head = p.byId("chats").children.find((c) => c.className === "qf-listhead") as El;
  return { text: head.text(), holds: head.children.filter((c) => c.id).map((c) => c.id) };
};

describe("[M29.1] Side chats and its +", () => {

  it("planted: looking the + up after the list is cleared writes Side chats null and loses the +", async () => {
    const w = authorityWorld();
    const p = await pageOf(w, ada.email, {}, swap("head.append(NEW_CHAT)", 'head.append($("new-chat"))'));
    // The draw clears the list, which held the markup's button, before it asks the document for it.
    expect(listHead(p)).toEqual({ text: "Side chats null", holds: [] });
    expect(listHead(p).text).not.toBe(CHATS_TEXT.side);
  });

  it("the phone drawer's rules no longer lift the + out of the head onto the list options", () => {
    expect(APP_PAGE).not.toMatch(/#new-chat\s*\{[^}]*position:\s*absolute/);
    expect(APP_PAGE).not.toMatch(/\.drawer-sheet \.drawer-top\s*\{\s*padding-right/);
  });
});

describe("[M29.1] no header More", () => {
  it("the page has no element #more and no Compact this chat, for Ada and Bo, and the header keeps its other controls", async () => {
    expect(APP_PAGE).not.toMatch(/\sid="more"/);
    expect(APP_PAGE).not.toContain("Compact this chat");
    expect(APP_PAGE).not.toMatch(/chat-compact|chat-more|COMPACT\b/);
    expect(SHELL_TEXT).not.toHaveProperty("chatOptions");
    const w = authorityWorld();
    for (const who of [ada.email]) {
      const p = await pageOf(w, who, { desktop: true });
      // With the pinned panel closed (M29.2), so the header's avatar shows.
      await p.byId("close-sheet").onclick?.();
      const shown = ["open-chats", "chats-pill", "open-agent", "head-invite"].filter((id) => !p.byId(id).hidden);
      expect(shown).toEqual(who === ada.email ? ["open-chats", "chats-pill", "open-agent", "head-invite"] : ["open-chats", "chats-pill", "open-agent"]);
      expect(p.byId("head-in").children.flatMap((c) => [c.id, ...c.children.map((d) => d.id)])).not.toContain("more");
    }
  });
});

// ---- the browser: the same page in hermetic Chromium ----

/** The board's size tiers in px (M29.6): the canvas and the app both name a tier, and this says what it draws at. */
const TIER_PX = icoGlyphs(readFileSync(join(root, ICO), "utf8")).tiers;

interface Btn {
  label: string;
  shown: boolean;
  /** Element children between the button and its glyph: none when the svg is a direct child. */
  wrapped: string[];
  svgs: number;
  dx: number;
  dy: number;
  /** The glyph's drawn width, or its class's size when the button is not shown. */
  size: number;
}

/**
 * Reads every `.qf-ibtn` on the page: its glyph's place, its centre against the button's and its size (drawn, or its
 * tier class's px when hidden; 0 when it has neither, which no canvas row allows). Browser code is a
 * string, as design-screens writes it: the agent package's types carry no DOM.
 */
const READ_BUTTONS = `[...document.querySelectorAll(".qf-ibtn")].map((b) => {
  const svgs = [...b.querySelectorAll("svg")], s = svgs[0];
  const br = b.getBoundingClientRect(), sr = s && s.getBoundingClientRect();
  const shown = !!s && br.width > 0 && sr.width > 0;
  const cls = /\\bico-(2xs|xs|sm|md|lg)\\b/.exec((s && s.getAttribute("class")) || "");
  return {
    label: b.getAttribute("aria-label") || "",
    shown,
    wrapped: svgs.filter((x) => x.parentElement !== b).map((x) => x.parentElement.tagName.toLowerCase()),
    svgs: svgs.length,
    dx: shown ? sr.left + sr.width / 2 - (br.left + br.width / 2) : 0,
    dy: shown ? sr.top + sr.height / 2 - (br.top + br.height / 2) : 0,
    size: shown ? sr.width : cls ? ${JSON.stringify(TIER_PX)}[cls[1]] : 0,
  };
})`;
const readButtons = (pg: Page) => pg.evaluate(READ_BUTTONS) as Promise<Btn[]>;

describe("[M29.1] icon buttons in a browser", () => {
  let browser: Browser;
  const w = authorityWorld();
  beforeAll(async () => {
    browser = await chromium.launch({ channel: "chromium", headless: true });
    // Two side chats so the rows draw their kebabs.
    await w.http(ada.email, "POST", "/app/chats", {});
    await w.http(ada.email, "POST", "/app/chats", {});
  }, 120_000);
  afterAll(async () => {
    await browser?.close();
  });

  /** Ada's page at a width: the page and every request it makes answered by the world's routes, sockets held here. */
  async function open(width: number, height: number) {
    const ctx = await browser.newContext({ viewport: { width, height }, serviceWorkers: "block" });
    await ctx.routeWebSocket(/.*/, () => {});
    await ctx.route("**/*", async (r) => {
      const url = new URL(r.request().url());
      if (url.origin !== "https://solo-sam.example") return r.abort();
      if (url.pathname === "/") return r.fulfill({ status: 200, contentType: "text/html", body: APP_PAGE });
      const body = r.request().postData();
      const a = await w.http(ada.email, r.request().method(), url.pathname + url.search, body ? JSON.parse(body) : undefined);
      return r.fulfill({ status: a.status, contentType: "application/json", body: JSON.stringify(a.body) });
    });
    const pg = await ctx.newPage();
    await pg.goto("https://solo-sam.example/");
    await pg.waitForFunction('document.querySelectorAll("#chats [data-chat]").length === 3');
    return { pg, close: () => ctx.close() };
  }
  /** The buttons on each surface the claim names at a width: the chat, the drawer (phone), the Library, the archived view. */
  async function sweep(width: number, height: number) {
    const { pg, close } = await open(width, height);
    try {
      const seen: Btn[] = [];
      seen.push(...(await readButtons(pg)));
      if (width < 768) {
        await pg.click("#open-chats");
        seen.push(...(await readButtons(pg)));
        const plus = await pg.locator("#new-chat").boundingBox();
        const opts = await pg.locator("#archived-btn").boundingBox();
        const head = await pg.locator("#chats .qf-listhead").boundingBox();
        await pg.keyboard.press("Escape");
        if (!plus || !opts || !head) throw new Error("the drawer's + or list options are not drawn");
        const apart = plus.x >= opts.x + opts.width || opts.x >= plus.x + plus.width || plus.y >= opts.y + opts.height || opts.y >= plus.y + plus.height;
        expect(apart).toBe(true);
        expect(plus.y >= head.y && plus.y + plus.height <= head.y + head.height).toBe(true);
      } else if (width < 1024) {
        // From 768 to 1023 the list is the Chats pill's overlay (M29.2), so its rows are read there.
        await pg.click("#chats-pill");
        seen.push(...(await readButtons(pg)));
        await pg.keyboard.press("Escape");
      }
      await pg.click(width < 768 ? "#to-library" : "#rail-library");
      // The Library is drawn once its list is read: the note says it is reading until then.
      await pg.waitForFunction('!document.getElementById("library").hidden && document.getElementById("lib-note").textContent === ""');
      seen.push(...(await readButtons(pg)));
      return seen;
    } finally {
      await close();
    }
  }

  for (const [width, height] of [
    [390, 844],
    [1440, 900],
  ] as const) {
    it(`no .qf-ibtn has a wrapper element between it and its svg, and every shown svg is centred in its button within 0.5px at ${width}`, async () => {
      const seen = await sweep(width, height);
      expect(seen.filter((b) => b.svgs !== 1).map((b) => `${b.label}: ${b.svgs} svgs`)).toEqual([]);
      expect(seen.filter((b) => b.wrapped.length).map((b) => `${b.label}: ${b.wrapped.join(",")}`)).toEqual([]);
      const shown = seen.filter((b) => b.shown);
      expect(shown.length).toBeGreaterThan(5);
      expect(shown.filter((b) => Math.abs(b.dx) > 0.5 || Math.abs(b.dy) > 0.5).map((b) => `${b.label}: ${b.dx.toFixed(2)},${b.dy.toFixed(2)}`)).toEqual([]);
    }, 120_000);
  }

  it("the Library's options are two buttons, Artifact options (dots 24) on a phone and Sort artifacts (sort 24) from 768; the + circle is 24 and the chat-row kebab 16, the canvas's md and xs tiers", async () => {
    const at = async (width: number, height: number) => {
      const seen = await sweep(width, height);
      const of = (label: string) => seen.filter((b) => b.label === label && b.shown).map((b) => b.size);
      return { options: of(LIBRARY_TEXT.options), sort: of(LIBRARY_TEXT.sort), create: of(LIBRARY_TEXT.create), kebab: [...new Set(of(CHATS_TEXT.options))] };
    };
    expect(await at(390, 844)).toEqual({ options: [24], sort: [], create: [24], kebab: [16] });
    expect(await at(768, 1024)).toEqual({ options: [], sort: [24], create: [24], kebab: [16] });
    expect(await at(1440, 900)).toEqual({ options: [], sort: [24], create: [], kebab: [16] });
  }, 180_000);
});
