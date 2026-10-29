// T-P1-01 (B-P1-01): the ack at work start. The agent's 👍 lands on Sam's message in the same step as its first tool
// call, before its first words, is stored under the agent reactor and is drawn after a reload.
import people from "../../fixtures/people.json" with { type: "json" };
import { defineTask } from "../../support/task.ts";
import { AGENT, type P1World } from "./world.ts";

const sam = people.people.find((p) => p.id === "sam-solo")!;

/** Sam's message, the one the ack lands on (`m1`): long work, so the model's script reacts, calls a tool, then answers. */
export const PROMPT = "Plan my week around the orchard walk and the dentist.";

export const task = defineTask<P1World>({
  id: "T-P1-01",
  cluster: "P1",
  clauses: ["B-P1-01"],
  priority: "must-have",
  tier: 1,
  setup: { seed: 1, records: ["chat:c1", "message:m1"], files: [], jobs: [] },
  turns: [{ kind: "prompt", by: sam.email, text: PROMPT }],
  end_state: ["one reaction row on m1 under the agent reactor with 👍", "the 👍 is drawn on m1 after a reload"],
  required_facts: ["the reaction frame reaches Sam before the agent's first words"],
  minefields: ["reaction_on_agent_message"],
  collateral: { journal: ["mail:c1:1:user", "message:c1:1:you", "message:c1:2:agent", "turn:c1:1"] },
  graders: [
    {
      name: "one reaction row on m1 under the agent reactor with 👍",
      kind: "end_state",
      check: (w) => JSON.stringify(w.reactions()) === JSON.stringify([{ mid: "m1", by: AGENT, emoji: "👍" }]),
    },
    {
      name: "the 👍 is drawn on m1 after a reload",
      kind: "end_state",
      check: (w) => JSON.stringify(w.reload().find((e) => e.mid === "m1")?.reactions) === JSON.stringify([{ by: "agent", emoji: "👍" }]),
    },
    {
      name: "the reaction frame reaches Sam before the agent's first words",
      kind: "required_fact",
      check: (w) => {
        const frames = w.frames();
        const ack = frames.findIndex((f) => f.type === "reaction" && f.mid === "m1" && f.by === "agent" && f.emoji === "👍");
        const words = frames.findIndex((f) => f.type === "delta" || f.type === "message");
        return ack >= 0 && words > ack;
      },
    },
    {
      name: "reaction_on_agent_message",
      kind: "minefield",
      check: (w) => {
        const agents = new Set(w.entries().filter((e) => e.kind === "agent").map((e) => e.mid));
        return w.reactions().some((r) => r.by === AGENT && agents.has(r.mid));
      },
    },
  ],
  reference: "Muse step 2: `runtime.message_reactions:de8e3334-8b53-415c-b17e-463ad84254f8` set at context seq 52, before `memory_search` at seq 55 (`answers/step-2.md`).",
});

export default task;
