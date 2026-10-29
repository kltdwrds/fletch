// T-P1-03 under vitest: c1 ends on the agent's question, c2 on an approval card (the fixture `shop_buy`, a purchase).
import { describe } from "vitest";
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
