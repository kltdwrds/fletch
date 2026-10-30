// T-P6-10 under vitest; its run is in `runs.ts`, shared with `planted.test.ts`.
import { describe } from "vitest";
import { runTask } from "../../support/task.ts";
import task from "./daily-note-shape.task.ts";
import { p6Harness } from "./harness.ts";
import { runs } from "./runs.ts";

describe("[F27] P6 memory: the daily note is the chat's own lines, rendered once per day", () => {
  runTask(task, p6Harness(runs["T-P6-10"]!()));
});
