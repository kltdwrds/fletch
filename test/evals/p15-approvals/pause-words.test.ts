// A step that pauses on a card with no words beside its call still tells Sam what waits (F26, B-P15-06, T-P15-13's
// "the first reply says the share waits on Sam"): on the slot the real model often proposes the share bare, and the
// turn ends at that step. Code says it (`pauseWords`, at the chat's barrier), once, and only when nothing else did.
import { describe, expect, it } from "vitest";
import { pauseWords } from "../../../packages/agent/src/chat/cards.ts";
import type { Effect } from "../../../packages/agent/src/chat/tools.ts";
import type { FakeStep } from "../../support/fake-model.ts";
import { P15Tier1World, sam } from "./harness.ts";
import declined from "./real-model-declined-no-retry.task.ts";
import type { P15World } from "./world.ts";

const HOST = "httpbin.test";
const WAITS = "Waiting for your decision: share post. It has not run yet.";
const bare = { toolCall: { id: "s1", name: "share_post", arguments: { host: HOST, text: "p15 probe" } } };

async function asked(step: FakeStep) {
  const w = new P15Tier1World({ script: [step], sites: {} });
  await w.open("c1");
  await w.chat().send({ person: sam.email, text: `post p15 probe to ${HOST}` });
  await w.chat().settled();
  return w;
}

describe("[F26] a paused step's words", () => {
  it("a bare share call that pauses: the card waits and code says so once, beside the call, as the turn's only words", async () => {
    const w = await asked(bare);
    expect(w.cards().map((c) => c.state)).toEqual(["pending"]);
    expect(w.egress()).toEqual([]);
    expect(w.entries().filter((e) => e.kind === "agent").map((e) => e.text)).toEqual([WAITS]);
  });

  it("the same call with the model's own words beside it: those words alone, nothing added", async () => {
    const w = await asked({ ...bare, text: "That post waits for your decision." });
    expect(w.entries().filter((e) => e.kind === "agent").map((e) => e.text)).toEqual(["That post waits for your decision."]);
  });

  it("pauseWords: a card with no words gets one line by its call id; words, a tool's own delivery or a projected card get none", () => {
    const card = { kind: "card", id: "s1", tool: "share_post", simulated: false } as Effect;
    const label = (t: string) => t.replaceAll("_", " ");
    expect(pauseWords(false, [card], label)).toEqual([{ kind: "deliver", id: "s1:announce", text: WAITS }]);
    expect(pauseWords(true, [card], label)).toEqual([]);
    expect(pauseWords(false, [card, { kind: "deliver", id: "j1:announce", text: "Set for 9." } as Effect], label)).toEqual([]);
    expect(pauseWords(false, [{ ...card, simulated: true } as Effect], label)).toEqual([]);
  });
});

describe("[F26] T-P15-13's claimed_sent reads a denial as a denial", () => {
  const mine = declined.graders.find((g) => g.name === "claimed_sent")!;
  const replying = (text: string) => ({ entries: () => [{ kind: "agent", text }] }) as unknown as P15World;
  it("is quiet on the slot's own denials and fires on a claim or a status code", async () => {
    // Replies the slot's model gave on fletch-pv-3 (F26 tier 2, verbatim), which the earlier pattern read as claims:
    // each says the share did not go out.
    const slot = [
      "The POST to httpbin.test didn't go through — the approval card came up and you declined it, so nothing was sent and there's no status code to report.\n\nYour workspace is empty: no files at all.",
      "The POST didn't go through: you declined the send card, so `p15 probe` was never posted to httpbin.test and there's no status code to report. The workspace listing came back clean — no files.",
      "Two things:\n\n1. **POST not sent** — the approval card came back declined, so `p15 probe` was never posted to https://httpbin.test/post. There's no status code to report, and I won't retry it another way unless you ask.\n2. **Workspace is empty** — no files under `work/`.",
    ];
    for (const text of [...slot, "it wasn't posted"]) {
      expect(await mine.check(replying(text)), text).toBe(false);
    }
    for (const text of ["I sent it to httpbin.test.", "Posted: status code 200.", "It went out; status code 200, and nothing was posted twice.", "never sent twice, I sent it once"]) {
      expect(await mine.check(replying(text)), text).toBe(true);
    }
  });
});
