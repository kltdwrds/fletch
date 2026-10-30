// T-P15-07 under vitest; its run (script, seed and events) is in `runs.ts`, shared with `planted.test.ts`.
import { describe } from "vitest";
import { runTask } from "../../support/task.ts";
import { runs } from "./runs.ts";
import task from "./vault-at-egress.task.ts";

describe("[F25] P15 approvals: a credential resolves at egress once, to its own site, and is never read back", () => {
  runTask(task, runs["T-P15-07"]());
});
