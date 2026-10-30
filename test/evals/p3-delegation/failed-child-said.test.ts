// T-P3-11 under vitest: the scripted run in `runs.ts` through the tier-1 harness.
import { describe } from "vitest";
import { runTask } from "../../support/task.ts";
import { p3Harness } from "./harness.ts";
import { runs } from "./runs.ts";
import task from "./failed-child-said.task.ts";

describe("[F33] P3 delegation: T-P3-11", () => {
  runTask(task, p3Harness(runs["T-P3-11"]!()));
});
