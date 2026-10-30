// T-P15-01 under vitest; its run (script, seed and events) is in `runs.ts`, shared with `planted.test.ts`.
import { describe } from "vitest";
import { runTask } from "../../support/task.ts";
import { runs } from "./runs.ts";
import task from "./card-parks-action.task.ts";

describe("[F25] P15 approvals: a gated share parks as a pending card and nothing leaves", () => {
  runTask(task, runs["T-P15-01"]());
});
