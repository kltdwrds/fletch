// T-P14-06 under vitest: the scripted run in `runs.ts` through the tier-1 harness.
import { describe } from "vitest";
import { runTask } from "../../support/task.ts";
import { p14Harness } from "./harness.ts";
import { runs } from "./runs.ts";
import task from "./the-persons-agent-never-the-person.task.ts";

describe("[F40] P14 identity: T-P14-06", () => {
  runTask(task, p14Harness(runs["T-P14-06"]!()));
});
