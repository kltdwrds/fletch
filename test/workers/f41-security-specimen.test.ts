// P14, before F41: the Security pane (the passkeys by the date each was added with Remove on each, Add a passkey to
// /login, the last-passkey refusal said in words with the row kept, the Sessions card with Log out, the Recovery code
// card that draws no code, the recovery sign-in's and the non-owner's refusals) is settled in the design system from
// the muse.ai capture before F41 draws it. The specimen draws it from the bundle's classes alone (contract B-P14-05,
// B-P14-06, B-P14-12; delta 4). These read the CSS the page serves and the specimen's markup; how a browser lays it out
// is Kyle's look, by eye.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DS_BUNDLE, DS_DIR } from "../../scripts/ds-tokens.ts";
import { BUNDLE_CSS } from "../../packages/agent/src/http/app/tokens.ts";
import { APP_PAGE, PAGE_CSS } from "../../packages/agent/src/http/page.ts";

const SPECIMEN = `${DS_DIR}/specimens/security.html`;
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

/** Every rule the specimen leans on: the settings pane and its phone form, the grouped rows, the row-link, the danger row, the status pill as the code, the buttons. */
const NAMED = [".qf-vp", ".qf-set", ".qf-set-nav", ".qf-set-pane", ".qf-set-top", ".qf-set-top.has-back", ".qf-set-back", ".qf-set-body", ".qf-set-intro", ".qf-set.is-pane .qf-set-nav", ".qf-grp", ".qf-grpcard", ".qf-srow", ".qf-srow .tx", ".qf-srow .sub", ".qf-srow .trail", ".qf-srow.is-link", ".qf-srow.is-danger", ".qf-srow.is-static", ".qf-status", ".qf-status--fail i", ".qf-chip--count", ".qf-btn", ".qf-btn--secondary", ".qf-btn--destructive", ".qf-ibtn", ".qf-ibtn--filled", ".qf-ibtn--28"];
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
/** The passkey rows of a stage: "Passkey", the date it was added in words, Remove. */
const passkeyRows = (html: string) => html.match(/<span class="tx">Passkey<span class="sub">Added \d{1,2} [A-Z][a-z]+ \d{4}<\/span><\/span><span class="trail"><button class="qf-btn qf-btn--destructive"[^>]*>Remove<\/button>/g) ?? [];

const INTRO = "A passkey is how you sign in here. Keep at least two, on different devices.";
const LAST = "The last passkey stays. Add another before removing this one.";
const SESSION = ["This browser is signed in for thirty days from the last sign-in.", "Log out ends it. No list of other sessions is kept here."];
const RECOVERY = ["Shown once, when the first passkey was added.", "Replaced when a passkey is added after a recovery sign-in. It is not readable here."];
const RECOVERY_SIGNIN = "Add a passkey first. A recovery sign-in cannot manage passkeys.";
const MEMBER = "Only the owner manages passkeys.";
const ADD = '<a class="qf-srow is-link" href="/login"';

describe("[F41] the Security pane in the design system", () => {
  it("the page serves the bundle these rules are read from, as pnpm ds compiled it", () => {
    expect(APP_PAGE).toContain(PAGE_CSS);
    expect(PAGE_CSS).toContain(BUNDLE_CSS);
    expect(BUNDLE_CSS).toBe(readFileSync(DS_BUNDLE, "utf8"));
  });

  it("the served CSS carries every rule the specimen leans on, by selector", () => {
    expect(missing(PAGE_CSS)).toEqual([]);
  });

  it("planted: deleting `.qf-srow.is-danger` from the bundle fails it", () => {
    const planted = PAGE_CSS.replace(/\.qf-srow\.is-danger\{[^}]*\}/, "");
    expect(planted).not.toBe(PAGE_CSS);
    expect(missing(planted)).toEqual([".qf-srow.is-danger"]);
  });

  it("the specimen links the design system's own sheets and names only the bundle's classes", () => {
    expect(specimen).toContain('href="../../prototype/ds/qyvr-fletch/tokens.css"');
    expect(specimen).toContain('href="../components/bundle.css"');
    expect(undefinedClasses(specimen, BUNDLE_CSS)).toEqual([]);
  });

  it("planted: a class the bundle does not define fails the specimen", () => {
    expect(undefinedClasses(specimen.replace('class="qf-grpcard"', 'class="qf-planted"'), BUNDLE_CSS)).toEqual(["qf-planted"]);
  });

  it("each theme draws the pane, the last-passkey refusal with the row kept, the recovery sign-in and the non-owner, then the phone stages", () => {
    for (const t of ["light", "dark"]) {
      for (const id of [`${t}-main`, `${t}-phone`]) {
        const s = stage(id);
        expect(s).toContain('<h2>Security</h2>');
        expect(s).toContain(INTRO);
        expect(passkeyRows(s).length).toBe(2);
        expect(s).toContain(ADD);
        for (const w of [...SESSION, ...RECOVERY]) expect(s).toContain(w);
        expect(s).toContain(">Log out</button>");
        expect(s).not.toContain("LOGIN_LAST_PASSKEY");
      }
      for (const id of [`${t}-refuse`, `${t}-phone-refuse`]) {
        const s = stage(id);
        expect(passkeyRows(s).length).toBe(1);
        expect(s).toContain(`<div class="qf-srow is-static is-danger" role="alert"><span class="tx">${LAST}`);
        expect(s).toContain('<span class="qf-status qf-status--fail"><i></i>LOGIN_LAST_PASSKEY</span>');
        expect(s).toContain(ADD);
      }
      const recovery = stage(`${t}-recovery`);
      expect(passkeyRows(recovery)).toEqual([]);
      expect(recovery).toContain(RECOVERY_SIGNIN);
      expect(recovery).toContain("PASSKEY_REQUIRED");
      expect(recovery).toContain(ADD);
      const member = stage(`${t}-member`);
      expect(passkeyRows(member)).toEqual([]);
      expect(member).toContain(MEMBER);
      expect(member).toContain("LOGIN_OWNER_REQUIRED");
      expect(member).not.toContain(ADD);
      expect(stage(`${t}-phone`)).toContain('<div class="qf-vp" style="width:390px;max-width:390px"><div class="qf-set is-pane">');
      expect(stage(`${t}-phone-refuse`)).toContain('<div class="qf-vp" style="width:390px;max-width:390px"><div class="qf-set is-pane">');
    }
  });

  it("draws no key, counter, transport, device name or recovery code: a passkey row says Passkey and a date, nothing else", () => {
    const rows = specimen.match(/<span class="tx">Passkey<span class="sub">[^<]*<\/span>/g) ?? [];
    expect(rows.length).toBe(12);
    for (const r of rows) expect(r).toMatch(/<span class="sub">Added \d{1,2} [A-Z][a-z]+ \d{4}<\/span>$/);
    const drawn = specimen.replace(/<!--[\s\S]*?-->/g, "");
    expect(drawn).not.toMatch(/\b(credential id|counter|transport|usb|nfc|ble|hybrid|internal)\b/i);
    expect(drawn).not.toMatch(/\b[A-Z0-9]{4}(-[A-Z0-9]{4}){2,}\b/);
  });
});
