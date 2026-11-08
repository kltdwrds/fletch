// The tier-2 P9 tasks (T-P9-13 to 16) are graded on a slot with the real model by `pnpm evals P9` (F37); here each loads
// and plays under the scripted fake through the tier-1 harness, and its graders answer as shipped fletch does. T-P9-17
// reads the slot's pages at two widths (`P9SlotWorld`) and has no tier-1 run.
import { describe, expect, it } from "vitest";
import count from "./count-and-card-real-model.task.ts";
import { graded, played } from "./harness.ts";
import reload from "./reload-and-phone.task.ts";
import { call, load, runs } from "./runs.ts";
import setup from "./setup-real-model.task.ts";
import typed from "./typed-secret-real-model.task.ts";
import unbound from "./unbound-host-real-model.task.ts";

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

  it("each create reply of declared run 1, verbatim beside the card, fails the create grader; the card is raised and nothing sent", async () => {
    for (const [i, words] of CREATE_REPLIES.entries()) {
      const w = await played(count, asRun(COUNT_REPLIES[i]!, words));
      expect([words, w.replies("c1")[1], w.cards("c1").filter((c) => c.tool === "fixture_create").length, w.sent().some((s) => s.method === "POST")]).toEqual([words, words, 1, false]);
      expect([words, await count.graders.find((g) => g.name === CREATE_GRADER)!.check(w)]).toEqual([words, false]);
    }
  }, 30_000);

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
