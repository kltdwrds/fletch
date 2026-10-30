// T-P15-06 under vitest; its run (script, seed and events) is in `runs.ts`, shared with `planted.test.ts`.
import { describe } from "vitest";
import { runTask } from "../../support/task.ts";
import { runs } from "./runs.ts";
import task from "./approvals-history-words.task.ts";

describe("[F25] P15 approvals: the Approvals tab says each card's fate in words, over a record of identifiers", () => {
  runTask(task, runs["T-P15-06"]());
});
