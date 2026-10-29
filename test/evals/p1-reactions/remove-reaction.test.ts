// T-P1-07 under vitest: the exchange, the agent's 👍 planted in the store, Sam's first ❤️ through the engine; the
// task's one turn is the second ❤️. The fake answers once, in the seed, and is never asked again.
import { describe } from "vitest";
import { runTask } from "../../support/task.ts";
import { p1Harness } from "./harness.ts";
import task, { ANSWER, ASK } from "./remove-reaction.task.ts";

describe("[F20] P1 reactions: the same emoji again removes, and only that one", () => {
  runTask(
    task,
    p1Harness({
      script: [{ text: ANSWER }],
      seed: async (world) => {
        await world.say(ASK);
        world.seedAgentReaction("m1", "👍");
        await world.react("m2", "❤️");
      },
    }),
  );
});
