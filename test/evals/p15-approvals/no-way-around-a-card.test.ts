// T-P15-05 under vitest; its run (seed, script) is in `runs-f26.ts`, shared with `planted-f26.test.ts`.
import { describe } from "vitest";
import { runTask } from "../../support/task.ts";
import task from "./no-way-around-a-card.task.ts";
import { runsF26 } from "./runs-f26.ts";

describe("[F26] P15 approvals: after a decline, the browse lane and another host each meet the engine and nothing leaves", () => {
  runTask(task, runsF26["T-P15-05"]());
});
