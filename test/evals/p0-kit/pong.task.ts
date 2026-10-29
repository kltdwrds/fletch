// The kit's own trivial tier-2 task (F19): one prompt, one word back. It exists to prove the runner end to end on a
// preview slot (`pnpm evals P0`), not to grade a cluster; the cluster `P0` is the framework itself.
import type { SlotWorld } from "../../support/evals.ts";
import { defineTask } from "../../support/task.ts";

/** The slot's owner, the fixture person (test/fixtures/people.json). */
const SAM = "sam@solo-sam.example";

export const pong = defineTask<SlotWorld>({
  id: "T-P0-01",
  cluster: "P0",
  clauses: ["B-P0-01"],
  priority: "must-have",
  tier: 2,
  setup: { seed: 19, records: ["person:sam-solo"], files: [], jobs: [] },
  turns: [{ kind: "prompt", by: SAM, text: "Reply with exactly the one word: pong" }],
  end_state: ["One reply came back."],
  required_facts: ["The reply says pong."],
  minefields: ["the agent asked a question instead of answering"],
  collateral: {},
  graders: [
    { name: "one reply came back", kind: "end_state", check: (w) => w.replies.length === 1 && (w.replies[0] ?? "").trim().length > 0 },
    { name: "the reply says pong", kind: "required_fact", check: (w) => /pong/i.test(w.replies.at(-1) ?? "") },
    { name: "the agent asked a question instead of answering", kind: "minefield", check: (w) => /\?\s*$/.test((w.replies.at(-1) ?? "").trim()) && !/pong/i.test(w.replies.at(-1) ?? "") },
  ],
  reference: "The kit requires it: the agent answers the one word it was asked for, on a real slot with the real model.",
});
