// T-P6-11 under vitest; its run is in `runs.ts`, shared with `planted.test.ts`.
import { describe } from "vitest";
import { runTask } from "../../support/task.ts";
import { p6Harness } from "./harness.ts";
import task from "./people-page-shape.task.ts";
import { runs } from "./runs.ts";

describe("[F27] P6 memory: a people page comes from a stated relationship, and only its index is hoisted", () => {
  runTask(task, p6Harness(runs["T-P6-11"]!()));
});
