// T-P12-02 under vitest: the scripted run in `runs.ts` through the tier-1 harness.
import { describe } from "vitest";
import { runTask } from "../../support/task.ts";
import { p12Harness } from "./harness.ts";
import task from "./purchase-card-once-or-decline.task.ts";
import { runs } from "./runs.ts";

describe("[F38] P12 wallet: T-P12-02", () => {
  runTask(task, p12Harness(runs["T-P12-02"]!()));
});
