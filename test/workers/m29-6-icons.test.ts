
import { readFileSync, } from "node:fs";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { compileDesign, DS_TOKENS, ICO, icoGlyphs, TIERS } from "../../scripts/ds-tokens.ts";
import { DEFAULT_WEIGHT, GLYPH, ICON_CSS, ICON_NAMES, type IconName, ic, icActive, MIRRORED, TIERS as ICON_TIERS, type Weight } from "../../packages/agent/src/http/app/icons.ts";
import { BUNDLE_CSS, TOKENS_CSS } from "../../packages/agent/src/http/app/tokens.ts";
import { APP_PAGE, PAGE_CSS } from "../../packages/agent/src/http/page.ts";

const root = join(import.meta.dirname, "../..");
const BOARD = readFileSync(join(root, ICO), "utf8");

/** Swaps one exact piece of the board, and fails when the piece is not there (a plant that missed proves nothing). */
const plant = (from: string, to: string) => {
  expect(BOARD).toContain(from);
  return BOARD.replace(from, to);
};

/** The board's own render, run on props: its glyph id, path, size and transform, as the canvas draws them. */
const RENDER = (() => {
  const start = BOARD.indexOf("const R = ");
  const tf = BOARD.indexOf("tf: M.indexOf");
  const body = BOARD.slice(start, BOARD.indexOf("\n", tf)).replace(/this\.props/g, "P");
  return runInNewContext(`(P) => { ${body} }`, Object.create(null)) as (p: Record<string, unknown>) => { s: number; d: string; g: string; tf: string };
})();

/** What `ic()` draws: the glyph id, the path, the tier class and the transform. */
const drawn = (svg: string) => ({
  g: /data-glyph="([^"]+)"/.exec(svg)?.[1],
  d: / d="([^"]*)"/.exec(svg)?.[1],
  tier: /class="ico ico-([a-z0-9]+)/.exec(svg)?.[1],
  tf: / transform="([^"]+)"/.exec(svg)?.[1] ?? "",
});

describe("[M29.6] the compiler reads the Phosphor board", () => {
  it("reads every name's Regular, Bold and Fill cut, the defaults, the mirrored names and the five tiers", () => {
    const board = icoGlyphs(BOARD);
    expect(Object.keys(board.glyphs).length).toBeGreaterThan(80);
    expect(Object.values(board.glyphs).every((g) => g.r !== undefined || g.f !== undefined)).toBe(true);
    expect(Object.values(board.glyphs).filter((g) => g.b !== undefined).length).toBeGreaterThan(5);
    expect(Object.values(board.glyphs).filter((g) => g.f !== undefined).length).toBeGreaterThan(5);
    expect(board.tiers).toEqual({ "2xs": 12, xs: 16, sm: 20, md: 24, lg: 28 });
    expect(board.mirrored).toEqual(["panelr"]);
    expect([board.defaults.dots, board.defaults.x, board.defaults.plus]).toEqual(["b", "b", "r"]);
  });

  it("refuses a board it cannot read, each with its reason (DS_ICO_SHAPE)", () => {
    const board = icoGlyphs(BOARD);
    const noBold = Object.keys(board.glyphs).find((n) => board.glyphs[n]?.b === undefined && board.glyphs[n]?.r !== undefined) as string;
    const shape = (html: string) => () => icoGlyphs(html);
    // A path that is not one path's data (a script smuggled into a cut).
    expect(shape(plant("const R = {", 'const R = { zz: "M0 0Z<script>",'))).toThrow(/^DS_ICO_SHAPE: zz:r: .* is not one path's data$/);
    // A name that is not lower-case.
    expect(shape(plant("const R = {", 'const R = { "Big": "M0 0Z",'))).toThrow(/^DS_ICO_SHAPE: the glyph name "Big" is not a lower-case name$/);
    // W gives a default weight the glyph is not drawn in, or names no glyph.
    expect(shape(plant("const W = {", `const W = {"${noBold}": "b", `))).toThrow(new RegExp(`^DS_ICO_SHAPE: W gives ${noBold} the weight "b", which it is not drawn in$`));
    expect(shape(plant("const W = {", 'const W = {"nosuch": "r", '))).toThrow(/^DS_ICO_SHAPE: W gives nosuch a default weight, and the board has no glyph nosuch$/);
    // M names a glyph the board lacks.
    expect(shape(plant('const M = ["panelr"];', 'const M = ["nosuch"];'))).toThrow(/^DS_ICO_SHAPE: M is not a list of the board's glyph names$/);
    // T is not the five tiers, or a tier is not a size.
    expect(shape(plant("const T = { '2xs': 12, xs: 16, sm: 20, md: 24, lg: 28 };", "const T = { xs: 16, sm: 20, md: 24, lg: 28 };"))).toThrow(/^DS_ICO_SHAPE: T names the tiers \["xs","sm","md","lg"\], not \["2xs","xs","sm","md","lg"\]$/);
    expect(shape(plant("'2xs': 12,", "'2xs': 12.5,"))).toThrow(/^DS_ICO_SHAPE: T gives the tier 2xs 12.5, not a size in px$/);
    // A table that does not run, or no table at all.
    expect(shape(plant("const T = {", "const T = ({"))).toThrow(/^DS_ICO_SHAPE: the glyph table does not run: /);
    expect(shape(BOARD.replace("const R = ", "const Q = "))).toThrow(/^DS_ICO_SHAPE: Ico.dc.html has no glyph table/);
  });

  it("refuses a tier that is not its size-icon token: the board and the system say the same sizes", () => {
    const read = (ico: string) => (p: string) => (p === ICO ? Buffer.from(ico) : readFileSync(join(root, p)));
    expect(() => compileDesign(read(BOARD))).not.toThrow();
    expect(() => compileDesign(read(plant("md: 24,", "md: 26,")))).toThrow(/^DS_ICO_SHAPE: the tier md is 26px on the board and 24px as size-icon-md in tokens.json$/);
    const tokens = JSON.parse(readFileSync(join(root, DS_TOKENS), "utf8"));
    for (const k of TIERS) expect(JSON.stringify(tokens)).toContain(`"size-icon-${k}"`);
  });
});

describe("[M29.6] icons.ts is the board", () => {
  it("each name's cuts, default weight, mirror and tiers equal the board's", () => {
    const board = icoGlyphs(BOARD);
    expect(ICON_NAMES).toEqual(Object.keys(board.glyphs));
    for (const n of ICON_NAMES) expect(GLYPH[n], n).toEqual(board.glyphs[n]);
    expect(DEFAULT_WEIGHT).toEqual(board.defaults);
    expect(MIRRORED).toEqual(board.mirrored);
    expect(ICON_TIERS).toEqual(board.tiers);
  });

  it("ic() draws what the board's own render draws, for every name at rest, active and in each weight, on every tier", () => {
    const off: string[] = [];
    for (const n of ICON_NAMES)
      for (const o of [{}, { a: true }, { w: "r" }, { w: "b" }, { w: "f" }] as Array<{ a?: boolean; w?: Weight }>) {
        const want = RENDER({ n, a: o.a, w: o.w, s: "md" });
        const got = drawn(ic(n as IconName, "md", o));
        if (got.g !== want.g || got.d !== want.d || got.tf !== want.tf) off.push(`${n} ${JSON.stringify(o)}: ${got.g} vs ${want.g}`);
      }
    expect(off).toEqual([]);
    for (const t of TIERS) expect([drawn(ic("chat", t)).tier, RENDER({ n: "chat", s: t }).s]).toEqual([t, ICON_TIERS[t]]);
    // The mirrored name carries the board's transform; the 256 grid, the fill and no stroke are every glyph's (the
    // board's blank spacer draws an empty path).
    expect(ic("panelr", "md")).toContain(' transform="matrix(-1 0 0 1 256 0)"/>');
    for (const n of ICON_NAMES) expect(ic(n, "sm")).toMatch(/^<svg class="ico ico-sm" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true" data-glyph="[a-z0-9]+:[rbf]"><path d="[^"]*"( transform="[^"]+")?\/><\/svg>$/);
    const pageIcons = APP_PAGE.match(/<svg class="ico[^>]*>/g) ?? [];
    expect(pageIcons.length).toBeGreaterThan(50);
    expect(pageIcons.filter((t) => /stroke/.test(t))).toEqual([]);
  });

  it("an active place carries its resting cut and its Fill, the page showing the Fill only where the item is current", () => {
    const board = icoGlyphs(BOARD);
    const filled = ICON_NAMES.find((n) => board.glyphs[n]?.f !== undefined && board.glyphs[n]?.r !== undefined) as IconName;
    expect(icActive(filled, "lg")).toBe(`${ic(filled, "lg", { cls: "ico-rest" })}${ic(filled, "lg", { a: true, cls: "ico-act" })}`);
    expect(drawn(ic(filled, "lg", { a: true })).g).toBe(`${filled}:f`);
    expect(APP_PAGE).toContain('.ico-act, [aria-current="page"] .ico-rest { display: none; }');
    expect(APP_PAGE).toContain('[aria-current="page"] .ico-act { display: block; }');
    // Each tier's class is sized by its token, never a number.
    for (const t of TIERS) expect(ICON_CSS).toContain(`.ico-${t}{width:var(--size-icon-${t});height:var(--size-icon-${t})}`);
  });
});

/** The app's own CSS: the page's styles after the system's tokens and bundle, and every inline style in its markup and scripts. */
const APP_CSS = PAGE_CSS.slice(TOKENS_CSS.length + BUNDLE_CSS.length);
const INLINE = [...APP_PAGE.replace(/<style>[\s\S]*?<\/style>/, "").matchAll(/style="([^"]*)"|\.style\.[a-zA-Z]+\s*=\s*"([^"]*)"|setAttribute\("style",\s*"([^"]*)"/g)].map((m) => m[1] ?? m[2] ?? m[3]).join("\n");

/** Each literal the app's CSS must not carry: a duration, an easing, an icon's size. */
function literals(css: string): string[] {
  const at = (re: RegExp, what: string) => [...css.matchAll(re)].map((m) => `${what}: ${css.slice(Math.max(0, (m.index as number) - 40), (m.index as number) + 30).replace(/\s+/g, " ")}`);
  return [
    ...at(/(?<![\w.-])\d*\.?\d+m?s(?![\w-])/g, "duration"),
    ...at(/cubic-bezier\(|steps\(|(?<![\w-])(ease|ease-in|ease-out|ease-in-out|linear)(?![\w-])/g, "easing"),
    ...at(/(?:\.ico|svg|\.qf-ico\d*)\b[^{}]*\{[^}]*\b(?:width|height)\s*:\s*\d/g, "icon size"),
    ...at(/\bico-s\d+\b/g, "icon size"),
  ];
}

describe("[M29.6] the app's CSS names the system's motion and sizes", () => {
  it("no literal duration, easing or icon size in the app's styles, inline styles or scripts", () => {
    expect(APP_CSS.length).toBeGreaterThan(5000);
    expect(literals(APP_CSS)).toEqual([]);
    expect(literals(INLINE)).toEqual([]);
    // What it uses instead: the bundle's motion tokens and the tier classes.
    expect(APP_CSS).toContain("var(--qf-dur-");
    expect(APP_PAGE).toMatch(/class="ico ico-(2xs|xs|sm|md|lg)/);
  });
});
