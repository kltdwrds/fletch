// T-P2-02 under vitest: two turns a day apart on the world's clock; the block's line and the envelope's heading are
// the shipped ones.
import { describe, expect, it } from "vitest";
import { IDENTITY_LINES } from "../../../packages/agent/src/chat/operating-block.ts";
import { ENVELOPE_HEADING } from "../../../packages/agent/src/context/assemble.ts";
import { runTask } from "../../support/task.ts";
import { p2Harness } from "./harness.ts";
import task, { BLOCK_LINE, ENVELOPE } from "./operating-block-per-turn.task.ts";

describe("[F23] P2 loop: the stable prefix and the dated envelope", () => {
  it("the task's block line and envelope heading are the shipped ones", () => {
    expect([BLOCK_LINE, ENVELOPE]).toEqual([IDENTITY_LINES[0], ENVELOPE_HEADING]);
  });
  runTask(
    task,
    p2Harness({
      script: [{ text: "The launch plan." }, { text: "The review." }],
      before: (world, i) => {
        if (i === 1) world.w.clock.now += 24 * 3600 * 1000;
      },
    }),
  );
});
