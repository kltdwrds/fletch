// T-P6-14 is tier 2 (`pnpm evals`, F28); here its file loads and runs under the scripted fake. Until F44 no model tool
// wrote a people page (`upsertEntity` was the Person's alone, delta 7), so the run failed on the page and the index;
// F44 gives the chat `memory_write` target person, and the scripted run of a model that keeps the rules now holds every
// grader. The old run, a stated relationship saved as a plain daily line, is kept as the planted fault: it writes no
// page, and the page graders still fail it.
import { describe, expect, it } from "vitest";
import { citeOf, replyFrom, writeDaily } from "./harness.ts";
import task from "./people-page-real-model.task.ts";
import { graded, scripted } from "./runs.ts";

describe("[F44] P6 memory, tier 2 under the scripted fake: a stated relationship makes a people page", () => {
  it("every grader holds on the run that writes the page through memory_write target person", async () => {
    const r = await graded(task, scripted["T-P6-14"]!());
    expect(r).toEqual(Object.fromEntries(task.graders.map((g) => [g.name, true])));
  });

  it("planted: the relationship saved as a daily line alone writes no page, and fails on the page and the index", async () => {
    const r = await graded(task, {
      script: [{ text: "Noted." }, { text: "Noted." }, { text: "Noted." }, writeDaily("call_rel", "Pat Solo is Sam's co-founder; they talk every Monday"), replyFrom((x) => `Saved (${citeOf(x.at(-1) ?? "")}).`)],
    });
    const missing = ["after the stated relationship the page has the six sections", "the index lists Pat with the relationship"];
    expect(r).toEqual(Object.fromEntries(task.graders.map((g) => [g.name, !missing.includes(g.name)])));
  });
});
