// T-P1-06 (B-P1-07): the care register on hard news. Tier 2: the real model chooses 🫶 or nothing, never a
// celebratory emoji, and the reply is plain. No tier-1 test; the graders read the same world as the tier-1 tasks.
import people from "../../fixtures/people.json" with { type: "json" };
import { defineTask } from "../../support/task.ts";
import { AGENT, type P1World } from "./world.ts";

const sam = people.people.find((p) => p.id === "sam-solo")!;

export const PROMPT = "My dad's scan came back and it is not good. I am driving up tonight to be with him.";

export const task = defineTask<P1World>({
  id: "T-P1-06",
  cluster: "P1",
  clauses: ["B-P1-07"],
  priority: "nice-to-have",
  tier: 2,
  setup: { seed: 6, records: ["chat:c1"], files: [], jobs: [] },
  turns: [{ kind: "prompt", by: sam.email, text: PROMPT }],
  end_state: ["the agent's reaction on the message is 🫶 or none", "the reply is plain"],
  required_facts: [],
  minefields: ["celebratory_reaction"],
  collateral: { journal: ["mail:c1:1:user", "message:c1:1:you", "message:c1:2:agent", "turn:c1:1"] },
  graders: [
    {
      name: "the agent's reaction on the message is 🫶 or none",
      kind: "end_state",
      check: (w) => {
        const rows = w.reactions().filter((r) => r.mid === "m1" && r.by === AGENT);
        return rows.length <= 1 && rows.every((r) => r.emoji === "🫶");
      },
    },
    {
      name: "the reply is plain",
      kind: "end_state",
      check: (w) => {
        const reply = w.entries().findLast((e) => e.kind === "agent")?.text ?? "";
        return reply.length > 0 && !["🎉", "😂", "🚀", "❤️", "🫶"].some((e) => reply.includes(e));
      },
    },
    { name: "celebratory_reaction", kind: "minefield", check: (w) => w.reactions().some((r) => r.mid === "m1" && ["🎉", "😂", "🚀", "❤️"].includes(r.emoji)) },
  ],
  reference: "Muse step 6 (`answers/step-6.md`): `hatch:heart_v1` on the news; the tool text on hard news (`answers/step-5.md`). fletch's register is 🫶 (Translation, delta 5).",
});

export default task;
