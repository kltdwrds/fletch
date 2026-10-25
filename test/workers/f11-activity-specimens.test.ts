// F11: the task drawer's look is settled in the design system before F15 draws it. One comment block in bundle.css
// ("Task drawer (activity)") holds the drawer's rules, and a static specimen document draws the PR #15 drawer from
// the bundle's classes alone. These read the CSS the page serves and the specimen's text; how a browser lays it out
// is Kyle's approval of the screenshot set, by eye, not asserted here.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DS_BUNDLE, DS_DIR } from "../../scripts/ds-tokens.ts";
import { BUNDLE_CSS } from "../../packages/agent/src/http/app/tokens.ts";
import { APP_PAGE, PAGE_CSS } from "../../packages/agent/src/http/page.ts";

const SPECIMEN = `${DS_DIR}/specimens/task-drawer.html`;
const specimen = readFileSync(SPECIMEN, "utf8");

type Rule = { at: string[]; selector: string; body: string };
/** The style rules of a sheet, each with the at-rules that hold it (outermost first). */
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
        out.push({ at: [...open], selector: head, body: buf.trim() });
      buf = "";
    } else buf += ch;
  }
  return out;
}
/** The rules whose selector list holds exactly `selector`. */
const ruleFor = (css: string, selector: string) => rules(css).filter((r) => r.selector.split(",").some((s) => s.trim() === selector));
const WIDE = /^@media\s*\(min-width:\s*768px\)$/;

/** Every rule the part names, by selector: the drawer's own and the ones it reuses. */
const NAMED = [
  ".qf-task",
  ".qf-task.is-detail>.qf-task-detail",
  ".qf-task-back",
  ".qf-task-head",
  ".qf-status",
  ".qf-status--done i",
  ".qf-status--run i",
  ".qf-status--fail i",
  ".qf-status--wait i",
  ".qf-tl",
  ".qf-tl li.is-sel",
  ".qf-tl .rail b.is-fail",
  ".qf-tl .rail b.is-wait",
  ".qf-tl--nested",
  ".qf-tl .nm",
  ".qf-items-head",
  ".qf-code",
  ".qf-code-bar",
  ".qf-code.is-cut .qf-src",
  ".qf-more",
  ".qf-src",
  ".qf-fcard",
  ".panel-note",
];
const missing = (css: string) => NAMED.filter((s) => ruleFor(css, s).length === 0);

/** The two-pane rule (the timeline at 360 px beside the detail) and the one-pane rule (the detail replaces it). */
const twoPane = (css: string) => rules(css).filter((r) => /(^|,)\s*\.qf-task\s*(,|$)/.test(r.selector) && /grid-template-columns:\s*360px\s+minmax\(0,\s*1fr\)/.test(r.body));
const onePane = (css: string) => ruleFor(css, ".qf-task.is-detail>.qf-task-list").filter((r) => /display:\s*none/.test(r.body));
function panesHeld(css: string): string[] {
  const bad: string[] = [];
  const two = twoPane(css);
  if (two.length === 0) bad.push("no two-pane rule");
  for (const r of two) if (r.at.length !== 1 || !WIDE.test(r.at[0])) bad.push(`two-pane rule outside min-width:768px: ${r.at.join(" ")}`);
  const one = onePane(css);
  if (one.length === 0) bad.push("no one-pane rule");
  for (const r of one) if (r.at.length) bad.push(`one-pane rule gated: ${r.at.join(" ")}`);
  return bad;
}

/** Every class a selector in the sheet names. */
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

/** A step of the drawn timeline by its kind: the row's text, or undefined. */
const stepText = (html: string, kind: string) => {
  const m = html.match(new RegExp(`<li[^>]*data-kind="${kind}"[^>]*>([\\s\\S]*?)</li>`));
  return m ? (m[1] as string).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() : undefined;
};

describe("[F11] the task drawer in the design system", () => {
  it("the page serves the bundle these rules are read from, as pnpm ds compiled it", () => {
    expect(APP_PAGE).toContain(PAGE_CSS);
    expect(PAGE_CSS).toContain(BUNDLE_CSS);
    expect(BUNDLE_CSS).toBe(readFileSync(DS_BUNDLE, "utf8"));
    expect(BUNDLE_CSS).toMatch(/\/\* =+ Task drawer \(activity\)/);
  });

  it("the served CSS carries every rule the part names, by selector", () => {
    expect(missing(PAGE_CSS)).toEqual([]);
  });

  it("planted: deleting `.qf-tl li.is-sel` from the bundle fails it", () => {
    const sel = ruleFor(BUNDLE_CSS, ".qf-tl li.is-sel")[0];
    expect(sel).toBeDefined();
    const planted = PAGE_CSS.replace(/\.qf-tl li\.is-sel\{[^}]*\}/, "");
    expect(planted).not.toBe(PAGE_CSS);
    expect(missing(planted)).toEqual([".qf-tl li.is-sel"]);
  });

  it("two panes from 768 px, the timeline at 360; under it one pane, the detail replacing the timeline", () => {
    expect(panesHeld(PAGE_CSS)).toEqual([]);
    // From 768 the detail and the timeline both show and Back is gone.
    const back = ruleFor(PAGE_CSS, ".qf-task-back").filter((r) => r.at.some((a) => WIDE.test(a)));
    expect(back.map((r) => r.body)).toEqual([expect.stringMatching(/display:\s*none/)]);
  });

  it("planted: an ungated two-pane rule fails, and so does a gated one-pane rule", () => {
    const ungated = `${PAGE_CSS}\n.qf-task{display:grid;grid-template-columns:360px minmax(0,1fr)}`;
    expect(panesHeld(ungated)).toEqual(["two-pane rule outside min-width:768px: "]);
    const gated = PAGE_CSS.replace(/\.qf-task\.is-detail>\.qf-task-list\{display:none\}/, "@media (max-width:767px){.qf-task.is-detail>.qf-task-list{display:none}}");
    expect(gated).not.toBe(PAGE_CSS);
    expect(panesHeld(gated)).toEqual(["one-pane rule gated: @media (max-width:767px)"]);
  });

  it("the status pill's four tones dot from the tokens' success, accent, error and tertiary colours", () => {
    const dot = (tone: string) => ruleFor(BUNDLE_CSS, `.qf-status--${tone} i`)[0]?.body;
    expect(dot("done")).toMatch(/background:\s*var\(--status-success\)/);
    expect(dot("run")).toMatch(/background:\s*var\(--accent\)/);
    expect(dot("fail")).toMatch(/background:\s*var\(--status-error\)/);
    expect(dot("wait")).toMatch(/background:\s*var\(--text-tertiary\)/);
  });

  it("the truncation rules: a list title is one ellipsised line, the code never cut, a result folded at 40 lines", () => {
    expect(ruleFor(BUNDLE_CSS, ".qf-tl .nm")[0]?.body).toMatch(/white-space:\s*nowrap.*text-overflow:\s*ellipsis|text-overflow:\s*ellipsis.*white-space:\s*nowrap/);
    const code = ruleFor(BUNDLE_CSS, ".qf-code .qf-src")[0]?.body ?? "";
    expect(code).toMatch(/white-space:\s*pre-wrap/);
    expect(code).not.toMatch(/max-height|line-clamp|text-overflow/);
    // 40 lines of the .qf-src face (19.5 px) plus its 8 px top padding.
    expect(ruleFor(BUNDLE_CSS, ".qf-code.is-cut .qf-src")[0]?.body).toMatch(/max-height:\s*calc\(40\s*\*\s*19\.5px\s*\+\s*8px\)/);
  });

  it("the specimen document names only classes the bundle defines", () => {
    expect(specimen).toMatch(/class="/);
    expect(undefinedClasses(specimen, BUNDLE_CSS)).toEqual([]);
  });

  it("planted: one undefined class in the specimen fails", () => {
    const planted = specimen.replace('class="qf-task-head"', 'class="qf-task-head qf-task-header"');
    expect(planted).not.toBe(specimen);
    expect(undefinedClasses(planted, BUNDLE_CSS)).toEqual(["qf-task-header"]);
  });

  it("the specimen draws every step kind the catalogue names, as text", () => {
    expect(stepText(specimen, "started")).toBe("Started");
    expect(stepText(specimen, "bash")).toMatch(/^Ran pnpm exec vitest run/);
    expect(stepText(specimen, "edit")).toMatch(/^Edited packages\/agent\/src\/migrations\/catalog\.ts/);
    expect(stepText(specimen, "launch")).toMatch(/^Launched subagent/);
    expect(stepText(specimen, "summary")).toMatch(/^Summary/);
    // The summary detail holds two file cards; the selected step's detail is a code block; the edit's is a change.
    expect(specimen.match(/class="qf-fcard"/g)?.length).toBeGreaterThanOrEqual(2);
    expect(specimen).toMatch(/<li[^>]*class="is-sel"[^>]*data-kind="bash"/);
    expect(specimen).toMatch(/class="qf-code is-cut"/);
    expect(specimen).toMatch(/cut at 20,000 characters/);
    expect(specimen).toMatch(/class="add"/);
    expect(specimen).toMatch(/SUBAGENT 01/);
    expect(specimen).toMatch(/class="qf-tl qf-tl--nested"/);
  });

  it("the specimen is drawn in light and dark, and loads only the system's own sheets", () => {
    expect(specimen).toMatch(/data-theme="light"/);
    expect(specimen).toMatch(/data-theme="dark"/);
    const hrefs = [...specimen.matchAll(/<link[^>]*href="([^"]+)"/g)].map((m) => m[1]);
    expect(hrefs).toEqual(["../../prototype/ds/qyvr-fletch/tokens.css", "../components/bundle.css"]);
    expect(specimen).not.toMatch(/<script|<style|style="/);
  });
});
