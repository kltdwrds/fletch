// Tier 1 of the P13 tasks F71 runs (T-P13-02, 03, 05, 06, 07's record half, 09, 12 and 15): Sam's real chat with speech
// on over the fake speech binding (`world.ts`), each call admitted and written by the tenant's real Ledger, and Sam's real
// attachments transcribing through the same admission (`harness.ts`). T-P13-07's Library grader is F72's, left out by name.
import { describe, expect, it } from "vitest";
import { graded, played } from "./harness.ts";
import { F71_TASKS, F72_GRADERS, optionsFor } from "./runs-f71.ts";

describe("[F71] P13 speech behind the AI binding: tier 1", () => {
  for (const t of F71_TASKS) {
    it(`${t.task.id} holds every grader${t.task.id === "T-P13-07" ? " of its record half" : ""}`, async () => {
      const g = await graded(t.task, await played(t.task, optionsFor(t)));
      for (const name of F72_GRADERS) delete g[name];
      expect(g).toEqual(Object.fromEntries(Object.keys(g).map((k) => [k, true])));
    });
  }
});
