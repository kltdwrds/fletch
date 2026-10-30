// T-P6-06 under vitest, twice: the scripted model that writes the location only, and the planted second script that
// tries to write the number first and is refused at memory_write by code. Both runs are in `runs.ts`.
import { describe } from "vitest";
import { runTask } from "../../support/task.ts";
import { p6Harness } from "./harness.ts";
import task from "./refused-value.task.ts";
import { runs, triesTheNumber } from "./runs.ts";

describe("[F27] P6 memory: a government ID number is refused by code and kept out of every store and search leg", () => {
  runTask(task, p6Harness(runs["T-P6-06"]!()));
  describe("the planted second script, which tries to write the number", () => {
    runTask(task, p6Harness({ ...runs["T-P6-06"]!(), script: triesTheNumber }));
  });
});
