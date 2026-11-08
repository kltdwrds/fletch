// T-P13-01 under vitest: the scripted run in `runs.ts` through the tier-1 harness.
import { describe } from "vitest";
import { runTask } from "../../support/task.ts";
import { p13Harness } from "./harness.ts";
import { runs } from "./runs.ts";
import task from "./no-agent-started-capture.task.ts";

describe("[F70] P13 voice and audio: T-P13-01", () => {
  runTask(task, p13Harness({ script: runs["T-P13-01"]!() }));
});
