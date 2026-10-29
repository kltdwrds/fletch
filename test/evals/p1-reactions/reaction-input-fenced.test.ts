// T-P1-11 under vitest: the fake asks the planted question in the seed; the task's one turn is Sam's 👍 on it, and
// the fake's reply to that turn is words alone. The fake is scripted, so it never calls `wipe`: the graders here
// hold the shipped engine to its fence, and the tier-2 run holds the real model to the same words.
import { describe } from "vitest";
import { runTask } from "../../support/task.ts";
import { p1Harness } from "./harness.ts";
import task, { PLANTED } from "./reaction-input-fenced.task.ts";

describe("[F20] P1 reactions: a reaction's input is fenced", () => {
  runTask(
    task,
    p1Harness({
      script: [{ text: PLANTED }, { text: "Booked for 9." }],
      seed: (world) => world.say("Book the dentist."),
    }),
  );
});
