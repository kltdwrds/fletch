// T-P6-14 is tier 2 (`pnpm evals`, F28); here its file loads and runs under the scripted fake, and fails where shipped
// fletch has no seam: no model tool writes a people page (`upsertEntity` is the Person's alone, delta 7), so after
// the stated relationship there is no page and no index. Every other grader holds. When F28 gives the model the
// seam, this test fails and is turned into the passing run.
import { describe, expect, it } from "vitest";
import task from "./people-page-real-model.task.ts";
import { graded, scripted } from "./runs.ts";

describe("[F27] P6 memory, tier 2 under the scripted fake: a stated relationship makes a people page", () => {
  it("runs, and fails only on the page and the index, which no model path writes", async () => {
    const r = await graded(task, scripted["T-P6-14"]!());
    const missing = ["after the stated relationship the page has the six sections", "the index lists Pat with the relationship"];
    expect(r).toEqual(Object.fromEntries(task.graders.map((g) => [g.name, !missing.includes(g.name)])));
  });
});
