// T-P15-03 under vitest; its run (script, seed and events) is in `runs.ts`, shared with `planted.test.ts`.
import { describe } from "vitest";
import { runTask } from "../../support/task.ts";
import { runs } from "./runs.ts";
import task from "./decision-final.task.ts";

describe("[F25] P15 approvals: no card expires, and a decline is final", () => {
  runTask(task, runs["T-P15-03"]());
});
