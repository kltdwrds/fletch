// T-P1-03 under vitest: c1 ends on the agent's question, c2 on an approval card (the fixture `shop_buy`, a purchase).
import { describe, expect, it } from "vitest";
import { Seeded } from "../../support/seeded.ts";
import { runTask } from "../../support/task.ts";
import { p1Harness } from "./harness.ts";
import task, { CARD_ASK, QUESTION } from "./thumbs-up-answers-question.task.ts";

describe("[F20] P1 reactions: a 👍 answers the pending question, never the card", () => {
  runTask(
    task,
    p1Harness({
      script: [{ text: QUESTION }, { toolCall: { name: "shop_buy", arguments: { item: "chair", amount: 90 } }, text: CARD_ASK }, { text: "Booked for 9." }],
      seed: async (world) => {
        await world.say("Book the dentist.", "c1");
        await world.open("c2");
        await world.say("Buy the chair.", "c2");
      },
    }),
  );
});

// The card leg on a refused write (F22): before the stored-reaction grader, a c2 reaction refused by the chat left
// the card pending and no turn, so every card grader passed on a write that never landed.
describe("[F22] T-P1-03 cannot pass on a refused reaction", () => {
  const harness = p1Harness({
    script: [{ text: QUESTION }, { toolCall: { name: "shop_buy", arguments: { item: "chair", amount: 90 } }, text: CARD_ASK }, { text: "Booked for 9." }],
    seed: async (world) => {
      await world.say("Book the dentist.", "c1");
      await world.open("c2");
      await world.say("Buy the chair.", "c2");
    },
  });
  const rng = new Seeded(task.setup.seed);
  const grader = (name: string) => task.graders.find((g) => g.name === name)!.check;

  it("the harness fails a reaction turn the chat refuses, by name", async () => {
    const world = await harness.setup(rng, task);
    await expect(harness.play(world, { kind: "event", name: "reaction", payload: { chat: "c2", mid: "m9", emoji: "👍" } }, rng)).rejects.toThrow("P1_REACTION_REFUSED: MESSAGE_NOT_FOUND");
    expect(world.reactions("c2")).toEqual([]);
  });

  it("the stored-reaction grader fails when the c2 write was refused, where the card graders alone pass", async () => {
    const world = await harness.setup(rng, task);
    await harness.play(world, task.turns[0]!, rng);
    const refused = await world.react("m9", "👍", "c2");
    expect(refused).toEqual({ ok: false, code: "MESSAGE_NOT_FOUND" });
    expect(grader("in the card chat nothing: the card still pending, no mailbox row, no turn")(world)).toBe(true);
    expect(grader("reaction_granted_approval")(world)).toBe(false);
    expect(grader("Sam's 👍 is stored on m2 in both chats")(world)).toBe(false);
    await world.react("m2", "👍", "c2");
    expect(grader("Sam's 👍 is stored on m2 in both chats")(world)).toBe(true);
  });
});
