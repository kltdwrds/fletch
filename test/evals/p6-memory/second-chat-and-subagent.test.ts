// T-P6-08 under vitest; its run is in `runs.ts`, shared with `planted.test.ts`.
import { describe } from "vitest";
import { runTask } from "../../support/task.ts";
import { p6Harness } from "./harness.ts";
import { runs } from "./runs.ts";
import task from "./second-chat-and-subagent.task.ts";

describe("[F27] P6 memory: a second chat reads memory by search and a sub-agent gets none", () => {
  runTask(task, p6Harness(runs["T-P6-08"]!()));
});
