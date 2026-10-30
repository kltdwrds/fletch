// T-P7-03 under vitest: the scripted run in `runs.ts` through the tier-1 harness.
import { describe } from "vitest";
import { runTask } from "../../support/task.ts";
import { p7Harness } from "./harness.ts";
import { runs } from "./runs.ts";
import task from "./certified-silence.task.ts";

describe("[F29] P7 scheduling: T-P7-03", () => {
  runTask(task, p7Harness(runs["T-P7-03"]!()));
});
