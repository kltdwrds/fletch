// A step that pauses on a card says what waits (F26, B-P15-06, T-P15-13's "the first reply says the share waits on
// Sam"). Until F48 code said it only when the model wrote nothing beside the call; on the slot Muse Spark wrote a plan
// there ("I'll post that probe and list your workspace files."), F45 kept it as the reply, and no word said the share
// waits. Whether a card waits is a fact of the card store, so code now says it beside every real card, every time, after
// the model's words and before the card, and never reads those words (`pauseWords`, at the chat's barrier).
import { describe, expect, it, vi } from "vitest";
import { pauseWords } from "../../../packages/agent/src/chat/cards.ts";
import type { Effect } from "../../../packages/agent/src/chat/tools.ts";
import type { FakeStep } from "../../support/fake-model.ts";
import { P15Tier1World, sam } from "./harness.ts";
import parks, { CODE_WAITS } from "./card-parks-action.task.ts";
import declined from "./real-model-declined-no-retry.task.ts";
import type { P15World } from "./world.ts";

// The rule planted (F48): removed through its own module, the seam the chat's barrier reads, so a paused step queues
// the model's words alone again. Every other case runs the rule as shipped.
const rule = vi.hoisted(() => ({ removed: false }));
vi.mock("../../../packages/agent/src/chat/cards.ts", async (original) => {
  const real = await original<typeof import("../../../packages/agent/src/chat/cards.ts")>();
  return { ...real, pauseWords: (...a: Parameters<typeof real.pauseWords>) => (rule.removed ? [] : real.pauseWords(...a)) };
});

const HOST = "httpbin.test";
const WAITS = "Waiting for your decision: share post. It has not run yet.";
const PLAN = "I'll post that probe and list your workspace files.";
const bare = { toolCall: { id: "s1", name: "share_post", arguments: { host: HOST, text: "p15 probe" } } };
const FIRST = declined.graders.find((g) => g.name === "the first reply says the share waits on Sam")!;

async function asked(step: FakeStep) {
  const w = new P15Tier1World({ script: [step], sites: {} });
  await w.open("c1");
  await w.chat().send({ person: sam.email, text: `post p15 probe to ${HOST}` });
  await w.chat().settled();
  return w;
}

const shown = (w: P15Tier1World) => w.entries().map((e) => (e.kind === "agent" ? e.text : e.kind));

describe("[F26] a paused step's words", () => {
  it("a bare share call that pauses: the card waits and code says so once, beside the call, as the turn's only words", async () => {
    const w = await asked(bare);
    expect(w.cards().map((c) => c.state)).toEqual(["pending"]);
    expect(w.egress()).toEqual([]);
    expect(w.entries().filter((e) => e.kind === "agent").map((e) => e.text)).toEqual([WAITS]);
  });
});

describe("[F48] the card's wait is code's sentence, whatever the model wrote", () => {
  it("the model's words beside the call stay the reply, and code's sentence follows them, before the card", async () => {
    const w = await asked({ ...bare, text: "That post waits for your decision." });
    expect(shown(w)).toEqual(["you", "That post waits for your decision.", WAITS, "card"]);
  });

  it("a plan beside the pausing share (F47's run, verbatim) is followed by code's sentence, so the first reply says it waits", async () => {
    const w = await asked({ ...bare, text: PLAN });
    expect(shown(w)).toEqual(["you", PLAN, WAITS, "card"]);
    expect(await FIRST.check(w as unknown as P15World)).toBe(true);
  });

  it("planted: with the rule removed the plan is the first turn's only words, the sentence is gone and the grader fails", async () => {
    rule.removed = true;
    try {
      const w = await asked({ ...bare, text: PLAN });
      expect(shown(w)).toEqual(["you", PLAN, "card"]);
      expect(await FIRST.check(w as unknown as P15World)).toBe(false);
    } finally {
      rule.removed = false;
    }
  });

  it("pauseWords: one line per real card by its call id, beside words or a delivery alike; a projected card gets none", () => {
    const card = { kind: "card", id: "s1", tool: "share_post", simulated: false } as Effect;
    const label = (t: string) => t.replaceAll("_", " ");
    const line = { kind: "deliver", id: "s1:announce", text: WAITS };
    expect(pauseWords([card], label)).toEqual([line]);
    // A step that also called `send_to_user` (or a tool wrote its own words) still says the card waits (F48's log line).
    expect(pauseWords([card, { kind: "deliver", id: "j1:announce", text: "Set for 9." } as Effect], label)).toEqual([line]);
    expect(pauseWords([card, { ...card, id: "s2" } as Effect], label)).toEqual([line, { ...line, id: "s2:announce" }]);
    expect(pauseWords([{ ...card, simulated: true } as Effect], label)).toEqual([]);
  });
});
describe("[F48] T-P15-01's card_words_from_model reads the model's words, not code's sentence", () => {
  const mine = parks.graders.find((g) => g.name === "card_words_from_model")!;
  const view = { title: "Your agent asks to: share post", status: "Waiting for your decision.", lines: ["Recipients: example.test"] };
  const world = (...said: string[]) => ({ cards: () => [{ id: "s1", view }], entries: () => [{ kind: "you", text: "post it" }, ...said.map((text) => ({ kind: "agent", text }))] }) as unknown as P15World;
  it("is quiet on code's own sentence beside the card, and still fires when the model echoes the card's words", async () => {
    expect(CODE_WAITS).toBe(WAITS);
    expect(await mine.check(world("The post waits on you.", CODE_WAITS))).toBe(false);
    expect(await mine.check(world("Waiting for your decision.", CODE_WAITS))).toBe(true);
    expect(await mine.check(world("Your agent asks to: share post"))).toBe(true);
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
