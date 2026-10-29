// T-P1-04 under vitest: one exchange seeded, then the ❤️ and Sam's next message; the fake answers twice in all.
import { describe } from "vitest";
import { runTask } from "../../support/task.ts";
import task, { ASK, STATEMENT } from "./ambient-reaction-silent.task.ts";
import { p1Harness } from "./harness.ts";

describe("[F20] P1 reactions: an ambient reaction is silent", () => {
  runTask(
    task,
    p1Harness({
      script: [{ text: STATEMENT }, { text: "Ten." }],
      seed: (world) => world.say(ASK),
    }),
  );
});
