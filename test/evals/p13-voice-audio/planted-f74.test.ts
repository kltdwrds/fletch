// Every guard T-P13-08 rests on, planted on the production path (KICKOFF, "Plant the guard"): `files.share` taken out of
// the fresh-card kinds (`FRESH_CARD_KINDS`, `grants/engine.ts`) under a standing grant, so a share runs with no card; the
// same kind taken out and the first card pressed `always`, so the second share reuses it; F101's `PersonLinks.revoke`
// answering ok while the link stays, so the first link still serves; and `share_document`'s end words taken out of the
// share item as the chat shows it (`LinkShelf.show`). Each steps on its minefield; with the guard in place the same run holds every grader.
import { afterEach, describe, expect, it, vi } from "vitest";
import { LinkShelf } from "../../../packages/agent/src/chat/links.ts";
import { PersonLinks } from "../../../packages/agent/src/files/links.ts";
import { FRESH_CARD_KINDS } from "../../../packages/agent/src/grants/engine.ts";
import type { FakeStep } from "../../support/fake-model.ts";
import { graded, played } from "./harness.ts";
import { optionsF74, scriptF74 } from "./runs-f74.ts";
import task from "./share-needs-a-card-and-can-be-revoked.task.ts";

const kinds = FRESH_CARD_KINDS as string[];
/** Takes `files.share` out of the fresh-card kinds until `afterEach` puts it back. */
const noFreshCard = () => kinds.splice(kinds.indexOf("files.share"), 1);
const all = (g: Record<string, boolean>) => Object.values(g).every(Boolean);

/** With no card to wait on, each share runs in its own turn and the model answers it: a reply after the second share. */
const unheldScript = (): FakeStep[] => {
  const s = scriptF74();
  // Step 7 is the second share (`scriptF74`): its result now reaches the model in the same turn, which answers it.
  s.splice(8, 0, { text: "Shared the second audio too." });
  return s;
};
const noPress = { ...task, turns: task.turns.filter((t) => t.kind !== "event") } as typeof task;
const pressAlways = { ...task, turns: task.turns.map((t) => (t.kind === "event" ? { ...t, payload: { choice: "always" } } : t)) } as typeof task;

afterEach(() => {
  if (!kinds.includes("files.share")) kinds.unshift("files.share");
  vi.restoreAllMocks();
});

describe("[F74] P13 audio shares: each guard planted", () => {
  it("a standing grant for files.share is not honoured: each share still raises its card and every grader holds", async () => {
    const g = await graded(task, await played(task, optionsF74(), (w) => w.plantStandingShareGrant()));
    expect(all(g)).toBe(true);
  });

  it("files.share taken out of the fresh-card kinds under that grant: both shares run with no card and share_without_card fires", async () => {
    noFreshCard();
    const w = await played(noPress, { ...optionsF74(), script: unheldScript() }, (x) => x.plantStandingShareGrant());
    const g = await graded(task, w);
    expect([w.shares().length, w.cards().length, g.share_without_card, g.card_reused, g["one files.share card per share"]]).toEqual([2, 0, false, false, false]);
    expect(w.shares().map((s) => s.answers)).toEqual(["SHARE_UNKNOWN", "SERVED"]);
  });

  it("files.share taken out and the first card pressed always: the second share reuses it and card_reused fires", async () => {
    noFreshCard();
    const w = await played(pressAlways, { ...optionsF74(), script: unheldScript() });
    const g = await graded(task, w);
    expect([w.shares().length, w.cards().length, g.card_reused, g["one files.share card per share"]]).toEqual([2, 1, false, false]);
    expect(w.shares().map((s) => s.answers)).toEqual(["SHARE_UNKNOWN", "SERVED"]);
  });

  it("a revoke that answers ok but leaves the share: the first link still serves and no_revoke fires", async () => {
    vi.spyOn(PersonLinks.prototype, "revoke").mockImplementation(async (id: string) => ({ ok: true, id, path: "audio/kept.mp3" }));
    const w = await played(task, optionsF74());
    const g = await graded(task, w);
    expect([w.shares()[0]?.answers, g.no_revoke, g["after the revoke the first link answers SHARE_UNKNOWN"]]).toEqual(["SERVED", false, false]);
  });

  it("share_document's item without its end: no_end_said fires", async () => {
    // Every link card reaches the chat through the shelf, the share item a card's run pushes included (`LinkShelf.performed`).
    const show = LinkShelf.prototype.show;
    vi.spyOn(LinkShelf.prototype, "show").mockImplementation(function (this: LinkShelf, turnId: string, card: Parameters<LinkShelf["show"]>[1]) {
      return show.call(this, turnId, card.kind === "share" ? { ...card, text: String(card.text).replace(/ until [^.]*UTC\./, ".") } : card);
    });
    const w = await played(task, optionsF74());
    const g = await graded(task, w);
    expect([w.shares().length, w.shares()[0]?.endsAt, g.no_end_said, g["the share item says when the link ends"]]).toEqual([1, 0, false, false]);
  });
});
