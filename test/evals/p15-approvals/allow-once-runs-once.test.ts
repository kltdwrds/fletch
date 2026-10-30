// T-P15-04 under vitest; its run (script, seed and events) is in `runs.ts`, shared with `planted.test.ts`.
import { describe } from "vitest";
import { runTask } from "../../support/task.ts";
import { runs } from "./runs.ts";
import task from "./allow-once-runs-once.task.ts";

describe("[F25] P15 approvals: allow once runs the share once, and the same ask asks again", () => {
  runTask(task, runs["T-P15-04"]());
});
