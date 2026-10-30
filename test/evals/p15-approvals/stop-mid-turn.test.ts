// T-P15-09 under vitest; its run (script, seed and events) is in `runs.ts`, shared with `planted.test.ts`.
import { describe } from "vitest";
import { runTask } from "../../support/task.ts";
import { runs } from "./runs.ts";
import task from "./stop-mid-turn.task.ts";

describe("[F25] P15 approvals: Stop ends the turn at the step boundary and the proposed share is not committed", () => {
  runTask(task, runs["T-P15-09"]());
});
