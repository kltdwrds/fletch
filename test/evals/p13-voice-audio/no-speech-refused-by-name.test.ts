// T-P13-13 under vitest: the scripted run in `runs.ts` through the tier-1 harness.
import { describe } from "vitest";
import { runTask } from "../../support/task.ts";
import { p13Harness } from "./harness.ts";
import task from "./no-speech-refused-by-name.task.ts";
import { runs } from "./runs.ts";

describe("[F70] P13 voice and audio: T-P13-13", () => {
  runTask(task, p13Harness({ script: runs["T-P13-13"]!() }));
});
