// The tier-2 P5 tasks (T-P5-12 to 15) are graded on a slot with the real model by `pnpm evals P5` (F32); here each file
// loads and plays under the scripted fake through the tier-1 harness, and its graders answer as shipped fletch does.
import { describe, expect, it } from "vitest";
import reload from "./reload-and-phone.task.ts";
import failedRead from "./failed-read-real-model.task.ts";
import { graded } from "./harness.ts";
import oneTask from "./one-request-one-task-real-model.task.ts";
import { runs } from "./runs.ts";
import ack from "./subagent-ack-real-model.task.ts";

const held = (task: { graders: Array<{ name: string }> }) => Object.fromEntries(task.graders.map((g) => [g.name, true]));

describe("[F31] P5 activity, tier 2 under the scripted fake", () => {
  it("T-P5-12: the rows, the drawer and the route read the same on every read and at both widths", async () => {
    expect(await graded(reload, runs["T-P5-12"]!())).toEqual(held(reload));
  });
  it("T-P5-13: the first page answered, the second said plainly, one step failed", async () => {
    expect(await graded(failedRead, runs["T-P5-13"]!())).toEqual(held(failedRead));
  });
  it("T-P5-14: the acknowledgement launched and not done, the reply's count the child's", async () => {
    expect(await graded(ack, runs["T-P5-14"]!())).toEqual(held(ack));
  });
  it("T-P5-15: one row, the record code's, the counts agreeing", async () => {
    expect(await graded(oneTask, runs["T-P5-15"]!())).toEqual(held(oneTask));
  });
});
