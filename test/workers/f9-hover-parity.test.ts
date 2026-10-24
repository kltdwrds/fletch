// F9: input-aware hover parity. No control a person needs is reachable only through :hover: where a mouse reveals a
// control on hover, every other input (`hover: none`, a coarse pointer) shows it at rest. The three reveals (message
// actions, a chat row's time and kebab, a Library card's more button) hide only under
// `@media (hover: hover) and (pointer: fine)`, and a sweep of the served CSS finds no reveal keyed on :hover outside
// that gate. These read the CSS the page serves; how a browser applies it is Kyle's UAT by eye, not asserted here.
import { describe, expect, it } from "vitest";
import { APP_PAGE, PAGE_CSS } from "../../packages/agent/src/http/page.ts";

type Rule = { at: string[]; selector: string; body: string };
const FINE = /^@media\s*\(hover:\s*hover\)\s*and\s*\(pointer:\s*fine\)$/;
const REVEAL = /(?:^|;)\s*(?:opacity:\s*1\b|pointer-events:\s*auto|visibility:\s*visible|display:\s*(?!none)[a-z-]+)/;
const HIDE = /(?:^|;)\s*opacity:\s*0\s*(?:;|$)/;

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
const gated = (r: Rule) => r.at.some((a) => FINE.test(a));
/** A rule that shows something on :hover outside the fine-pointer gate: the parity violation. */
const ungatedReveals = (css: string) => rules(css).filter((r) => r.selector.includes(":hover") && REVEAL.test(r.body) && !gated(r));
const hidesOf = (css: string, target: string) => rules(css).filter((r) => r.selector.split(",").some((s) => s.trim().endsWith(target)) && HIDE.test(r.body));

const TARGETS = [
  { name: "message actions", target: ".acts", hover: "#log > .m:hover .acts" },
  { name: "a chat row's time and kebab", target: ".qf-row-end", hover: ".qf-rowwrap:hover>.qf-row-end" },
  { name: "a Library card's more button", target: ".cmore", hover: ".cardwrap:hover .cmore" },
];

describe("[F9] input-aware hover parity", () => {
  it("the page serves the sheet these rules read", () => {
    expect(APP_PAGE).toContain(PAGE_CSS);
  });

  for (const t of TARGETS)
    it(`${t.name}: hidden at rest and revealed on hover only under a hovering fine pointer, so it rests visible on touch`, () => {
      const hides = hidesOf(PAGE_CSS, t.target);
      expect(hides.length).toBeGreaterThan(0);
      for (const h of hides) expect(gated(h), h.selector).toBe(true);
      const reveal = rules(PAGE_CSS).filter((r) => r.selector.split(",").some((s) => s.trim() === t.hover));
      expect(reveal.length).toBe(1);
      expect(gated(reveal[0])).toBe(true);
      expect(reveal[0].body).toMatch(/opacity:\s*1/);
    });

  it("the row keeps its label clear of the resting time wherever the time rests visible", () => {
    const rest = rules(PAGE_CSS).find((r) => r.selector === ".qf-rowwrap:has(>.qf-row-end)>.qf-listrow");
    expect(rest?.at).toEqual(["@media not all and (hover:hover) and (pointer:fine)"]);
    expect(rest?.body).toMatch(/padding-inline-end:\s*96px/);
  });

  it("the open and focus states reveal on every input", () => {
    for (const s of [".qf-rowwrap:focus-within>.qf-row-end", ".qf-rowwrap.is-open>.qf-row-end", "#log > .m:focus-within .acts", ".cardwrap .cmore:focus-visible"]) {
      const r = rules(PAGE_CSS).find((x) => x.selector.split(",").some((p) => p.trim() === s));
      expect(r, s).toBeDefined();
    }
    // The chat list's own open state (the kebab's aria-expanded) is outside any gate.
    const open = rules(PAGE_CSS).find((r) => r.selector === '.qf-rowwrap:has(> .qf-row-end [aria-expanded="true"]) > .qf-row-end');
    expect(open?.at).toEqual([]);
  });

  it("sweep: no rule in the served CSS reveals anything on :hover outside the fine-pointer gate", () => {
    expect(ungatedReveals(PAGE_CSS).map((r) => r.selector)).toEqual([]);
  });

  it("planted: each old ungated reveal fails the sweep and the rest check", () => {
    const planted = [
      PAGE_CSS.replace("@media (hover: hover) and (pointer: fine) {\n  #log > .m .acts { opacity: 0; }", "#log > .m .acts { opacity: 0; }\n@media print {"),
      PAGE_CSS.replace("@media (hover:hover) and (pointer:fine){\n.qf-row-end{opacity:0;pointer-events:none}", ".qf-row-end{opacity:0;pointer-events:none}\n@media print{"),
      PAGE_CSS.replace("@media (hover: hover) and (pointer: fine) {\n  @container qf (min-width: 768px) {\n    .cardwrap .cmore { opacity: 0; }", "@media print {\n  @container qf (min-width: 768px) {\n    .cardwrap .cmore { opacity: 0; }"),
    ];
    planted.forEach((css, i) => {
      expect(css).not.toBe(PAGE_CSS);
      expect(ungatedReveals(css).length, TARGETS[i].name).toBeGreaterThan(0);
      expect(hidesOf(css, TARGETS[i].target).some((h) => !gated(h)), TARGETS[i].name).toBe(true);
    });
  });
});
