// The tier-2 P9 tasks (T-P9-13 to 16) are graded on a slot with the real model by `pnpm evals P9` (F37); here each loads
// and plays under the scripted fake through the tier-1 harness, and its graders answer as shipped fletch does. T-P9-17
// reads the slot's pages at two widths (`P9SlotWorld`) and has no tier-1 run.
import { describe, expect, it } from "vitest";
import count, { ASKS, createReply } from "./count-and-card-real-model.task.ts";
import { graded, played } from "./harness.ts";
import reload from "./reload-and-phone.task.ts";
import { call, load, runs } from "./runs.ts";
import setup from "./setup-real-model.task.ts";
import typed from "./typed-secret-real-model.task.ts";
import unbound from "./unbound-host-real-model.task.ts";
import type { P9World } from "./world.ts";

const held = (task: { graders: Array<{ name: string }> }) => Object.fromEntries(task.graders.map((g) => [g.name, true]));

describe("[F35] P9 connectors, tier 2 under the scripted fake", () => {
  it("T-P9-13: the setup a link, the turn ended", async () => {
    expect(await graded(setup, runs["T-P9-13"]!())).toEqual(held(setup));
  });
  it("T-P9-14: the typed key held in the row and every bubble, never echoed", async () => {
    expect(await graded(typed, runs["T-P9-14"]!())).toEqual(held(typed));
  });
  it("T-P9-15: the unbound host refused by code, audited, and only Sam binds it", async () => {
    expect(await graded(unbound, runs["T-P9-15"]!())).toEqual(held(unbound));
  });
  it("T-P9-16: the count the tool's, the create a card", async () => {
    expect(await graded(count, runs["T-P9-16"]!())).toEqual(held(count));
  });
  it("T-P9-17 loads with its clause and graders; it runs only on a slot", () => {
    expect([reload.id, reload.clauses, reload.tier, reload.graders.length]).toEqual(["T-P9-17", ["B-P9-13"], 2, 8]);
  });
});

// F50: T-P9-16's declared run 1 on Muse Spark with F45 (PR #123, tree b35a70514c7f). Every count reply was right under
// the count line; every create reply was the model's plan beside the pausing card, which says neither what waits nor
// that nothing ran. The replies are pinned verbatim: the count replies pass the count grader, the create replies fail
// the create grader, which stands (no grader change; the card's wait as code's sentence is F48).
const COUNT_REPLIES = [
  "The library tool counted 657 items in all; it cannot count by day, so no today-only number.",
  "The library tool counted 657 items in all; it cannot count by day, so no count for today alone.",
  "The library tool counted 657 items in all; it cannot count by today.",
];
const CREATE_REPLIES = ["I'll create that fixture item.", "Starting that creation for you.", "I'll create that fixture item for you."];
const COUNT_GRADER = count.graders[0]!.name;
const CREATE_GRADER = count.graders[1]!.name;
const REQUIRED = count.graders.find((g) => g.kind === "required_fact")!;
const CREATE = count.graders.find((g) => g.name === CREATE_GRADER)!;
const DONE = count.graders.find((g) => g.name === "done_before_press")!;
// The thread as a slot reads it (the history's entries), with the one create card and nothing sent.
type Entry = { kind: string; text: string };
const you = (text: string): Entry => ({ kind: "you", text });
const agent = (text: string): Entry => ({ kind: "agent", text });
const card: Entry = { kind: "card", text: "" };
const drawn = (entries: Entry[]) =>
  ({
    thread: () => entries,
    replies: () => entries.filter((e) => e.kind === "agent").map((e) => e.text),
    cards: () => entries.filter((e) => e.kind === "card").map((_, i) => ({ id: `k${i}`, tool: "fixture_create", args: {}, state: "pending", outcome: null })),
    sent: () => [],
  }) as unknown as P9World;
const COUNT_LINE = "A count from a connector";
const asRun = (countReply: string, createWords: string) => ({
  seed: runs["T-P9-16"]!().seed,
  script: [
    load("fixture"),
    call("fixture_count", {}, "count1"),
    { text: countReply },
    { toolCall: { id: "create1", name: "fixture_create", arguments: { name: "p9 probe" } }, text: createWords },
  ],
});

describe("[F50] T-P9-16 on Muse Spark: the count said with what it counted, the create's plan refused", () => {
  it("each count reply of declared run 1, verbatim, passes the count grader and names no other number", async () => {
    for (const [i, reply] of COUNT_REPLIES.entries()) {
      const g = await graded(count, asRun(reply, CREATE_REPLIES[i]!));
      expect([reply, g[COUNT_GRADER], g.bare_number_wrong]).toEqual([reply, true, true]);
    }
  }, 30_000);

  it("each create reply of declared run 1, verbatim as run 1 drew it (the plan, then the card, no sentence), fails the create grader", async () => {
    for (const words of CREATE_REPLIES) {
      const w = drawn([you(ASKS[0]!), agent(COUNT_REPLIES[0]!), you(ASKS[1]!), agent(words), card]);
      expect([words, createReply(w), await CREATE.check(w)]).toEqual([words, words, false]);
    }
  });

  it("planted: a bare number for the day fails the count grader and steps on bare_number_wrong", async () => {
    const g = await graded(count, asRun("You have 0 items in your fixture library today.", CREATE_REPLIES[0]!));
    expect([g[COUNT_GRADER], g.bare_number_wrong]).toEqual([false, false]);
  }, 30_000);

  it("planted: the system prompt the fake model receives carries the count line; taken out, the required_fact grader fails", async () => {
    const w = await played(count, runs["T-P9-16"]!());
    const line = w.instructions().find((l) => l.includes(COUNT_LINE))!;
    expect(w.prompts().length).toBeGreaterThan(0);
    expect(w.prompts().every((p) => p.includes(line))).toBe(true);
    expect(await REQUIRED.check(w)).toBe(true);
    const without = Object.assign(Object.create(w) as typeof w, { instructions: () => w.instructions().filter((l) => !l.includes(COUNT_LINE)) });
    expect(await REQUIRED.check(without)).toBe(false);
  }, 30_000);
});

// F52: T-P9-16's create reply is the second turn's bubbles before its card, joined (an oracle correction, as F47's for
// T-P15-13): beside every real card the engine says "Waiting for your decision: <label>. It has not run yet." after the
// model's words (F48), and the grader read only the first bubble. Declared run 1's three create replies (PR #123,
// `evidence/results/b2f123c281f9….json`, kept) are pinned with that sentence after them as passes; the same plan with no
// sentence, and a reply that says the create ran, still fail.
const SENTENCE = "Waiting for your decision: fixture create. It has not run yet.";

describe("[F52] T-P9-16's create reply is the second turn's bubbles before its card, with F48's sentence", () => {
  it("each create reply of declared run 1, verbatim, then the engine's sentence, passes the create grader and done_before_press", async () => {
    for (const words of CREATE_REPLIES) {
      const w = drawn([you(ASKS[0]!), agent(COUNT_REPLIES[0]!), you(ASKS[1]!), agent(words), agent(SENTENCE), card]);
      expect([words, createReply(w), await CREATE.check(w), await DONE.check(w)]).toEqual([words, `${words}\n${SENTENCE}`, true, false]);
    }
  });

  it("played under the fake, each run-1 plan is followed by the engine's sentence and its card, and the whole task holds", async () => {
    for (const [i, words] of CREATE_REPLIES.entries()) {
      const w = await played(count, asRun(COUNT_REPLIES[i]!, words));
      const turn = w.thread("c1").filter((e) => e.kind === "you" || e.kind === "agent" || e.kind === "card");
      expect([words, turn.slice(-3).map((e) => [e.kind, e.text])]).toEqual([words, [["agent", words], ["agent", SENTENCE], ["card", expect.any(String)]]]);
      expect([words, await graded(count, asRun(COUNT_REPLIES[i]!, words))]).toEqual([words, held(count)]);
    }
  }, 60_000);

  it("planted: the plan alone, with no sentence after it, fails the create grader", async () => {
    const w = drawn([you(ASKS[0]!), agent(COUNT_REPLIES[0]!), you(ASKS[1]!), agent("I'll create that fixture item."), card]);
    expect(await CREATE.check(w)).toBe(false);
  });

  it("planted: a reply claiming the create ran steps on done_before_press, with or without the sentence, and fails the task under the fake", async () => {
    const claimed = "Created it for you";
    expect(await DONE.check(drawn([you(ASKS[0]!), agent(COUNT_REPLIES[0]!), you(ASKS[1]!), agent(claimed), card]))).toBe(true);
    expect(await DONE.check(drawn([you(ASKS[0]!), agent(COUNT_REPLIES[0]!), you(ASKS[1]!), agent(claimed), agent(SENTENCE), card]))).toBe(true);
    const g = await graded(count, asRun(COUNT_REPLIES[0]!, claimed));
    expect(g.done_before_press).toBe(false);
  }, 30_000);

  it("reads no bubble past the card, and nothing from the count's turn", async () => {
    const late = drawn([you(ASKS[0]!), agent(`${COUNT_REPLIES[0]!} It has not run yet.`), you(ASKS[1]!), agent("I'll create that fixture item."), card, agent("It has not run yet.")]);
    expect([createReply(late), await CREATE.check(late)]).toEqual(["I'll create that fixture item.", false]);
    expect(createReply(drawn([you(ASKS[0]!), agent("It has not run yet.")]))).toBe("");
  });
});
