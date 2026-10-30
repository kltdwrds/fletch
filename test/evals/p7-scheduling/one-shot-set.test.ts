// T-P7-01 under vitest: the scripted model creates the one-shot and asks for its card; Sam decides it once.
import { describe } from "vitest";
import { runTask } from "../../support/task.ts";
import { p7Harness } from "./harness.ts";
import task from "./one-shot-set.task.ts";
import { runs } from "./runs.ts";

describe("[F29] P7 scheduling: a one-shot asked in plain words is set in one turn, its card and reply naming the time", () => {
  runTask(task, p7Harness(runs["T-P7-01"]!()));
});
