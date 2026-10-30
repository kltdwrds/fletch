// T-P6-07 under vitest; its run is in `runs.ts`, shared with `planted.test.ts`.
import { describe } from "vitest";
import { runTask } from "../../support/task.ts";
import task from "./forget-two-phase.task.ts";
import { p6Harness } from "./harness.ts";
import { runs } from "./runs.ts";

describe("[F27] P6 memory: forget is planned, confirmed by Sam alone, and scoped to its subject", () => {
  runTask(task, p6Harness(runs["T-P6-07"]!()));
});
