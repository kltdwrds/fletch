// M29.6: the system's motion in the app (design review 1, I3). Motion is a browser's question, so each claim runs the
// shipped page in hermetic Chromium, every request answered by the authority world's routes as Ada or Bo of solo-sam
// and every socket held in the test. For the phone's panel sheet, the Settings dialog, the rail's Settings menu and the
// phone's chats drawer: opening runs the bundle's enter keyframes at its token durations; closing marks .is-closing,
// runs the exit, and only then hides the node and gives it back; under reduced motion each is instant or a plain fade.
// Opens and closes are driven inside the page so each read is taken in the same task as the action. The hide-after-exit
// claim is planted against master's behaviour: the page served with every exit made immediate must fail it.
import { type Browser, chromium, type Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { APP_PAGE } from "../../packages/agent/src/http/page.ts";
import { ada, authorityWorld } from "./support/authority-world.ts";
import { SETTLED } from "./support/motion.ts";
import { servePages } from "./support/page-routes.ts";

let browser: Browser;
const w = authorityWorld({ script: [] });
beforeAll(async () => {
  browser = await chromium.launch({ channel: "chromium", headless: true });
});
afterAll(async () => {
  await browser?.close();
});

interface On {
  who: string;
  width: number;
  height: number;
  reduce?: boolean;
  html?: string;
}
async function on<T>(o: On, fn: (pg: Page) => Promise<T>): Promise<T> {
  const ctx = await browser.newContext({ viewport: { width: o.width, height: o.height }, colorScheme: "dark", serviceWorkers: "block", reducedMotion: o.reduce ? "reduce" : "no-preference", hasTouch: o.width < 768 });
  try {
    await ctx.routeWebSocket(/.*/, () => {});
    await servePages(ctx, (m, p, b) => w.http(o.who, m, p, b), o.html ?? APP_PAGE);
    const pg = await ctx.newPage();
    await pg.goto("https://solo-sam.example/");
    await pg.waitForFunction('document.querySelectorAll("#chats [data-chat]").length >= 1');
    await pg.evaluate(SETTLED);
    return await fn(pg);
  } finally {
    await ctx.close();
  }
}

/** One overlay: how the page opens and closes it, the node that is hidden after, and the elements whose motion is read. */
interface Surface {
  name: string;
  width: number;
  height: number;
  open: string;
  close: string;
  node: string;
  read: string[];
}
const SURFACES: Surface[] = [
  { name: "the panel sheet", width: 390, height: 844, open: 'document.getElementById("open-agent").click()', close: ESC(), node: "#panel-dialog", read: ["#scrim", "#panel-dialog"] },
  { name: "the Settings dialog", width: 1440, height: 900, open: 'document.getElementById("to-settings").click(); document.getElementById("settings-menu-open").click()', close: ESC(), node: "#set-dialog", read: ["#scrim", "#set-dialog"] },
  { name: "the rail's Settings menu", width: 1440, height: 900, open: 'document.getElementById("to-settings").click()', close: 'document.getElementById("menu-backdrop").click()', node: "#menu", read: ["#menu"] },
  { name: "the chats drawer", width: 390, height: 844, open: 'document.getElementById("open-chats").click()', close: ESC(), node: "#drawer", read: ["#scrim > .qf-drawer-scrim", "#drawer"] },
];
function ESC() {
  return 'document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))';
}

type Motion = Record<string, Array<[string, number]>>;
/** The running CSS animations on each read element: keyframes name and duration in ms. */
const MOTION = (read: string[]) =>
  `Object.fromEntries(${JSON.stringify(read)}.map((s) => { const e = document.querySelector(s); return [s, e ? e.getAnimations().filter((a) => a.animationName).map((a) => [a.animationName, a.effect.getTiming().duration]) : null]; }))`;

/** Opens the surface and reads its enter motion in the same task. */
const openAndRead = (pg: Page, s: Surface) => pg.evaluate(`(() => { ${s.open}; return ${MOTION(s.read)}; })()`) as Promise<Motion>;

interface Closed {
  /** The node was hidden by the close itself, before any exit ran. */
  hiddenAtOnce: boolean;
  closing: string[];
  motion: Motion;
}
/** Closes the surface, reads its exit in the same task, and watches for the node's hide. */
const closeAndRead = (pg: Page, s: Surface) =>
  pg.evaluate(`(() => {
    const n = document.querySelector(${JSON.stringify(s.node)}); window.__hid = null; const t0 = performance.now();
    new MutationObserver(() => { if (n.hidden && window.__hid === null) window.__hid = performance.now() - t0; }).observe(n, { attributes: true, attributeFilter: ["hidden"] });
    ${s.close};
    if (n.hidden) window.__hid = 0;
    return { hiddenAtOnce: n.hidden, closing: [...document.querySelectorAll(".is-closing")].map((e) => e.id || e.className.split(" ")[0]), motion: ${MOTION(s.read)} };
  })()`) as Promise<Closed>;
/** How long after the close the node was hidden, in ms, and where it went. */
async function hideTime(pg: Page, s: Surface) {
  await pg.waitForFunction("window.__hid !== null", null, { timeout: 5000 });
  await pg.evaluate(SETTLED);
  return {
    ms: (await pg.evaluate("window.__hid")) as number,
    left: (await pg.evaluate(`[document.querySelectorAll(".is-closing").length, document.querySelector(${JSON.stringify(s.node)}).parentElement.id]`)) as [number, string],
  };
}

/** The expected keyframes and durations per surface, from the bundle's rules and tokens. */
const ENTER: Record<string, Motion> = {
  "the panel sheet": { "#scrim": [["qf-scrim-in", 150]], "#panel-dialog": [["qf-sheet-in", 500]] },
  "the Settings dialog": { "#scrim": [["qf-scrim-in", 1000]], "#set-dialog": [["qf-pop-in", 150]] },
  "the rail's Settings menu": { "#menu": [["qf-menu-in", 150]] },
  "the chats drawer": { "#scrim > .qf-drawer-scrim": [["qf-scrim-in", 150]], "#drawer": [["qf-drawer-in", 500]] },
};
const EXIT: Record<string, { motion: Motion; closing: string[]; hideAfter: number; home: string }> = {
  "the panel sheet": { motion: { "#scrim": [["qf-scrim-out", 150]], "#panel-dialog": [["qf-sheet-out", 300]] }, closing: ["scrim"], hideAfter: 300, home: "overlays" },
  // F3: a dialog's scrim leaves with its card, both at --qf-dur-fast (it enters over 1 s, as above).
  "the Settings dialog": { motion: { "#scrim": [["qf-scrim-out", 150]], "#set-dialog": [["qf-pop-out", 150]] }, closing: ["scrim"], hideAfter: 150, home: "overlays" },
  "the rail's Settings menu": { motion: { "#menu": [["qf-menu-out", 150]] }, closing: ["menu-layer", "menu"], hideAfter: 150, home: "menu-layer" },
  "the chats drawer": { motion: { "#scrim > .qf-drawer-scrim": [["qf-scrim-out", 150]], "#drawer": [["qf-drawer-out", 300]] }, closing: ["scrim", "drawer"], hideAfter: 300, home: "" },
};

describe("[M29.6] overlays enter and leave with the system's motion", () => {
  for (const s of SURFACES)
    it(`${s.name}: the enter keyframes at their token durations; the close marks .is-closing, runs the exit, and only then hides the node and gives it back, for Ada and Bo`, async () => {
      for (const who of [ada.email])
        await on({ who, width: s.width, height: s.height }, async (pg) => {
          expect(await openAndRead(pg, s), "enter").toEqual(ENTER[s.name]);
          await pg.evaluate(SETTLED);
          const want = EXIT[s.name] as (typeof EXIT)[string];
          const closed = await closeAndRead(pg, s);
          expect({ hiddenAtOnce: closed.hiddenAtOnce, closing: closed.closing.sort(), motion: closed.motion }, "exit").toEqual({ hiddenAtOnce: false, closing: [...want.closing].sort(), motion: want.motion });
          const after = await hideTime(pg, s);
          expect(after.ms, "hidden only after the exit").toBeGreaterThanOrEqual(want.hideAfter * 0.9);
          expect(after.left[0], "no .is-closing is left").toBe(0);
          if (want.home) expect(after.left[1], "given back").toBe(want.home);
        });
    }, 120_000);

  it("planted: with every exit made immediate (master's behaviour), the node is hidden by the close itself and the check fails", async () => {
    const from = "if (!anims.length) return finish();";
    expect(APP_PAGE).toContain(from);
    const html = APP_PAGE.replace(from, "return finish();");
    for (const s of SURFACES)
      await on({ who: ada.email, width: s.width, height: s.height, html }, async (pg) => {
        await openAndRead(pg, s);
        await pg.evaluate(SETTLED);
        const closed = await closeAndRead(pg, s);
        expect(closed.hiddenAtOnce, `${s.name} on the plant`).toBe(true);
        expect((await hideTime(pg, s)).ms).toBeLessThan((EXIT[s.name]?.hideAfter ?? 0) * 0.9);
      });
  }, 120_000);
});

describe("[M29.6] under reduced motion each is instant or a plain fade", () => {
  /** At reduced motion: what still runs on open, and whether the close waits. */
  const REDUCED: Record<string, { enter: Motion; hidesAtOnce: boolean }> = {
    // Off: sheets, their veils, drawers and dialog cards. Kept: the dialog scrim's fade and a Menu's fade (its nudge and
    // scale zeroed by the app, so the bundle's keyframes are opacity only).
    "the panel sheet": { enter: { "#scrim": [], "#panel-dialog": [] }, hidesAtOnce: true },
    "the Settings dialog": { enter: { "#scrim": [["qf-scrim-in", 1000]], "#set-dialog": [] }, hidesAtOnce: false },
    "the rail's Settings menu": { enter: { "#menu": [["qf-menu-in", 150]] }, hidesAtOnce: false },
    "the chats drawer": { enter: { "#scrim > .qf-drawer-scrim": [], "#drawer": [] }, hidesAtOnce: true },
  };
  for (const s of SURFACES)
    it(`${s.name}`, async () => {
      const want = REDUCED[s.name] as (typeof REDUCED)[string];
      await on({ who: ada.email, width: s.width, height: s.height, reduce: true }, async (pg) => {
        expect(await openAndRead(pg, s)).toEqual(want.enter);
        // What is kept is a plain fade: at its first frame the element is see-through and not moved or scaled.
        const first = (await pg.evaluate(`[...document.querySelectorAll(${JSON.stringify(s.read.join(","))})].flatMap((e) => e.getAnimations().map((a) => { a.pause(); a.currentTime = 0; const c = getComputedStyle(e); const r = [e.id || e.className, c.transform, c.opacity]; a.play(); return r; }))`)) as Array<[string, string, string]>;
        for (const [who, transform] of first) expect(["none", "matrix(1, 0, 0, 1, 0, 0)"], `${s.name} ${who}`).toContain(transform);
        await pg.evaluate(SETTLED);
        const closed = await closeAndRead(pg, s);
        expect(closed.hiddenAtOnce, "hidden at once").toBe(want.hidesAtOnce);
        // A closing dialog card is hidden at once even while its scrim fades.
        if (s.name === "the Settings dialog") expect(await pg.evaluate('getComputedStyle(document.getElementById("set-dialog")).visibility')).toBe("hidden");
        await hideTime(pg, s);
      });
    }, 60_000);

  it("contrast: without reduced motion the Menu's first frame is nudged and scaled, so the plain-fade check above has teeth", async () => {
    const s = SURFACES[2] as Surface;
    await on({ who: ada.email, width: s.width, height: s.height }, async (pg) => {
      await openAndRead(pg, s);
      const t = (await pg.evaluate('(() => { const e = document.getElementById("menu"); const a = e.getAnimations()[0]; a.pause(); a.currentTime = 0; return getComputedStyle(e).transform; })()')) as string;
      expect(["none", "matrix(1, 0, 0, 1, 0, 0)"]).not.toContain(t);
    });
  }, 60_000);
});
