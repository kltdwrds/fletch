// T-P11-14 under vitest: the scripted run in `runs.ts` through the tier-1 harness.
import { describe } from "vitest";
import { runTask } from "../../support/task.ts";
import { p11Harness } from "./harness.ts";
import { runs } from "./runs.ts";
import task from "./library-listing.task.ts";

describe("[F100] P11 files: T-P11-14", () => {
  runTask(task, p11Harness(runs["T-P11-14"]!()));
});
