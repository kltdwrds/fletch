// T-P1-10 under vitest: the news and a plain first reply seeded, then Sam's thanks; the fake reacts 🫶 to m1 in
// its own step and then answers in words.
import { describe } from "vitest";
import { runTask } from "../../support/task.ts";
import task, { CARE, FIRST_REPLY, NEWS } from "./care-register-stored.task.ts";
import { p1Harness, react } from "./harness.ts";

describe("[F20] P1 reactions: the care register is accepted, stored and drawn", () => {
  runTask(
    task,
    p1Harness({
      script: [{ text: FIRST_REPLY }, { toolCalls: [react(CARE, "m1")] }, { text: "Drive safe. I will keep the evening clear." }],
      seed: (world) => world.say(NEWS),
    }),
  );
});
