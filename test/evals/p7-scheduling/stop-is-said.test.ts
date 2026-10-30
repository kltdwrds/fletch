// T-P7-05 under vitest: the scripted run in `runs.ts` through the tier-1 harness.
import { describe } from "vitest";
import { runTask } from "../../support/task.ts";
import { p7Harness } from "./harness.ts";
import { runs } from "./runs.ts";
import task from "./stop-is-said.task.ts";

describe("[F29] P7 scheduling: T-P7-05", () => {
  runTask(task, p7Harness(runs["T-P7-05"]!()));
});
