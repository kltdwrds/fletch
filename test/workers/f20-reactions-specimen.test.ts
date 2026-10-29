// F20: the reactions surface is settled in the design system from the muse.ai capture before F21 draws it. One
// comment block in bundle.css ("Reactions (chat)") holds the chip's rules, and a static specimen draws the chips, the
// hover row, the picker and the phone sheets from the bundle's classes alone (contract B-P1-10). These read the CSS
// the page serves and the specimen's markup; how a browser lays it out is Kyle's look, by eye, not asserted here.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DS_BUNDLE, DS_DIR } from "../../scripts/ds-tokens.ts";
import { BUNDLE_CSS } from "../../packages/agent/src/http/app/tokens.ts";
import { APP_PAGE, PAGE_CSS } from "../../packages/agent/src/http/page.ts";

const SPECIMEN = `${DS_DIR}/specimens/reactions.html`;
const specimen = readFileSync(SPECIMEN, "utf8");

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

/** Every rule the specimen leans on: the chip's own and the ones it reuses. */
const NAMED = [".qf-reaction", ".qf-reaction--mine", ".qf-reaction--agent", ".qf-reaction--care", ".qf-msgact", ".qf-react", ".qf-react button.more", ".qf-menu--sheet", ".qf-menu-item", ".qf-menu-head", ".qf-menu-sep", ".qf-bubble--user", ".qf-bubble--agent"];
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
/** One stage of the specimen by id, as markup. */
const stage = (id: string) => specimen.match(new RegExp(`<div class="qf-stage" id="${id}">([\\s\\S]*?)\\n</div></div>`))?.[1] ?? "";

describe("[F20] the reactions surface in the design system", () => {
  it("the page serves the bundle these rules are read from, as pnpm ds compiled it", () => {
    expect(APP_PAGE).toContain(PAGE_CSS);
    expect(PAGE_CSS).toContain(BUNDLE_CSS);
    expect(BUNDLE_CSS).toBe(readFileSync(DS_BUNDLE, "utf8"));
    expect(BUNDLE_CSS).toMatch(/\/\* =+ Reactions \(chat\), F20/);
  });

  it("the served CSS carries every rule the specimen leans on, by selector", () => {
    expect(missing(PAGE_CSS)).toEqual([]);
  });

  it("planted: deleting `.qf-reaction--care` from the bundle fails it", () => {
    const planted = PAGE_CSS.replace(/\.qf-reaction--care\{[^}]*\}/, "");
    expect(planted).not.toBe(PAGE_CSS);
    expect(missing(planted)).toEqual([".qf-reaction--care"]);
  });

  it("the specimen links the design system's own sheets and names only the bundle's classes", () => {
    expect(specimen).toContain('href="../../prototype/ds/qyvr-fletch/tokens.css"');
    expect(specimen).toContain('href="../components/bundle.css"');
    expect(undefinedClasses(specimen, BUNDLE_CSS)).toEqual([]);
  });

  it("planted: a class the bundle does not define fails the specimen", () => {
    expect(undefinedClasses(specimen.replace('class="qf-reaction qf-reaction--mine"', 'class="qf-reaction qf-planted"'), BUNDLE_CSS)).toEqual(["qf-planted"]);
  });

  it("two chips, one meaning each: the person's is a button that removes, the agent's a labelled image (B-P1-10)", () => {
    for (const theme of ["light", "dark"]) {
      expect(stage(`${theme}-mine`)).toMatch(/<button type="button" class="qf-reaction qf-reaction--mine" aria-label="Remove ❤️ reaction">/);
      expect(stage(`${theme}-ack`)).toMatch(/<span class="qf-reaction qf-reaction--agent" role="img" aria-label="Assistant reaction: 👍">/);
      expect(stage(`${theme}-care`)).toMatch(/class="qf-reaction qf-reaction--agent qf-reaction--care" role="img"/);
      expect(stage(`${theme}-care`)).not.toMatch(/🫶/);
    }
    expect(ruleFor(BUNDLE_CSS, ".qf-reaction--care")[0]?.body).toMatch(/color:\s*var\(--text-warning\)/);
  });

  it("the picker offers 👍 ❤️ 😂 😮 😢 🙏 and a disabled More; the own-message sheet offers Reply and Copy and no reaction", () => {
    for (const theme of ["light", "dark"]) {
      const picker = stage(`${theme}-picker`);
      for (const e of ["👍", "❤️", "😂", "😮", "😢", "🙏"]) expect(picker).toContain(`aria-label="React ${e}"`);
      expect(picker).toMatch(/class="more" aria-label="More reactions" disabled/);
      const own = stage(`${theme}-sheet-own`);
      expect(own).toContain('<span class="qf-lbl">Reply</span>');
      expect(own).toContain('<span class="qf-lbl">Copy</span>');
      expect(own).not.toMatch(/aria-label="React/);
      expect(stage(`${theme}-sheet-agent`)).toMatch(/aria-label="React 👍"/);
      expect(stage(`${theme}-hover`)).toMatch(/aria-label="React"/);
    }
  });
});
