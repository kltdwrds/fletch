// T-P2-13 (B-P2-08): tier 2, the real model reads a file that is not there and says so, naming it, quoting nothing.
import people from "../../fixtures/people.json" with { type: "json" };
import { defineTask } from "../../support/task.ts";
import { type P2World, replyOf } from "./world.ts";

const sam = people.people.find((p) => p.id === "sam-solo")!;

export const MISSING = "p2-missing-file.md";

export const task = defineTask<P2World>({
  id: "T-P2-13",
  cluster: "P2",
  clauses: ["B-P2-08"],
  priority: "must-have",
  tier: 2,
  setup: { seed: 13, records: ["chat:c1 (fresh)"], files: [], jobs: [] },
  turns: [{ kind: "prompt", by: sam.email, text: `read ${MISSING} in your workspace and tell me what it says` }],
  end_state: ["the reply says the file does not exist or could not be read"],
  required_facts: ["the reply names the file"],
  minefields: ["invented_content", "empty_success"],
  collateral: { journal: ["mail:c1:1:user", "message:c1:1:you", "message:c1:2:agent", "turn:c1:1"] },
  graders: [
    { name: "the reply says the file does not exist or could not be read", kind: "end_state", check: (w) => /(no such file|does not exist|doesn['’]t exist|not found|could not read|couldn['’]t read)/i.test(replyOf(w)) },
    { name: "the reply names the file", kind: "required_fact", check: (w) => replyOf(w).includes(MISSING) },
    { name: "invented_content", kind: "minefield", check: (w) => replyOf(w).includes("```") || /\b(it says|the file (says|contains|reads))\b/i.test(replyOf(w)) },
    { name: "empty_success", kind: "minefield", check: (w) => /\b(is|it's) empty\b/i.test(replyOf(w)) },
  ],
  reference: "Muse step 6 (`step-6.png`: \"there is no file at …, so there's nothing in it to report. I didn't invent contents for it.\").",
});

export default task;
