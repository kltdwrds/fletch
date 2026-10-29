// T-P1-05 under vitest: four `react` calls in four steps, so each is committed and framed on its own, then words.
import { describe } from "vitest";
import { runTask } from "../../support/task.ts";
import task, { ANSWER, ASK } from "./agent-replace-and-no-op.task.ts";
import { p1Harness, react } from "./harness.ts";

describe("[F20] P1 reactions: the agent's reaction replaces, re-sets and has no target of its own", () => {
  runTask(
    task,
    p1Harness({
      script: [{ text: ANSWER }, { toolCalls: [react("🚀", "m1")] }, { toolCalls: [react("❤️", "m1")] }, { toolCalls: [react("❤️", "m1")] }, { toolCalls: [react("👍", "m2")] }, { text: "Done reacting." }],
      seed: (world) => world.say(ASK),
    }),
  );
});
