// T-P12-06 under vitest: the scripted run in `runs.ts` through the tier-1 harness.
import { describe } from "vitest";
import { runTask } from "../../support/task.ts";
import task from "./activity-titles-a-purchase.task.ts";
import { p12Harness } from "./harness.ts";
import { runs } from "./runs.ts";

describe("[F38] P12 wallet: T-P12-06", () => {
  runTask(task, p12Harness(runs["T-P12-06"]!()));
});
