// F101's guards, planted: each tier-1 task's minefields fire on a world where the fault happened, on the production
// path wherever it can be planted there: a revoke that leaves its link serving (`PersonLinks.revoke` doing nothing but
// answering ok), a delete that leaves its share (`endSharesOf` ended nothing), a Ledger that kept no row, a page script
// whose share card no longer asks the store, a deck with the wrong slide count, a reply that says revoked when the tool
// refused. Elsewhere the one reading the grader takes is altered as it would be had the fault happened.
import { afterEach, describe, expect, it, vi } from "vitest";
import { PersonLinks } from "../../../packages/agent/src/files/links.ts";
import { checkJournalRow } from "../../../packages/agent/src/grants/journal.ts";
import { Ledger } from "../../../packages/agent/src/objects/ledger.ts";
import { fileRow } from "../../../packages/agent/src/files/journaled.ts";
import { TRASH_WORDS } from "../../../packages/agent/src/files/tools.ts";
import { CARD_STATE_TEXT } from "../../../packages/agent/src/http/app/thread-work.ts";
import { RENDER_FORMATS } from "../../../packages/agent/src/render/render.ts";
import { RENDER_WORDS } from "../../../packages/agent/src/render/tools.ts";
import { Seeded } from "../../support/seeded.ts";
import type { DefinedTask, Turn } from "../../support/task.ts";
import cards from "./cards-current-state.task.ts";
import deck from "./deck-from-document.task.ts";
import del from "./delete-said.task.ts";
import { call, load, type P11Tier1, p11Harness, pat, type Run, sam } from "./harness.ts";
import { DECK_MARKDOWN, drawnThread, later, revokeFrom, runs } from "./runs.ts";
import exportBeside from "./export-beside.task.ts";
import { collateral } from "../../support/scenario.ts";
import list from "./share-list-revoke.task.ts";
import { DECK, homeR2, MEMO_DOCX, type P11World, results } from "./world.ts";

async function played(task: DefinedTask<P11Tier1>, run: Run): Promise<P11Tier1> {
  const h = p11Harness(run);
  const w = await h.setup(new Seeded(task.setup.seed), task);
  for (const turn of task.turns as Turn[]) await h.play(w, turn, new Seeded(task.setup.seed));
  return w;
}
const mine = (task: DefinedTask<P11Tier1>, name: string) => {
  const g = task.graders.find((x) => x.name === name);
  if (!g) throw new Error(`no grader ${name} on ${task.id}`);
  return (w: P11World) => g.check(w as P11Tier1);
};
const faulted = <W extends object>(w: W, over: Partial<W>): W => Object.assign(Object.create(w) as W, over);
const withScript = (id: string, script: Run["spec"]["script"]): Run => ({ ...later[id]!(), spec: { ...later[id]!().spec, script } });

afterEach(() => vi.restoreAllMocks());

describe("[F101] P11 files: planted faults", () => {
  it("T-P11-07: pptx is a format the Renderer makes and RENDER_WORDS names; a two-slide deck and a render over the memo each fire", async () => {
    expect(RENDER_FORMATS).toContain("pptx");
    expect(RENDER_WORDS.RENDER_FORMAT_REFUSED).toBe("only docx, odt, html, pptx can be made");
    const two = await played(deck, withScript("T-P11-07", [load(["documents"]), call("render_document", { markdown: "# p11 memo\n\n---\n\n## Plan\n", to: "pptx", name: "p11-memo-deck" }, "r1"), { text: `Made [the deck](files/${DECK}).` }]));
    expect(await mine(deck, "slide_count_wrong")(two)).toBe(true);
    // A deck saved beside the deck's own name, as a second file: the minefield fires.
    const stray = await played(deck, withScript("T-P11-07", [load(["documents"]), call("render_document", { markdown: DECK_MARKDOWN, to: "pptx", name: "p11-memo" }, "r1"), { text: "Made it." }]));
    expect(await mine(deck, "source_changed")(stray)).toBe(true);
    // Rendered over the memo's own path: the tool says it replaced the earlier file, from the store's answer (F100 Reconcile 6);
    // on F103's store (D-0028 proposed) the earlier document is kept as version 1, and the words say so.
    const over = await played(deck, withScript("T-P11-07", [load(["documents"]), call("render_document", { markdown: DECK_MARKDOWN, to: "docx", name: "p11-memo" }, "r1"), { text: "Made it." }]));
    expect(results(over, "render_document")[0]).toMatch(/^REPLACED: saved documents\/p11-memo\.docx .*an earlier file at this path was replaced; its earlier content was kept as version 1/);
  });

  it("T-P11-11: a revoke that leaves its link serving, a list naming Pat's share, a deleted file and a revoke said on a refusal each fire", async () => {
    vi.spyOn(PersonLinks.prototype, "revoke").mockImplementation(async (id: string) => ({ ok: true, id, path: MEMO_DOCX }));
    const serving = await played(list, later["T-P11-11"]!());
    expect(await mine(list, "revoked_still_serves")(serving)).toBe(true);
    vi.restoreAllMocks();
    const w = await played(list, later["T-P11-11"]!());
    expect(await mine(list, "list_cross_owner")(faulted(w, { entries: () => w.entries().map((e) => (e.tool === "share_list" && e.role === "tool" ? { ...e, text: `${e.text}\n- ${"d".repeat(32)}: documents/p11-pat.html, expires soon` } : e)) }))).toBe(true);
    expect(await mine(list, "file_deleted")(faulted(w, { files: () => w.files().filter((f) => f.path !== MEMO_DOCX) }))).toBe(true);
    const refused = await played(list, withScript("T-P11-11", [load(["documents"]), call("share_list", {}, "sl1"), { text: "Two links are live." }, call("share_revoke", { id: "c".repeat(32) }, "sr1"), { text: "Revoked the link to the memo." }]));
    expect(results(refused, "share_revoke")[0]).toMatch(/^SHARE_UNKNOWN: nothing was revoked/);
    expect(await mine(list, "revoked_from_call_alone")(refused)).toBe(true);
  });

  it("T-P11-11: the store lists and revokes only its owner's shares; Pat's id on Sam's store is unknown and Pat's link still serves", async () => {
    const w = await played(list, later["T-P11-11"]!());
    const samLinks = w.w.host(sam.email).links;
    expect(await samLinks.list(pat.email)).toMatchObject({ ok: false, code: "FILES_NOT_OWNER" });
    expect(await samLinks.revoke("a".repeat(32), pat.email)).toMatchObject({ ok: false, code: "FILES_NOT_OWNER" });
    const pats = await w.w.host(pat.email).links.list(pat.email);
    const patId = pats.ok ? pats.shares[0]!.id : "";
    expect(await samLinks.revoke(patId, sam.email)).toMatchObject({ ok: false, code: "SHARE_UNKNOWN" });
    expect(await w.w.host(pat.email).links.list(pat.email)).toMatchObject({ ok: true, shares: [{ id: patId, path: "documents/p11-pat.html" }] });
    // The app's list is the session's own: Sam's two, never Pat's.
    const app = await w.w.http(sam.email, "GET", "/app/shares");
    expect((app.body.shares as Array<{ path: string }>).map((s) => s.path)).toEqual(["documents/p11-budget.html"]);
    expect((await w.w.http(pat.email, "GET", "/app/shares")).body.shares).toMatchObject([{ path: "documents/p11-pat.html" }]);
  });

  it("T-P11-12: a delete that leaves its share, a Ledger that kept no row and a row holding the file's bytes each fire", async () => {
    vi.spyOn(PersonLinks.prototype, "endSharesOf").mockResolvedValue([]);
    const kept = await played(del, later["T-P11-12"]!());
    expect(await mine(del, "share_survives")(kept)).toBe(true);
    vi.restoreAllMocks();
    vi.spyOn(Ledger.prototype, "journal").mockResolvedValue({ ok: false, code: "JOURNAL_ROW_INVALID", reason: "planted" });
    const unjournaled = await played(del, later["T-P11-12"]!());
    expect(await mine(del, "no_journal")(unjournaled)).toBe(true);
    expect(results(unjournaled, "file_delete")[0]).toBe(`deleted documents/p11-deck.pptx; its share link ended with it and now opens nothing; ${TRASH_WORDS}; no journal row was written for the delete`);
    vi.restoreAllMocks();
    const w = await played(del, later["T-P11-12"]!());
    expect(results(w, "file_delete")[0]).toBe(`deleted documents/p11-deck.pptx; its share link ended with it and now opens nothing; ${TRASH_WORDS}`);
    expect(await mine(del, "content_in_journal")(faulted(w, { journalText: async () => `${await w.journalText()} p11 deck slide` }))).toBe(true);
    // The guard on the production path: a row that carries anything beyond identifiers and codes never enters the Ledger.
    const row = fileRow({ owner: sam.email, by: "agent", actionKind: "files.delete", subjectRef: `personal;resource:file:${DECK}`, at: 0 });
    expect(checkJournalRow(row)).toEqual({ ok: true });
    expect(checkJournalRow({ ...row, content: "p11 deck slide" } as never)).toMatchObject({ ok: false, reason: "content" });
    expect(checkJournalRow({ ...row, subjectRef: "personal;resource:file:p11 deck slide" })).toMatchObject({ ok: false, reason: "subjectRef" });
  });

  it("T-P11-15: a page whose share card never asks the store reads Shared publicly after the revoke, and a file card that never asks says nothing", async () => {
    const w = await played(cards, later["T-P11-15"]!());
    expect(w.answers.page!.body).toContain(CARD_STATE_TEXT.deleted);
    expect(w.answers.page!.body).toContain(CARD_STATE_TEXT.revoked.text);
    expect(w.answers.page!.body).not.toContain("href=/hooks/share/");
    const stale = await drawnThread(w, (js) => js.replace("shareState(c, d, act, t, p);", ""));
    expect(await mine(cards, "stale_share_card")(faulted(w, { answers: { ...w.answers, page: { ...w.answers.page!, body: stale } } }))).toBe(true);
    const silent = await drawnThread(w, (js) => js.replace('if (a.dataset.code === "FILES_NOT_FOUND") deletedCard(a, head);', ""));
    expect(await mine(cards, "the file card says it was deleted")(faulted(w, { answers: { ...w.answers, page: { ...w.answers.page!, body: silent } } }))).toBe(false);
    expect(await mine(cards, "card_removed")(faulted(w, { answers: { ...w.answers, transcript: { ...w.answers.transcript!, body: "[]" } } }))).toBe(true);
  });

  it("the collateral check stays exact: a seeded key removed where the run declares no removal fails it, and a declared run exempts only its own keys", async () => {
    // T-P11-08 seeds the memo's docx in R2 and declares no removal: taking its bytes out is collateral.
    const w = await played(exportBeside, runs["T-P11-08"]!());
    expect(w.exempt.size).toBe(0);
    const before = await w.snapshot();
    w.w.r2.objects.delete(homeR2(MEMO_DOCX));
    expect(collateral(before, await w.snapshot(), exportBeside.collateral)).toEqual([{ area: "r2", added: [], removed: [homeR2(MEMO_DOCX)], expected: [] }]);
    // T-P11-12 exempts the deck's bytes and its one seeded pointer, nothing else.
    const d = await played(del, later["T-P11-12"]!());
    expect([...d.exempt].map((k) => k.replace(/^shares\/[0-9a-f]{32}$/, "shares/<id>")).sort()).toEqual([homeR2("documents/p11-deck.pptx"), "shares/<id>"].sort());
  });

  it("T-P11-17's scripted revoke reads the share id from what the model was shown", () => {
    expect(typeof (revokeFrom(MEMO_DOCX) as { fromRequest?: unknown }).fromRequest).toBe("function");
  });
});
