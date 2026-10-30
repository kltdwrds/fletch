// P2, before F24: the loop's working line and the chat file card are settled in the design system from the muse.ai
// capture before F24 draws them. One comment block in bundle.css ("Loop status and the file card (chat)") holds the
// rules, and a static specimen draws the working line, the file card, a plain link, a failure and a refusal from the
// bundle's classes alone (contract B-P2-04, B-P2-08, B-P2-09, B-P2-10). These read the CSS the page serves and the
// specimen's markup; how a browser lays it out is Kyle's look, by eye, not asserted here.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DS_BUNDLE, DS_DIR } from "../../scripts/ds-tokens.ts";
import { BUNDLE_CSS } from "../../packages/agent/src/http/app/tokens.ts";
import { APP_PAGE, PAGE_CSS } from "../../packages/agent/src/http/page.ts";

const SPECIMEN = `${DS_DIR}/specimens/loop-status.html`;
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

/** Every rule the specimen leans on: the new ones and the ones it reuses. */
const NAMED = [".qf-busy", ".qf-dots", ".qf-fcard", ".qf-fcard--chat", ".qf-fcard-head", ".qf-fcard .nm", ".qf-fcard .kd", ".qf-fcard .pv", ".qf-bubble--user", ".qf-bubble--agent", ".qf-reaction--agent"];
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

describe("[F24] the loop's working line and the chat file card in the design system", () => {
  it("the page serves the bundle these rules are read from, as pnpm ds compiled it", () => {
    expect(APP_PAGE).toContain(PAGE_CSS);
    expect(PAGE_CSS).toContain(BUNDLE_CSS);
    expect(BUNDLE_CSS).toBe(readFileSync(DS_BUNDLE, "utf8"));
    expect(BUNDLE_CSS).toMatch(/\/\* =+ Loop status and the file card \(chat\), P2/);
  });

  it("the served CSS carries every rule the specimen leans on, by selector", () => {
    expect(missing(PAGE_CSS)).toEqual([]);
  });

  it("planted: deleting `.qf-busy` from the bundle fails it", () => {
    const planted = PAGE_CSS.replace(/\.qf-busy\{[^}]*\}/, "");
    expect(planted).not.toBe(PAGE_CSS);
    expect(missing(planted)).toEqual([".qf-busy"]);
  });

  it("the specimen links the design system's own sheets and names only the bundle's classes", () => {
    expect(specimen).toContain('href="../../prototype/ds/qyvr-fletch/tokens.css"');
    expect(specimen).toContain('href="../components/bundle.css"');
    expect(undefinedClasses(specimen, BUNDLE_CSS)).toEqual([]);
  });

  it("planted: a class the bundle does not define fails the specimen", () => {
    expect(undefinedClasses(specimen.replace('class="qf-busy" role="status"', 'class="qf-planted" role="status"'), BUNDLE_CSS)).toEqual(["qf-planted"]);
  });

  it("the working line is a status with the dots and the activity in words, never a tool's identifier (B-P2-04)", () => {
    for (const theme of ["light", "dark"]) {
      expect(stage(`${theme}-busy`)).toMatch(/<div class="qf-busy" role="status"><span class="qf-dots" aria-hidden="true">(<b><\/b>){3}<\/span><span>Searching the web<\/span>/);
      expect(stage(`${theme}-busy-read`)).toMatch(/<span>Reading p2-missing-file\.md<\/span>/);
      expect(stage(`${theme}-busy`)).not.toMatch(/web\.search|files\.read|tool_search/);
    }
  });

  it("a stored file is a card inside the bubble linking the Library's viewer; a URL stays a link (B-P2-10)", () => {
    for (const theme of ["light", "dark"]) {
      const file = stage(`${theme}-file`);
      expect(file).toMatch(/<a class="qf-fcard qf-fcard--chat" href="\/library\/files\/p2-barrier\.md">/);
      expect(file).toContain('<span class="nm">p2-barrier.md</span><span class="kd">md</span>');
      expect(file).toMatch(/<pre class="pv">/);
      const link = stage(`${theme}-link`);
      expect(link).toMatch(/<a href="https:\/\/developers\.cloudflare\.com\//);
      expect(link).not.toMatch(/qf-fcard|qf-art-card|qf-link/);
    }
  });

  it("a failure and a refusal are sentences in the bubble: no card, no chip, no code (B-P2-08, B-P2-09)", () => {
    for (const theme of ["light", "dark"]) {
      for (const id of [`${theme}-fail`, `${theme}-refuse`]) {
        const s = stage(id);
        expect(s).toMatch(/^<div class="qf-msg"[^>]*>\n<div class="qf-bubble qf-bubble--agent">[^<]+<\/div>$/);
        expect(s).not.toMatch(/HOST_|_UNAVAILABLE|qf-status|qf-fcard|qf-error-card/);
      }
      expect(stage(`${theme}-fail`)).toMatch(/no file named p2-missing-file\.md/);
      expect(stage(`${theme}-refuse`)).toMatch(/can't print/);
    }
  });
});
