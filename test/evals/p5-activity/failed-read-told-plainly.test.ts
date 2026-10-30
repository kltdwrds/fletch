// T-P5-06 under vitest: the scripted run in `runs.ts` through the tier-1 harness.
import { describe } from "vitest";
import { runTask } from "../../support/task.ts";
import { p5Harness } from "./harness.ts";
import { runs } from "./runs.ts";
import task from "./failed-read-told-plainly.task.ts";

describe("[F31] P5 activity: T-P5-06", () => {
  runTask(task, p5Harness(runs["T-P5-06"]!()));
});
