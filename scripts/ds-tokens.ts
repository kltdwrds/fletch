// `pnpm ds` (M26.1, rewritten for the Fletch system in M27.1): the design system's compiler. It reads
// `packages/agent/src/design/fletch/ds/tokens.json` (the Design System artifact's file, verbatim),
// `ds/components/bundle.css` and the canvas's glyph set `fletch/prototype/Ico.dc.html`, and writes two modules:
//
// - `packages/agent/src/http/app/tokens.ts`: `TOKENS_CSS`, the page's custom properties in the canvas's own form
//   (`:root,[data-theme=light]` with every colour's light value, the palette, spacing, radius, shadow, blur,
//   z-index and the four families as the tokens write them; `[data-theme=dark]` with each themed colour's dark
//   value), equal to `fletch/prototype/ds/qyvr-fletch/tokens.css` after whitespace, so the page paints from the
//   sheet the boards do; `BUNDLE_CSS`, bundle.css as it is; `TOKEN_NAMES`; and `TYPE_ROLES`, the canvas's `.t-*`
//   type classes by the tokens.json style each one draws.
// - `packages/agent/src/http/app/icons.ts`: `GLYPH`, each `Ico` name's one filled path per weight (Phosphor's
//   Regular, Bold, Fill on the 256 grid), the default weights, the mirrored names, the size tiers (each equal to its
//   `size-icon-*` token), `ICON_CSS`, and `ic(name, tier, {w, a})`.
//
// The `.t-*` rules themselves are the bundle's (it carries them, so the page does not add a second copy); the
// compiler holds the class → style table and refuses a bundle rule whose size, line height or weight is not its
// style's, or a type class the table does not name. Fonts are the stack as the tokens write it: nothing is
// shipped or fetched (Q-M27-1).
//
// The outputs are a function of the inputs only, so `--check` (the pre-commit hook and the M27.1 test) can say
// whether the checked-in files are a fresh run. A shape the compiler does not know is refused with the token's
// name, never skipped.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runInNewContext } from "node:vm";

export const DS_DIR = "packages/agent/src/design/fletch/ds";
export const DS_TOKENS = `${DS_DIR}/tokens.json`;
export const DS_BUNDLE = `${DS_DIR}/components/bundle.css`;
export const ICO = "packages/agent/src/design/fletch/prototype/Ico.dc.html";
/** The canvas's compiled sheet: what `TOKENS_CSS` must equal. */
export const CANVAS_TOKENS_CSS = "packages/agent/src/design/fletch/prototype/ds/qyvr-fletch/tokens.css";
export const TOKENS_OUT = "packages/agent/src/http/app/tokens.ts";
export const ICONS_OUT = "packages/agent/src/http/app/icons.ts";
/** The generated files, each checked against a fresh run. */
export const DS_OUTPUTS = [TOKENS_OUT, ICONS_OUT];
/** Every file the outputs depend on, relative to the repository root: what the hook watches. */
export const DS_INPUTS = [DS_TOKENS, DS_BUNDLE, ICO];

/**
 * The canvas's type classes (bundle.css and the boards' markup) by the tokens.json style each draws. The canvas
 * names a subset of the 29 styles; a style no class names is a token the parts may add a class for, through the
 * system, when a board draws it.
 */
export const TYPE_ROLES: Readonly<Record<string, string>> = {
  "t-title-lg": "title-lg-3-emphasized",
  "t-title-3-e": "title-3-emphasized",
  "t-title-3-m": "title-3-medium",
  "t-body": "body",
  "t-body-m": "body-medium",
  "t-body-e": "body-emphasized",
  "t-sub": "subheadline",
  "t-sub-m": "subheadline-medium",
  "t-sub-e": "subheadline-emphasized",
  "t-foot": "footnote",
  "t-foot-m": "footnote-medium",
  "t-foot-e": "footnote-emphasized",
  "t-cap": "caption-1",
};

type Themed = { light: string; dark: string };
type Token = { name: string; value: unknown };
type TypeStyle = { name: string; fontSize: string; lineHeight: number | string; fontWeight: number };
type Tokens = {
  color: { themes: { id: string }[]; tokens: Token[] };
  type: { families: Record<string, string>; groups: { family: string; styles: TypeStyle[] }[] };
  spacing: { tokens: Token[] };
  radius: { tokens: Token[] };
  shadow: { tokens: Token[] };
  blur: { tokens: Token[] };
  zIndex: { tokens: Token[] };
};
const SCALES = ["spacing", "radius", "shadow", "blur", "zIndex"] as const;

const NAME = /^[a-z][a-z0-9.-]*$/;

function fail(reason: string): never {
  throw new Error(`DS_TOKENS_SHAPE: ${reason}`);
}

/** A token's custom property name: tokens.json's name with a dot as an underscore (`space-0.5` → `space-0_5`). */
function checkName(name: unknown, where: string): string {
  if (typeof name !== "string" || !NAME.test(name)) fail(`${where}: the name ${JSON.stringify(name)} is not a lower-case token name`);
  return name.replaceAll(".", "_");
}

/** A CSS value as tokens.json gives it; nothing that could end the template literal or the declaration. */
function checkValue(value: unknown, where: string): string {
  if (typeof value !== "string" && typeof value !== "number") fail(`${where}: the value is not a string or a number`);
  const v = String(value);
  if (/[`\\{};]|\$\{/.test(v) || v.trim() === "") fail(`${where}: the value ${JSON.stringify(v)} is not a plain CSS value`);
  return v;
}

/** A colour: per theme (`{light, dark}`), or one value for both (the palette). */
function colour(t: Token): { name: string; light: string; dark?: string } {
  const name = checkName(t.name, "colour");
  if (t.value && typeof t.value === "object") {
    const v = t.value as Partial<Themed>;
    return { name, light: checkValue(v.light, `colour ${t.name} light`), dark: checkValue(v.dark, `colour ${t.name} dark`) };
  }
  return { name, light: checkValue(t.value, `colour ${t.name}`) };
}

/** The `.t-*` rules bundle.css declares a type size in, by class: `{font-size, line-height, font-weight}`. */
export function bundleTypeRules(bundle: string): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  for (const [, cls, body] of bundle.matchAll(/(?:^|[}\s,])\.(t-[a-z0-9-]+)\{([^}]*)\}/g)) {
    const decls = Object.fromEntries((body as string).split(";").map((d) => d.split(":").map((x) => x.trim()) as [string, string]).filter(([k]) => k));
    if ("font-size" in decls) out[cls as string] = decls;
  }
  return out;
}

/** A glyph's three cuts: Phosphor's Regular, Bold and Fill. */
export const WEIGHTS = ["r", "b", "f"] as const;
export type Weight = (typeof WEIGHTS)[number];
/** The icon size tiers, smallest first: each is the token `size-icon-<tier>`. */
export const TIERS = ["2xs", "xs", "sm", "md", "lg"] as const;
export type Tier = (typeof TIERS)[number];
/** The `Ico` board as data: each name's path per weight, the default weight per name, the mirrored names, the tiers in px. */
export type IcoBoard = { glyphs: Record<string, Partial<Record<Weight, string>>>; defaults: Record<string, Weight>; mirrored: string[]; tiers: Record<Tier, number> };

const PATH = /^[MmLlHhVvCcSsQqTtAaZz0-9 .,-]*$/;
function icoFail(reason: string): never {
  throw new Error(`DS_ICO_SHAPE: ${reason}`);
}

/**
 * The weight the board draws for a name, as `Ico` resolves it: Fill when active and the name has one, else the asked
 * weight, the name's default, or Regular; a cut the name lacks falls to Regular, then Fill.
 */
export function boardWeight(board: Pick<IcoBoard, "glyphs" | "defaults">, name: string, o: { w?: Weight; a?: boolean } = {}): Weight {
  const g = board.glyphs[name] ?? icoFail(`the board has no glyph ${JSON.stringify(name)}`);
  const w = o.a && g.f !== undefined ? "f" : (o.w ?? board.defaults[name] ?? "r");
  return g[w] !== undefined ? w : g.r !== undefined ? "r" : "f";
}

/**
 * The `Ico` board (Phosphor 2.1.1, design review 1 I2): the tables R, B and F (one filled path per glyph on the 256
 * grid), W (a name's default weight when it is not Regular), M (the mirrored names) and T (the tiers), evaluated from
 * the board's own script in an empty context. Anything else is refused with the reason, never skipped.
 */
export function icoGlyphs(html: string): IcoBoard {
  const start = html.indexOf("const R = ");
  const end = html.indexOf("const n = this.props");
  if (start < 0 || end < start) icoFail("Ico.dc.html has no glyph table (const R … const n = this.props)");
  let raw: Record<string, unknown>;
  try {
    raw = runInNewContext(`${html.slice(start, end)}; ({ R, B, F, W, M, T })`, Object.create(null), { timeout: 1000 }) as Record<string, unknown>;
  } catch (e) {
    icoFail(`the glyph table does not run: ${(e as Error).message}`);
  }
  const table = (k: string) => {
    const v = raw[k];
    if (!v || typeof v !== "object" || Array.isArray(v)) icoFail(`the table ${k} is not an object`);
    return v as Record<string, unknown>;
  };
  const cuts: Record<Weight, Record<string, unknown>> = { r: table("R"), b: table("B"), f: table("F") };
  const glyphs: IcoBoard["glyphs"] = {};
  for (const w of WEIGHTS)
    for (const [n, d] of Object.entries(cuts[w])) {
      if (!/^[a-z][a-z0-9]*$/.test(n)) icoFail(`the glyph name ${JSON.stringify(n)} is not a lower-case name`);
      if (typeof d !== "string" || !PATH.test(d)) icoFail(`${n}:${w}: ${JSON.stringify(d)} is not one path's data`);
      glyphs[n] = { ...glyphs[n], [w]: d };
    }
  const defaults: Record<string, Weight> = {};
  for (const [n, w] of Object.entries(table("W"))) {
    if (!(n in glyphs)) icoFail(`W gives ${n} a default weight, and the board has no glyph ${n}`);
    if (!(WEIGHTS as readonly unknown[]).includes(w) || glyphs[n]?.[w as Weight] === undefined) icoFail(`W gives ${n} the weight ${JSON.stringify(w)}, which it is not drawn in`);
    defaults[n] = w as Weight;
  }
  const m = raw.M;
  if (!Array.isArray(m) || m.some((n) => typeof n !== "string" || !(n in glyphs))) icoFail(`M is not a list of the board's glyph names`);
  const t = table("T");
  if (JSON.stringify(Object.keys(t)) !== JSON.stringify(TIERS)) icoFail(`T names the tiers ${JSON.stringify(Object.keys(t))}, not ${JSON.stringify(TIERS)}`);
  for (const k of TIERS) if (!Number.isInteger(t[k]) || (t[k] as number) <= 0) icoFail(`T gives the tier ${k} ${JSON.stringify(t[k])}, not a size in px`);
  const resolved = Object.fromEntries(Object.keys(glyphs).map((n) => [n, boardWeight({ glyphs, defaults }, n)]));
  return { glyphs, defaults: resolved, mirrored: m as string[], tiers: t as Record<Tier, number> };
}

/** Each generated file's text by its path, from the inputs `read` returns (the working tree, or the index for the hook). */
export function compileDesign(read: (path: string) => Buffer): Record<string, string> {
  const t = JSON.parse(read(DS_TOKENS).toString("utf8")) as Tokens;
  const themes = t.color?.themes?.map((x) => x.id).sort();
  if (JSON.stringify(themes) !== JSON.stringify(["dark", "light"])) fail(`the colour themes are ${JSON.stringify(themes)}, not light and dark`);
  for (const g of SCALES) if (!Array.isArray(t[g]?.tokens)) fail(`the ${g} group has no tokens`);

  const colours = t.color.tokens.map(colour);
  const scales = SCALES.flatMap((g) => t[g].tokens.map((x) => ({ name: checkName(x.name, g), value: checkValue(x.value, `${g} ${x.name}`) })));
  const families = Object.entries(t.type.families).map(([k, v]) => ({ name: `font-${checkName(k, "family")}`, value: checkValue(v, `family ${k}`) }));
  const names = [...colours.map((c) => c.name), ...scales.map((s) => s.name), ...families.map((f) => f.name)];
  const twice = names.find((n, i) => names.indexOf(n) !== i);
  if (twice) fail(`the token ${twice} is defined twice`);

  const styles = new Map(
    t.type.groups.flatMap((g) => {
      if (!(g.family in t.type.families)) fail(`a type group names the family ${g.family}, which tokens.json does not define`);
      return g.styles.map((s) => [checkName(s.name, "type"), s] as const);
    }),
  );
  const bundle = read(DS_BUNDLE).toString("utf8");
  const rules = bundleTypeRules(bundle);
  for (const cls of Object.keys(rules)) if (!(cls in TYPE_ROLES)) fail(`bundle.css draws the type class .${cls}, which TYPE_ROLES does not map to a style`);
  for (const [cls, style] of Object.entries(TYPE_ROLES)) {
    const s = styles.get(style) ?? fail(`TYPE_ROLES maps .${cls} to ${style}, which tokens.json does not define`);
    const r = rules[cls] ?? fail(`TYPE_ROLES names .${cls}, which bundle.css does not draw`);
    const want = { "font-size": s.fontSize, "line-height": typeof s.lineHeight === "number" ? String(s.lineHeight) : s.lineHeight, "font-weight": String(s.fontWeight) };
    const got = { "font-size": r["font-size"], "line-height": r["line-height"], "font-weight": r["font-weight"] ?? "400" };
    if (JSON.stringify(got) !== JSON.stringify(want)) fail(`.${cls} in bundle.css is ${JSON.stringify(got)}, not ${style}'s ${JSON.stringify(want)}`);
  }

  const decl = (n: string, v: string) => `--${n}:${v}`;
  const light = [...colours.map((c) => decl(c.name, c.light)), ...scales.map((s) => decl(s.name, s.value)), ...families.map((f) => decl(f.name, f.value))];
  const dark = colours.filter((c) => c.dark !== undefined).map((c) => decl(c.name, c.dark as string));
  const css = [`/* compiled from ${checkName((t as unknown as { name: string }).name, "system")} tokens.json for this canvas */`, `:root,[data-theme=light]{${light.join(";")}}`, `[data-theme=dark]{${[...dark, "color-scheme:dark"].join(";")}}`].join("\n");

  const tokensTs = `// GENERATED by scripts/ds-tokens.ts (\`pnpm ds\`) from ${DS_TOKENS} and
// ${DS_BUNDLE}. Never edit it by hand: the pre-commit hook and \`pnpm accept\` fail when it differs from a
// fresh run. A value the system lacks is added to the system and re-seeded, never to a stylesheet.

/** Every custom property the system defines (without the leading \`--\`). */
export const TOKEN_NAMES: readonly string[] = ${JSON.stringify(names)};

/** The canvas's \`.t-*\` type classes (drawn by \`BUNDLE_CSS\`) by the tokens.json style each one is. */
export const TYPE_ROLES: Readonly<Record<string, string>> = ${JSON.stringify(TYPE_ROLES)};

/** The custom properties, light on \`:root\` and dark under \`[data-theme=dark]\`: the canvas's tokens.css. */
export const TOKENS_CSS = \`${css}
\`;

/** ds/components/bundle.css as it is: the \`qf-\` class contract and the \`.t-*\` type classes. */
export const BUNDLE_CSS = ${JSON.stringify(bundle)};
`;

  const board = icoGlyphs(read(ICO).toString("utf8"));
  // The board's tiers are the system's icon sizes: each T entry equals its size-icon token, so a page sized by the
  // tokens draws what the board draws.
  for (const k of TIERS) {
    const v = scales.find((x) => x.name === `size-icon-${k}`)?.value;
    if (v !== `${board.tiers[k]}px`) icoFail(`the tier ${k} is ${board.tiers[k]}px on the board and ${v === undefined ? "missing" : v} as size-icon-${k} in tokens.json`);
  }
  const glyphNames = Object.keys(board.glyphs);
  const iconCss = [".ico{display:block;flex-shrink:0}", ...TIERS.map((k) => `.ico-${k}{width:var(--size-icon-${k});height:var(--size-icon-${k})}`)].join("");
  const iconsTs = `// GENERATED by scripts/ds-tokens.ts (\`pnpm ds\`) from ${ICO}, the canvas's glyph set
// (Phosphor Icons 2.1.1, @phosphor-icons/core, MIT License, Copyright (c) 2023 Phosphor Icons).
// Never edit it by hand: the pre-commit hook and \`pnpm accept\` fail when it differs from a fresh run. A glyph
// the set lacks is added to the canvas and re-seeded; no module draws one of its own.

/** A glyph's cuts: Regular, Bold, Fill. */
export type Weight = "r" | "b" | "f";

/** Each glyph's one filled path on the 256 grid, per weight the board draws it in. */
export const GLYPH = {
${glyphNames.map((n) => `  ${n}: ${JSON.stringify(board.glyphs[n])},`).join("\n")}
} as const satisfies Record<string, Partial<Record<Weight, string>>>;

export type IconName = keyof typeof GLYPH;
export const ICON_NAMES = Object.keys(GLYPH) as IconName[];

/** The weight each name is drawn in when its place asks for none (the board's W, else Regular). */
export const DEFAULT_WEIGHT: Readonly<Record<IconName, Weight>> = ${JSON.stringify(board.defaults)};

/** The names the board draws mirrored left to right. */
export const MIRRORED: readonly IconName[] = ${JSON.stringify(board.mirrored)};

/** The size tiers in px, each the system's \`size-icon-<tier>\` token. */
export const TIERS = ${JSON.stringify(board.tiers)} as const;
export type Tier = keyof typeof TIERS;

/** \`.ico\` and one class per tier, sized by the tier's token. */
export const ICON_CSS = ${JSON.stringify(iconCss)};

const CUTS: Readonly<Record<string, Partial<Record<Weight, string>>>> = GLYPH;

/** The weight a place draws, as \`Ico\` resolves it: Fill when active and the name has one, else \`w\` or the default. */
export function weightOf(name: IconName, o: { w?: Weight; a?: boolean } = {}): Weight {
  const g = CUTS[name] ?? {};
  const w = o.a && g.f !== undefined ? "f" : (o.w ?? DEFAULT_WEIGHT[name]);
  return g[w] !== undefined ? w : g.r !== undefined ? "r" : "f";
}

/** A glyph as the canvas's \`Ico\` draws it: one filled path in currentColor, no stroke, hidden from assistive tech. */
export const ic = (name: IconName, tier: Tier, o: { w?: Weight; a?: boolean; cls?: string } = {}) => {
  const w = weightOf(name, o);
  return \`<svg class="ico ico-\${tier}\${o.cls ? \` \${o.cls}\` : ""}" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true" data-glyph="\${name}:\${w}"><path d="\${CUTS[name]?.[w] ?? ""}"\${MIRRORED.includes(name) ? ' transform="matrix(-1 0 0 1 256 0)"' : ""}/></svg>\`;
};

/** A place the canvas draws active (\`a\`): its resting cut and its Fill, the page showing one by the place's state. */
export const icActive = (name: IconName, tier: Tier) =>
  weightOf(name, { a: true }) === weightOf(name) ? ic(name, tier) : \`\${ic(name, tier, { cls: "ico-rest" })}\${ic(name, tier, { a: true, cls: "ico-act" })}\`;
`;
  return { [TOKENS_OUT]: tokensTs, [ICONS_OUT]: iconsTs };
}

/** The repository's working tree as the compiler's input. */
export const fromTree = (root: string) => (path: string) => readFileSync(join(root, path));

/** The generated files that differ from a fresh run, by path (a missing file differs). */
export function staleOutputs(fresh: Record<string, string>, current: (path: string) => string | null): string[] {
  return Object.keys(fresh).filter((p) => current(p) !== fresh[p]);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const root = join(import.meta.dirname, "..");
  const fresh = compileDesign(fromTree(root));
  const current = (p: string) => {
    try {
      return readFileSync(join(root, p), "utf8");
    } catch {
      return null;
    }
  };
  const stale = staleOutputs(fresh, current);
  if (process.argv.includes("--check")) {
    for (const p of DS_OUTPUTS) console.log(stale.includes(p) ? `ds: ${p} differs from a fresh run of scripts/ds-tokens.ts; run pnpm ds` : `ds: ${p} is a fresh run`);
    if (stale.length) process.exitCode = 1;
  } else {
    for (const p of DS_OUTPUTS) {
      if (stale.includes(p)) writeFileSync(join(root, p), fresh[p] as string);
      console.log(`ds: ${p} ${stale.includes(p) ? "written" : "unchanged"}`);
    }
  }
}
