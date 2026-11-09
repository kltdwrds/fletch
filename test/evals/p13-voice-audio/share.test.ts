// Tier 1 of T-P13-08 (F74): Sam's real chat with speech on over the fake speech binding and the production `documents`
// namespace over her real `PersonLinks` (`harness.ts`); two audio files rendered by `speak`, the first shared behind its
// `files.share` card and pressed, the second shared behind its own card, the first revoked by F101's `share_revoke`.
// Each share link the chat drew is opened with no session after every turn, through the production `serve`.
import { describe, expect, it } from "vitest";
import { Seeded } from "../../support/seeded.ts";
import { graded, p13Harness, type P13Tier1World, pat, played } from "./harness.ts";
import { optionsF74 } from "./runs-f74.ts";
import task from "./share-needs-a-card-and-can-be-revoked.task.ts";

describe("[F74] P13 audio shares: a card for each share and the revoke", () => {
  it("T-P13-08 holds every grader", async () => {
    const g = await graded(task, await played(task, optionsF74()));
    expect(g).toEqual(Object.fromEntries(Object.keys(g).map((k) => [k, true])));
  });

  it("no link before the press; after it the first link serves, its card named the file and its lifetime; the revoke ends it", async () => {
    const h = p13Harness(optionsF74());
    const w = (await h.setup(new Seeded(task.setup.seed), task)) as P13Tier1World;
    const [first, second] = w.audio().map((a) => a.path);
    expect([w.audio().length, first?.startsWith("audio/"), second?.startsWith("audio/")]).toEqual([2, true, true]);
    const [share1, press, share2, revoke] = task.turns as [never, never, never, never];
    await h.play(w, share1, new Seeded(1));
    expect([w.shares().length, w.cards().map((c) => [c.kind, c.pressed])]).toEqual([0, [["files.share", false]]]);
    expect(w.cards()[0]?.lines).toEqual(["Connector: files", `File: ${first}`, "Anyone with the link can open it for 24 hours."]);
    await h.play(w, press, new Seeded(1));
    expect(w.shares().map((s) => [s.path, s.answers])).toEqual([[first, "SERVED"]]);
    // The share item names its end: a day from the press, to the minute (`share_document`'s `until … UTC`).
    const day = w.w.clock.now + 24 * 60 * 60_000;
    expect(day - (w.shares()[0]?.endsAt ?? 0)).toBeGreaterThanOrEqual(0);
    expect(day - (w.shares()[0]?.endsAt ?? 0)).toBeLessThan(60_000);
    await h.play(w, share2, new Seeded(1));
    expect(w.cards().map((c) => [c.kind, c.pressed, c.lines.find((l) => l.startsWith("File: "))])).toEqual([["files.share", true, `File: ${first}`], ["files.share", false, `File: ${second}`]]);
    expect(w.shares().length).toBe(1);
    await h.play(w, revoke, new Seeded(1));
    expect(w.shares().map((s) => [s.path, s.answers])).toEqual([[first, "SHARE_UNKNOWN"]]);
    // The file itself stays, and the second card still waits: a typed message decides nothing.
    expect([w.audio().every((a) => !a.removed), w.cards()[1]?.pressed]).toEqual([true, false]);
    // A share is a public link, sent to no one: Pat Solo's session holds no card and no share of it.
    expect(w.w.cardsOf(pat.email)).toEqual([]);
  });
});
