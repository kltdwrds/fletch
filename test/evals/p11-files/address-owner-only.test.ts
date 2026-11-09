// T-P11-03 under vitest: the scripted run in `runs.ts` through the tier-1 harness.
import { describe } from "vitest";
import { runTask } from "../../support/task.ts";
import { p11Harness } from "./harness.ts";
import { runs } from "./runs.ts";
import task from "./address-owner-only.task.ts";

describe("[F100] P11 files: T-P11-03", () => {
  runTask(task, p11Harness(runs["T-P11-03"]!()));
});
