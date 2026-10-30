// T-P6-04 is tier 2 (`pnpm evals`, F28); here its file loads and runs under the scripted fake, every grader holding on
// the run of a model that keeps the rules (`scripted` in `runs.ts`).
import { describe, expect, it } from "vitest";
import task from "./in-passing-announced.task.ts";
import { graded, scripted } from "./runs.ts";

describe("[F27] P6 memory, tier 2 under the scripted fake: a fact said in passing is saved and announced with its citation", () => {
  it("every grader holds", async () => {
    const r = await graded(task, scripted["T-P6-04"]!());
    expect(r).toEqual(Object.fromEntries(task.graders.map((g) => [g.name, true])));
  });
});
