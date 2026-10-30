// T-P14-05 under vitest: the scripted run in `runs.ts` through the tier-1 harness.
import { describe } from "vitest";
import { runTask } from "../../support/task.ts";
import { p14Harness } from "./harness.ts";
import task from "./last-owner-refused-before-purge.task.ts";
import { runs } from "./runs.ts";

describe("[F40] P14 identity: T-P14-05", () => {
  runTask(task, p14Harness(runs["T-P14-05"]!()));
});
