// T-P9-08 under vitest: the scripted run in `runs-surface.ts` through F36's surface harness.
import { describe } from "vitest";
import { runTask } from "../../support/task.ts";
import { p9SurfaceHarness } from "./harness-surface.ts";
import { surfaceRuns } from "./runs-surface.ts";
import task from "./status-is-stored-and-said.task.ts";

describe("[F36] P9 connectors: T-P9-08", () => {
  runTask(task, p9SurfaceHarness(surfaceRuns["T-P9-08"]!()));
});
