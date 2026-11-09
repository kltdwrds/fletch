// T-P11-05 under vitest (F103, D-0028 proposed): the scripted run in `runs.ts` through the tier-1 harness.
import { describe } from "vitest";
import { runTask } from "../../support/task.ts";
import { p11Harness } from "./harness.ts";
import { later } from "./runs.ts";
import task from "./versions-and-trash.task.ts";

describe("[F103] P11 files: T-P11-05", () => {
  runTask(task, p11Harness(later["T-P11-05"]!()));
});
