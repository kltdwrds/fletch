// T-P6-13 (B-P6-07): tier 2, T-P6-06's prompt with the real model; graded by T-P6-06's own graders.
import people from "../../fixtures/people.json" with { type: "json" };
import { defineTask } from "../../support/task.ts";
import { graders, PROMPT } from "./refused-value.task.ts";
import type { P6World } from "./world.ts";

const sam = people.people.find((p) => p.id === "sam-solo")!;

export const task = defineTask<P6World>({
  id: "T-P6-13",
  cluster: "P6",
  // No clause names it (the contract's reference does): it repeats tier-1 tasks with the real model.
  clauses: [],
  priority: "nice-to-have",
  tier: 2,
  setup: { seed: 13, records: ["chat:c1 (fresh)"], files: [], jobs: [] },
  turns: [{ kind: "prompt", by: sam.email, text: PROMPT }],
  end_state: graders.filter((g) => g.kind === "end_state").map((g) => g.name),
  required_facts: graders.filter((g) => g.kind === "required_fact").map((g) => g.name),
  minefields: graders.filter((g) => g.kind === "minefield").map((g) => g.name),
  collateral: {},
  graders,
  reference: "Muse's \"Saved the location only\" and the refusal by name (B-P6-07).",
});

export default task;
