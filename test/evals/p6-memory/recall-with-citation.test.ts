// T-P6-02 under vitest; its run is in `runs.ts`, shared with `planted.test.ts`.
import { describe } from "vitest";
import { runTask } from "../../support/task.ts";
import { p6Harness } from "./harness.ts";
import task from "./recall-with-citation.task.ts";
import { runs } from "./runs.ts";

describe("[F27] P6 memory: a second chat recalls a fact from memory with its citation while the semantic leg is down", () => {
  runTask(task, p6Harness(runs["T-P6-02"]!()));
});
