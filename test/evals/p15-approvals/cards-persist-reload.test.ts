// T-P15-11 under vitest; its run (script, seed and events) is in `runs.ts`, shared with `planted.test.ts`.
import { describe } from "vitest";
import { runTask } from "../../support/task.ts";
import { runs } from "./runs.ts";
import task from "./cards-persist-reload.task.ts";

describe("[F25] P15 approvals: waiting and decided cards are drawn as they stand after a reload", () => {
  runTask(task, runs["T-P15-11"]());
});
