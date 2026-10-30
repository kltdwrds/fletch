// T-P15-10 under vitest; its run is in `runs-f26.ts`, shared with `planted-f26.test.ts`.
import { describe } from "vitest";
import { runTask } from "../../support/task.ts";
import task from "./rate-limit-stops-scope.task.ts";
import { runsF26 } from "./runs-f26.ts";

describe("[F26] P15 approvals: a 429 stops that site's scope with its wait, and the other page runs", () => {
  runTask(task, runsF26["T-P15-10"]());
});
