// T-P3-12 under vitest: the scripted run in `runs.ts` through the tier-1 harness.
import { describe } from "vitest";
import { runTask } from "../../support/task.ts";
import { p3Harness } from "./harness.ts";
import { runs } from "./runs.ts";
import task from "./children-are-this-chats.task.ts";

describe("[F33] P3 delegation: T-P3-12", () => {
  runTask(task, p3Harness(runs["T-P3-12"]!()));
});
