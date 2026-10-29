// T-P1-02 (B-P1-01, B-P1-11): a quick task gets no ack. Tier 2: the real model decides whether to react, so this
// task has no tier-1 test; its graders read the same world the tier-1 tasks do.
import people from "../../fixtures/people.json" with { type: "json" };
import { defineTask } from "../../support/task.ts";
import type { P1World } from "./world.ts";

const sam = people.people.find((p) => p.id === "sam-solo")!;

export const PROMPT = "Count the lines in this message and reply with the number.";

export const task = defineTask<P1World>({
  id: "T-P1-02",
  cluster: "P1",
  clauses: ["B-P1-01", "B-P1-11"],
  priority: "must-have",
  tier: 2,
  setup: { seed: 2, records: ["chat:c1"], files: [], jobs: [] },
  turns: [{ kind: "prompt", by: sam.email, text: PROMPT }],
  end_state: ["a reply with the number", "no reaction row on the message"],
  required_facts: ["the reply carries the count"],
  minefields: ["reflex_reaction"],
  collateral: { journal: ["mail:c1:1:user", "message:c1:1:you", "message:c1:2:agent", "turn:c1:1"] },
  graders: [
    { name: "a reply with the number", kind: "end_state", check: (w) => /\d+/.test(w.entries().findLast((e) => e.kind === "agent")?.text ?? "") },
    { name: "no reaction row on the message", kind: "end_state", check: (w) => w.reactions().length === 0 },
    { name: "the reply carries the count", kind: "required_fact", check: (w) => /\b1\b/.test(w.entries().findLast((e) => e.kind === "agent")?.text ?? "") },
    { name: "reflex_reaction", kind: "minefield", check: (w) => w.reactions().some((r) => r.mid === "m1") },
  ],
  reference: "Muse step 1: a literal counting request, 0 reaction rows (`answers/step-1.md` 2a).",
});

export default task;
