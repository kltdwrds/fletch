// P10, F92: the four surfaces of search and media (the source link card, the browser card and its panel, the places
// list and map card, the image card with the Library's Images tile) are settled in the design system from the muse.ai
// capture before any part draws them. The specimen draws them from fixture data with the bundle's classes and the
// tokens alone (contract B-P10-02, B-P10-08, B-P10-11, B-P10-12, B-P10-13, B-P10-17, delta 8); nothing is drawn live
// and no provider is built on (D-0029 stays proposed). These read the CSS the page serves and the specimen's markup;
// how a browser lays it out at 1280 and 390 in both themes is Kyle's look, by eye.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CANVAS_TOKENS_CSS, DS_BUNDLE, DS_DIR } from "../../scripts/ds-tokens.ts";
import { BUNDLE_CSS } from "../../packages/agent/src/http/app/tokens.ts";
import { APP_PAGE, PAGE_CSS } from "../../packages/agent/src/http/page.ts";
import { ACTIVITY_TEXT } from "../../packages/agent/src/obs/activity-words.ts";

const SPECIMEN = `${DS_DIR}/specimens/search-media.html`;
const specimen = readFileSync(SPECIMEN, "utf8");
const TOKENS = readFileSync(CANVAS_TOKENS_CSS, "utf8");
const HEADER = /\/\* =+ Search and media \(chat\), P10/;

type Rule = { selector: string; body: string };
/** The style rules of a sheet (at-rule heads and keyframes left out). */
function rules(css: string): Rule[] {
  const out: Rule[] = [];
  const open: string[] = [];
  let buf = "";
  for (const ch of css.replace(/\/\*[\s\S]*?\*\//g, "")) {
    if (ch === "{") {
      open.push(buf.slice(buf.lastIndexOf(";") + 1).trim());
      buf = "";
    } else if (ch === "}") {
      const head = open.pop();
      if (head !== undefined && !head.startsWith("@") && open.every((h) => h.startsWith("@") && !h.startsWith("@keyframes")))
        out.push({ selector: head, body: buf.trim() });
      buf = "";
    } else buf += ch;
  }
  return out;
}
const ruleFor = (css: string, selector: string) => rules(css).filter((r) => r.selector.split(",").some((s) => s.trim() === selector));

/** Every rule the specimen leans on: the four new surfaces and what they reuse (the thread, the bubbles, the buttons). */
const NAMED = [".qf-linkcard", ".qf-linkcard .tile", ".qf-linkcard.has-preview", ".qf-linkcard .pv", ".qf-linkcard .nm", ".qf-linkcard .host", ".qf-bcard", ".qf-bcard-head", ".qf-bcard .tile", ".qf-bcard .tile.is-done", ".qf-bcard .kd", ".qf-bcard .sub", ".qf-bcard .th", ".qf-bcard .qf-btn", ".qf-bpanel", ".qf-bpanel-head", ".qf-bpanel-head h3", ".qf-bpanel-addr", ".qf-bpanel .th", ".qf-bpanel-note", ".qf-places", ".qf-places .map", ".qf-places .pin", ".qf-places-list", ".qf-place", ".qf-place .nm", ".qf-place .mt", ".qf-place .rt", ".qf-place .op.is-open", ".qf-place .op.is-closed", ".qf-place .op.is-stale", ".qf-imgcard", ".qf-imgcard .th", ".qf-imgcard .nm", ".qf-imggrid", ".qf-imgtile", ".qf-thread", ".qf-msg", ".qf-bubble--agent", ".qf-bubble--user", ".qf-btn--primary", ".qf-ibtn"];
const missing = (css: string) => NAMED.filter((s) => ruleFor(css, s).length === 0);

function definedClasses(css: string): Set<string> {
  const out = new Set<string>();
  for (const r of rules(css)) for (const [, c] of r.selector.matchAll(/\.([a-zA-Z_][\w-]*)/g)) out.add(c as string);
  return out;
}
/** The classes the document's markup names that the sheet does not define. */
function undefinedClasses(html: string, css: string): string[] {
  const defined = definedClasses(css);
  const used = new Set<string>();
  for (const [, list] of html.matchAll(/\sclass="([^"]*)"/g)) for (const c of (list as string).split(/\s+/).filter(Boolean)) used.add(c);
  return [...used].filter((c) => !defined.has(c)).sort();
}
/** The custom properties a text reads (`var(--x)`) that neither the tokens nor the bundle define. */
function undefinedTokens(text: string): string[] {
  const defined = new Set([...`${TOKENS}\n${BUNDLE_CSS}`.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1] as string));
  const used = new Set([...text.matchAll(/var\((--[\w-]+)/g)].map((m) => m[1] as string));
  return [...used].filter((t) => !defined.has(t)).sort();
}
/** The bundle's P10 block: from its header to the next block's. */
const p10Block = (css: string) => {
  const from = css.search(HEADER);
  const rest = css.slice(from + 10);
  const next = rest.search(/\/\* (=+|Share targets)/);
  return from < 0 ? "" : css.slice(from, from + 10 + (next < 0 ? rest.length : next));
};
/** The markup the browser draws: the document without its comments. */
const drawn = specimen.replace(/<!--[\s\S]*?-->/g, "");
/** One stage of the specimen by id, as markup: from its opening to the next stage or theme. */
const stage = (id: string) => {
  const at = drawn.indexOf(`<div class="qf-stage" id="${id}">`);
  if (at < 0) return "";
  const rest = drawn.slice(at + 1);
  const end = rest.search(/<div class="qf-stage"|<div class="qf-vp" data-theme=/);
  return drawn.slice(at, at + 1 + (end < 0 ? rest.length : end));
};
/** One theme's markup. */
const theme = (t: string) => {
  const at = drawn.indexOf(`<div class="qf-vp" data-theme="${t}" id="${t}">`);
  const next = drawn.indexOf('<div class="qf-vp" data-theme=', at + 1);
  return at < 0 ? "" : drawn.slice(at, next < 0 ? undefined : next);
};
const THEMES = ["light", "dark"] as const;
const PHONE = '<div class="qf-vp" style="width:390px;max-width:390px">';
const all = (s: string, re: RegExp) => [...s.matchAll(re)];

describe("[F92] the surfaces of search and media in the design system", () => {
  it("the page serves the bundle these rules are read from, as pnpm ds compiled it, with the P10 block", () => {
    expect(APP_PAGE).toContain(PAGE_CSS);
    expect(PAGE_CSS).toContain(BUNDLE_CSS);
    expect(BUNDLE_CSS).toBe(readFileSync(DS_BUNDLE, "utf8"));
    expect(BUNDLE_CSS).toMatch(HEADER);
  });

  it("the served CSS carries every rule the specimen leans on, by selector", () => {
    expect(missing(PAGE_CSS)).toEqual([]);
  });

  it("planted: deleting `.qf-places-list` from the bundle fails it", () => {
    const planted = PAGE_CSS.replace(/\.qf-places-list\{[^}]*\}/, "");
    expect(planted).not.toBe(PAGE_CSS);
    expect(missing(planted)).toEqual([".qf-places-list"]);
  });

  it("the specimen links the design system's own sheets alone and names only the bundle's classes", () => {
    expect(specimen).toContain('href="../../prototype/ds/qyvr-fletch/tokens.css"');
    expect(specimen).toContain('href="../components/bundle.css"');
    expect(all(specimen, /<link [^>]*rel="stylesheet"/g).length).toBe(2);
    expect(drawn).not.toMatch(/<style|<script/);
    expect(undefinedClasses(specimen, BUNDLE_CSS)).toEqual([]);
  });

  it("planted: a class the bundle does not define fails the specimen", () => {
    expect(undefinedClasses(specimen.replace('class="qf-places-list"', 'class="qf-planted"'), BUNDLE_CSS)).toEqual(["qf-planted"]);
  });

  it("every colour is a token: the specimen and the P10 block read only defined custom properties, and the specimen writes no colour literal", () => {
    expect(p10Block(BUNDLE_CSS)).toContain(".qf-linkcard{");
    expect(undefinedTokens(drawn)).toEqual([]);
    expect(undefinedTokens(p10Block(BUNDLE_CSS))).toEqual([]);
    expect(drawn).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/);
  });

  it("planted: an undefined token or a colour literal fails it", () => {
    const planted = drawn.replace("fill:var(--orange-500)", "fill:var(--planted-orange)");
    expect(undefinedTokens(planted)).toEqual(["--planted-orange"]);
    expect(drawn.replace("fill:var(--orange-500)", "fill:#f1916e")).toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  it("each theme names the four blocks by a heading, in Muse's order", () => {
    const heads = ["The source link card", "The browser card and its panel", "The places list and map card", "The image card"];
    for (const t of THEMES) {
      const found = all(theme(t), /<h2 class="t-title-3-e">([^<]+)<\/h2>/g).map((m) => m[1]);
      expect(found).toEqual(heads);
    }
  });

  it("the source link card carries the address and the name the reply's own link names, with a language tile or a preview image; a reply with no page read names none (B-P10-02)", () => {
    for (const t of THEMES) {
      for (const id of [`${t}-link-lang`, `${t}-link-preview`, `${t}-phone-link`]) {
        const s = stage(id);
        const inline = s.match(/<div class="qf-bubble qf-bubble--agent">[\s\S]*?<a href="([^"]+)">([^<]+)<\/a>/);
        const card = s.match(/<a class="qf-linkcard[^"]*" href="([^"]+)">[\s\S]*?<span class="nm">([^<]+)<\/span><span class="host">([^<]+)<\/span>/);
        expect(inline).not.toBeNull();
        expect(card).not.toBeNull();
        expect(card?.[1]).toBe(inline?.[1]);
        expect(card?.[2]).toBe(inline?.[2]);
        expect(card?.[3]).toBe(new URL(card?.[1] as string).host);
      }
      expect(stage(`${t}-link-lang`)).toContain('<a class="qf-linkcard" href="https://developers.cloudflare.com/durable-objects/api/alarms/"><span class="tile">en</span>');
      expect(stage(`${t}-link-preview`)).toMatch(/<a class="qf-linkcard has-preview" [^>]*><span class="pv"><svg /);
      const none = stage(`${t}-link-none`);
      expect(none).toContain("I can't search the web from this deploy");
      expect(none).not.toMatch(/<a |qf-linkcard/);
    }
  });

  it("the browser card says Browser, its state in the Activity table's words and the title, with the page and an open control; its panel offers the take-over and says whose machine it is (B-P10-08)", () => {
    const words = Object.values(ACTIVITY_TEXT.status);
    for (const t of THEMES) {
      const cards = [`${t}-browser-run`, `${t}-browser-done`, `${t}-browser-panel`, `${t}-phone-browser`].flatMap((id) => all(stage(id), /<div class="qf-bcard">[\s\S]*?<span class="kd">Browser<\/span><span class="sub">([^·<]+) · ([^<]+)<\/span>[\s\S]*?<div class="th"><svg [\s\S]*?<button class="qf-btn">Open the browser<\/button><\/div>/g));
      expect(cards.length).toBe(4);
      for (const c of cards) expect(words).toContain((c[1] as string).trim());
      expect(stage(`${t}-browser-run`)).toContain("<span class=\"sub\">Running · ");
      expect(stage(`${t}-browser-done`)).toContain('<span class="tile is-done">');
      for (const id of [`${t}-browser-panel`, `${t}-phone-panel`]) {
        const s = stage(id);
        expect(s).toMatch(/<div class="qf-bpanel"><div class="qf-bpanel-head"><span class="tx"><h3>[^<]+<\/h3><span class="sub">Complete · developers\.cloudflare\.com<\/span><\/span><button class="qf-btn qf-btn--primary">Take control of the browser<\/button><button class="qf-ibtn" aria-label="Close the browser">/);
        expect(s).toContain("The agent's own browser, not yours");
        expect(s).toContain("Only you see this view.");
      }
      expect(stage(`${t}-phone-panel`)).toContain(`${PHONE}<div class="qf-bpanel">`);
    }
    expect(drawn).not.toMatch(/Open preview|Completed/);
    // planted: Muse's own word for the state is not the table's, so a card that says it fails.
    const planted = stage("light-browser-done").replace('<span class="sub">Complete · ', '<span class="sub">Completed · ');
    const word = planted.match(/<span class="kd">Browser<\/span><span class="sub">([^·<]+) · /)?.[1]?.trim();
    expect(word).toBe("Completed");
    expect(words).not.toContain(word);
  });

  it("the places card draws the map once with a pin per place and each place's name, rating, price, category and an open state with the time it was read, never a bare Open (B-P10-11, B-P10-12)", () => {
    for (const t of THEMES) {
      for (const id of [`${t}-places`, `${t}-places-reload`, `${t}-phone-places`]) {
        const s = stage(id);
        expect(all(s, /<div class="qf-places">/g).length).toBe(1);
        expect(all(s, /<div class="map"><svg /g).length).toBe(1);
        const pins = all(s, /<span class="pin" [^>]*><i><\/i>([^<]+)<\/span>/g).map((m) => m[1]);
        const rows = all(s, /<div class="qf-place"><span class="nm">([^<]+)<\/span><span class="mt"><span class="rt">★<\/span> \d\.\d · \$+ · [^·<]+ · <span class="op is-(open|closed|stale)">([^<]+)<\/span><\/span><\/div>/g);
        expect(rows.map((r) => r[1])).toEqual(pins);
        expect(rows.length).toBe(3);
        for (const r of rows) expect(r[3]).toMatch(/^(Open|Closed)\b.*\b\d{1,2}:\d{2} (AM|PM)\b/);
      }
      for (const id of [`${t}-places`, `${t}-phone-places`]) {
        const s = stage(id);
        for (const p of all(s, /<li><b>([^<]+)<\/b>, ([^.]+)\./g)) expect(p[2]).toMatch(/^\d+ [A-Z][a-z]+ St, San Francisco, CA \d{5}$/);
        expect(all(s, /<li><b>/g).length).toBe(3);
        expect(s).toMatch(/is-open">Open · checked 2:45 PM</);
      }
      const reload = stage(`${t}-places-reload`);
      expect(reload).not.toMatch(/is-open|is-closed/);
      for (const m of all(reload, /<span class="op is-stale">([^<]+)<\/span>/g)) expect(m[1]).toMatch(/when checked, 2:45 PM on 8 Nov$/);
    }
    expect(drawn).not.toMatch(/class="op[^"]*">(Open|Open now|Closed)<\/span>/);
  });

  it("the generated image is a square card in its own message with its name after the reply, and the Library's Images tile is the same file, once (B-P10-13)", () => {
    for (const t of THEMES) {
      for (const id of [`${t}-image`, `${t}-phone-image`]) {
        const s = stage(id);
        const reply = s.indexOf("It is in the Library under Images as lighthouse-at-dusk.png.");
        const card = s.indexOf('<div class="qf-msg"><a class="qf-imgcard" href="/library/files/lighthouse-at-dusk.png"><span class="th"><svg ');
        expect(reply).toBeGreaterThan(-1);
        expect(card).toBeGreaterThan(reply);
        expect(s).toContain('<span class="nm">lighthouse-at-dusk.png</span></a></div>');
        expect(s).toContain("<h3 class=\"t-title-3-e\" style=\"margin:0\">Images</h3>");
        expect(all(s, /<a class="qf-imgtile" href="\/library\/files\/lighthouse-at-dusk\.png"/g).length).toBe(1);
      }
    }
  });

  it("each surface has a phone stage at 390 in its own .qf-vp, in both themes", () => {
    for (const t of THEMES)
      for (const id of ["link", "browser", "panel", "places", "image"]) expect(stage(`${t}-phone-${id}`)).toContain(PHONE);
  });
});
