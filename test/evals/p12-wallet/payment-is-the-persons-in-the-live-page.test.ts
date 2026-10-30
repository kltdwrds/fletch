// T-P12-07 under vitest: the scripted run in `runs.ts` through the tier-1 harness.
import { describe } from "vitest";
import { runTask } from "../../support/task.ts";
import { p12Harness } from "./harness.ts";
import task from "./payment-is-the-persons-in-the-live-page.task.ts";
import { runs } from "./runs.ts";

describe("[F38] P12 wallet: T-P12-07", () => {
  runTask(task, p12Harness(runs["T-P12-07"]!()));
});
