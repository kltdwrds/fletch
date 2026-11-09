// The tier-2 P16 tasks (T-P16-03, 05 and 12) are graded on a slot with the real model by `pnpm evals P16` (F81); here
// T-P16-03 and T-P16-05 load and play under the scripted fake through the tier-1 harness, and their graders answer as
// shipped fletch does. T-P16-12 reads the slot's pages at two widths (`P16SlotWorld`) and has no tier-1 run.
import { describe, expect, it } from "vitest";
import confirm from "./confirm-before-commit.task.ts";
import empty from "./empty-result-said-as-empty.task.ts";
import { graded } from "./harness.ts";
import reload from "./reload-reads-the-same.task.ts";
import { runs } from "./runs.ts";

const held = (task: { graders: Array<{ name: string }> }) => Object.fromEntries(task.graders.map((g) => [g.name, true]));

describe("[F80] P16 shopping and bookings, tier 2 under the scripted fake", () => {
  it("T-P16-03: empty said as empty with its source and reason, the blocked read said as failed, no date moved", async () => {
    expect(await graded(empty, runs["T-P16-03"]!())).toEqual(held(empty));
  });
  it("T-P16-05: the chosen fare restated in full, then only its fields asked, in one question, nothing handed over", async () => {
    expect(await graded(confirm, runs["T-P16-05"]!())).toEqual(held(confirm));
  });
  it("T-P16-12 loads with its clause and graders; it runs only on a slot", () => {
    expect([reload.id, reload.clauses, reload.tier, reload.graders.length]).toEqual(["T-P16-12", ["B-P16-13"], 2, 2]);
  });
});
