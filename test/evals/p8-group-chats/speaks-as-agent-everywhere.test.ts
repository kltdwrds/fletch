// T-P8-14 under vitest: the scripted run in `runs.ts` through the tier-1 harness.
import { describe } from "vitest";
import { runTask } from "../../support/task.ts";
import { p8Harness } from "./harness.ts";
import { runs } from "./runs.ts";
import task from "./speaks-as-agent-everywhere.task.ts";

describe("[F60] P8 group chats: T-P8-14", () => {
  runTask(task, p8Harness(runs["T-P8-14"]!()));
});
