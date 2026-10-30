// P9, before F36: the connections surfaces (the capture item in chat, the Connected rows with a status word and a last
// use, one connection's page with its audit rows and Disconnect, the Permissions pane with every grant once, the
// one-time code's card) are settled in the design system from the muse.ai capture before F36 draws them. The specimen
// draws them from the bundle's classes alone (contract B-P9-02, B-P9-08, B-P9-09, B-P9-10, B-P9-11; deltas 1, 5, 6, 7,
// 8). These read the CSS the page serves and the specimen's markup; how a browser lays it out is Kyle's look, by eye.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DS_BUNDLE, DS_DIR } from "../../scripts/ds-tokens.ts";
import { BUNDLE_CSS } from "../../packages/agent/src/http/app/tokens.ts";
import { APP_PAGE, PAGE_CSS } from "../../packages/agent/src/http/page.ts";

const SPECIMEN = `${DS_DIR}/specimens/connections.html`;
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

/** Every rule the specimen leans on: the settings pane, the grouped rows, the status pill, the prompt card, the buttons. */
const NAMED = [".qf-set", ".qf-set-nav", ".qf-set-pane", ".qf-set-top", ".qf-set-back", ".qf-set-body", ".qf-set-intro", ".qf-grp", ".qf-grpcard", ".qf-srow", ".qf-srow .tx", ".qf-srow .sub", ".qf-srow .trail", ".qf-srow .trail .val", ".qf-srow .logo", ".qf-status", ".qf-status--done i", ".qf-status--fail i", ".qf-status--wait i", ".qf-prompt-card", ".qf-btn", ".qf-btn--primary", ".qf-btn--destructive", ".qf-tlink", ".qf-chip--count", ".qf-seg", ".qf-bubble--agent", ".qf-dlg-act"];
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
const stage = (id: string) => specimen.match(new RegExp(`<div class="qf-stage" id="${id}">([\\s\\S]*?)\\n</div>`))?.[1] ?? "";

describe("[F36] the connections surfaces in the design system", () => {
  it("the page serves the bundle these rules are read from, as pnpm ds compiled it", () => {
    expect(APP_PAGE).toContain(PAGE_CSS);
    expect(PAGE_CSS).toContain(BUNDLE_CSS);
    expect(BUNDLE_CSS).toBe(readFileSync(DS_BUNDLE, "utf8"));
  });

  it("the served CSS carries every rule the specimen leans on, by selector", () => {
    expect(missing(PAGE_CSS)).toEqual([]);
  });

  it("planted: deleting `.qf-grpcard` from the bundle fails it", () => {
    const planted = PAGE_CSS.replace(/\.qf-grpcard\{[^}]*\}/, "");
    expect(planted).not.toBe(PAGE_CSS);
    expect(missing(planted)).toEqual([".qf-grpcard"]);
  });

  it("the specimen links the design system's own sheets and names only the bundle's classes", () => {
    expect(specimen).toContain('href="../../prototype/ds/qyvr-fletch/tokens.css"');
    expect(specimen).toContain('href="../components/bundle.css"');
    expect(undefinedClasses(specimen, BUNDLE_CSS)).toEqual([]);
  });

  it("planted: a class the bundle does not define fails the specimen", () => {
    expect(undefinedClasses(specimen.replace('class="qf-grpcard"', 'class="qf-planted"'), BUNDLE_CSS)).toEqual(["qf-planted"]);
  });

  it("each theme draws the capture item's three states, the Connected rows with a status word, the page with Disconnect, the grants and the code's card, then the phone stage", () => {
    for (const t of ["light", "dark"]) {
      expect(stage(`${t}-capture-pending`)).toContain("Dismiss");
      expect(stage(`${t}-capture-entered`)).toContain("Entered at");
      expect(stage(`${t}-capture-dismissed`)).not.toContain("qf-btn");
      const rows = stage(`${t}-connected`).match(/class="qf-srow is-static"/g) ?? [];
      expect(rows.length).toBe(6);
      expect((stage(`${t}-connected`).match(/class="qf-status qf-status--/g) ?? []).length).toBe(6);
      expect(stage(`${t}-connected`)).toContain("last used");
      expect(stage(`${t}-detail`)).toContain("qf-btn--destructive");
      expect(stage(`${t}-detail`)).toContain("What stays");
      expect(stage(`${t}-detail`)).toContain("Refused");
      expect(stage(`${t}-permissions`)).toContain("until you revoke it");
      expect(stage(`${t}-otp`)).toContain("Use it once");
      expect(stage(`${t}-phone`)).toContain('class="qf-set is-pane"');
    }
  });
});
