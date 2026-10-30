// T-P2-05 under vitest: four lookups; the third step's request is held while Sam's steer is sent, then released, so
// the steer reaches the boundary after the third result.
import { describe, expect, it } from "vitest";
import { STEER_POLICY } from "../../../packages/agent/src/chat/mailbox.ts";
import { runTask } from "../../support/task.ts";
import { p2Harness } from "./harness.ts";
import task, { STEER_LINE } from "./steer-mid-turn.task.ts";

const lookup = (n: number) => ({ toolCall: { name: "steps_lookup", arguments: { n } } });

describe("[F23] P2 loop: a steer folds into the running turn at its next step boundary", () => {
  it("the task's steer line opens the shipped STEER_POLICY", () => {
    expect(STEER_POLICY.startsWith(STEER_LINE)).toBe(true);
  });
  runTask(
    task,
    p2Harness({
      fixtures: ["steps"],
      hold: "third",
      script: [lookup(1), lookup(2), { checkpoint: "third", step: lookup(3) }, lookup(4), { text: "Across the four folders: 8 .md files." }],
    }),
  );
});
