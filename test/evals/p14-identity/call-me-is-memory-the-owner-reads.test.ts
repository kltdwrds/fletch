// T-P14-02 under vitest: the scripted run in `runs.ts` through the tier-1 harness.
import { describe } from "vitest";
import { runTask } from "../../support/task.ts";
import task from "./call-me-is-memory-the-owner-reads.task.ts";
import { p14Harness } from "./harness.ts";
import { runs } from "./runs.ts";

describe("[F40] P14 identity: T-P14-02", () => {
  runTask(task, p14Harness(runs["T-P14-02"]!()));
});
