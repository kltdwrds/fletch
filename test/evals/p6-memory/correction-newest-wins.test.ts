// T-P6-05 under vitest; its run is in `runs.ts`, shared with `planted.test.ts`.
import { describe } from "vitest";
import { runTask } from "../../support/task.ts";
import task from "./correction-newest-wins.task.ts";
import { p6Harness } from "./harness.ts";
import { runs } from "./runs.ts";

describe("[F27] P6 memory: a correction supersedes the old claim, and the recall gives the newest", () => {
  runTask(task, p6Harness(runs["T-P6-05"]!()));
});
