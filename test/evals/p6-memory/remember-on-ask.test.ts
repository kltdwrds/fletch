// T-P6-01 under vitest; its run is in `runs.ts`, shared with `planted.test.ts`.
import { describe } from "vitest";
import { runTask } from "../../support/task.ts";
import { p6Harness } from "./harness.ts";
import task from "./remember-on-ask.task.ts";
import { runs } from "./runs.ts";

describe("[F27] P6 memory: a fact asked to be remembered is one cited line, saved only after the write", () => {
  runTask(task, p6Harness(runs["T-P6-01"]!()));
});
