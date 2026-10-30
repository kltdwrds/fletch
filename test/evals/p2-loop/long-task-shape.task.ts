// T-P2-12 (B-P2-03): tier 2, the real model on a long task asked to say its method first: a 👍 before any words,
// a method and a result (two entries or two paragraphs), and no words before the last tool's result.
import people from "../../fixtures/people.json" with { type: "json" };
import { defineTask } from "../../support/task.ts";
import { type P2World, replyOf } from "./world.ts";

const sam = people.people.find((p) => p.id === "sam-solo")!;

const WORDS = new Set(["delta", "message"]);
const firstWords = (w: P2World) => w.frames().findIndex((f) => WORDS.has(f.type));
const thumbs = (w: P2World) => w.frames().findIndex((f) => f.type === "reaction" && f.by === "agent" && f.emoji === "👍");

export const task = defineTask<P2World>({
  id: "T-P2-12",
  cluster: "P2",
  clauses: ["B-P2-03"],
  priority: "nice-to-have",
  tier: 2,
  setup: { seed: 12, records: ["chat:c1 (fresh)"], files: [], jobs: [] },
  turns: [{ kind: "prompt", by: sam.email, text: "count the files in your workspace by extension; tell me how you will do it first, then the result" }],
  end_state: ["a 👍 on Sam's message before the first words", "the reply holds a method and a result, as two entries or two paragraphs", "nothing Sam sees between the 👍 and the reply"],
  required_facts: ["the result carries at least one extension with a count"],
  minefields: ["early_text"],
  collateral: { journal: ["mail:c1:1:user", "message:c1:1:you", "message:c1:2:agent", "turn:c1:1"] },
  graders: [
    { name: "a 👍 on Sam's message before the first words", kind: "end_state", check: (w) => thumbs(w) >= 0 && thumbs(w) < firstWords(w) },
    {
      name: "the reply holds a method and a result, as two entries or two paragraphs",
      kind: "end_state",
      check: (w) => {
        const agent = w.entries().filter((e) => e.kind === "agent");
        return agent.length >= 2 || (agent[0]?.text ?? "").split(/\n\s*\n/).filter((p) => p.trim()).length >= 2;
      },
    },
    { name: "nothing Sam sees between the 👍 and the reply", kind: "end_state", check: (w) => !w.frames().slice(thumbs(w) + 1, firstWords(w)).some((f) => ["notice", "card", "link"].includes(f.type)) },
    { name: "the result carries at least one extension with a count", kind: "required_fact", check: (w) => /\.\w+\D+\d+/.test(replyOf(w)) },
    { name: "early_text", kind: "minefield", check: (w) => w.rows().some((r) => r.role === "assistant" && r.text.trim().length > 0 && r.calls.some((c) => c !== "send_to_user")) },
  ],
  reference: "Muse steps 3 and 4 (`step-3.png`): Method then Result, the 👍 at t0+11 s.",
});

export default task;
