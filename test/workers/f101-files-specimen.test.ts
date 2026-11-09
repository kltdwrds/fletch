// P11, before F101 draws anything: the specimen `ds/specimens/files.html` settles the Library item (kind, last change,
// size), the chat's file card deleted and the share card revoked and expired, from the step-10 and step-11 captures. These
// read the specimen's markup against what the page serves: its classes are the page's own, and every state's words are
// the page's word table (`CARD_STATE_TEXT`), so the drawing and the specimen cannot drift apart. The look is Kyle's.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DS_DIR } from "../../scripts/ds-tokens.ts";
import { CARD_STATE_TEXT, THREAD_WORK_SCRIPT } from "../../packages/agent/src/http/app/thread-work.ts";
import { LIBRARY_TEXT } from "../../packages/agent/src/http/app/library.ts";
import { PAGE_CSS } from "../../packages/agent/src/http/page.ts";

const specimen = readFileSync(`${DS_DIR}/specimens/files.html`, "utf8");
/** Every class a selector in the served CSS names. */
const defined = new Set([...PAGE_CSS.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/\.([a-zA-Z_][\w-]*)/g)].map((m) => m[1] as string));
const undefinedClasses = (html: string) => [...new Set([...html.matchAll(/\sclass="([^"]*)"/g)].flatMap((m) => (m[1] as string).split(/\s+/).filter(Boolean)))].filter((c) => !defined.has(c)).sort();
/** Whether a stage draws a share card in an ended state with the table's title and words. */
const says = (html: string, s: "revoked" | "expired") => html.includes(`<h3>${CARD_STATE_TEXT[s].title}</h3><p>${CARD_STATE_TEXT[s].text}</p>`);
const stage = (id: string) => specimen.match(new RegExp(`<div class="qf-stage" id="${id}">([\\s\\S]*?)\\n</div></div>`))?.[1] ?? "";

describe("[F101] the files specimen: the Library item and the cards drawn from the store", () => {
  it("links the design system's sheets and names only classes the page serves", () => {
    expect(specimen).toContain('href="../../prototype/ds/qyvr-fletch/tokens.css"');
    expect(specimen).toContain('href="../components/bundle.css"');
    expect(undefinedClasses(specimen)).toEqual([]);
  });

  it("planted: a class the page does not serve fails it", () => {
    expect(undefinedClasses(specimen.replace('class="t-foot t-2"', 'class="qf-planted"'))).toEqual(["qf-planted"]);
  });

  it("each state says the page's own words: deleted, revoked, expired; neither ended card has a link", () => {
    expect(stage("light-file-deleted")).toContain(CARD_STATE_TEXT.deleted);
    expect(stage("light-file-deleted")).not.toContain("href=");
    for (const s of ["revoked", "expired"] as const) {
      expect(says(stage(`light-share-${s}`), s)).toBe(true);
      expect(stage(`light-share-${s}`)).not.toContain("href=");
    }
    expect(stage("light-share")).toContain("Shared publicly: p11-memo.docx");
    // The page draws from the same table the specimen quotes.
    expect(THREAD_WORK_SCRIPT).toContain(JSON.stringify(CARD_STATE_TEXT));
  });

  it("the Library item carries kind, last change and size, the columns the Library heads", () => {
    expect(stage("light-library").match(/class="m"/g)?.length).toBe(6);
    expect(Object.values(LIBRARY_TEXT.head)).toEqual(["Name", "Type", "Last modified", "Size"]);
  });

  it("planted: a specimen whose revoked card still reads Shared publicly fails", () => {
    const stale = stage("light-share-revoked").replace(`<h3>${CARD_STATE_TEXT.revoked.title}</h3>`, "<h3>Shared publicly: p11-memo.docx</h3>");
    expect(stale).not.toBe(stage("light-share-revoked"));
    expect(says(stale, "revoked")).toBe(false);
  });
});
