// T-P9-12 under vitest: the scripted run in `runs.ts` through the tier-1 harness.
import { describe } from "vitest";
import { runTask } from "../../support/task.ts";
import { p9Harness } from "./harness.ts";
import task from "./lists-agree-and-missing-is-refused.task.ts";
import { runs } from "./runs.ts";

describe("[F35] P9 connectors: T-P9-12", () => {
  runTask(task, p9Harness(runs["T-P9-12"]!()));
});
