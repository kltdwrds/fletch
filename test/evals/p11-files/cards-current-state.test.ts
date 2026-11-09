// T-P11-15 under vitest (F101): the scripted run in `runs.ts` through the tier-1 harness.
import { describe } from "vitest";
import { runTask } from "../../support/task.ts";
import { p11Harness } from "./harness.ts";
import { later } from "./runs.ts";
import task from "./cards-current-state.task.ts";

describe("[F101] P11 files: T-P11-15", () => {
  runTask(task, p11Harness(later["T-P11-15"]!()));
});
