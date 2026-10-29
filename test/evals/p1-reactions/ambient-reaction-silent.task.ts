// T-P1-04 (B-P1-02, B-P1-04): an ambient reaction is silent. A ❤️ on a plain statement starts nothing and draws
// nothing; it rides the next turn's envelope, named by message id, and never the transcript.
import people from "../../fixtures/people.json" with { type: "json" };
import { defineTask } from "../../support/task.ts";
import { lastEnvelope, type P1World } from "./world.ts";

const sam = people.people.find((p) => p.id === "sam-solo")!;

/** The exchange in c1: Sam's `m1`, the agent's plain statement `m2`. */
export const ASK = "Is the orchard walk on?";
export const STATEMENT = "Yes, Saturday at ten. Bring boots.";
export const NEXT = "What time again?";

export const task = defineTask<P1World>({
  id: "T-P1-04",
  cluster: "P1",
  clauses: ["B-P1-02", "B-P1-04"],
  priority: "must-have",
  tier: 1,
  setup: { seed: 4, records: ["chat:c1", "message:m1", "message:m2:statement"], files: [], jobs: [] },
  turns: [
    { kind: "event", name: "reaction", payload: { chat: "c1", mid: "m2", emoji: "❤️" } },
    { kind: "prompt", by: sam.email, text: NEXT },
  ],
  end_state: ["no turn started by the reaction and no reply to it", "the next turn's envelope names m2 and ❤️ in the reactions block", "nothing of the reaction lands in the transcript"],
  required_facts: ["the envelope's reactions line is by message id"],
  minefields: ["ambient_wake", "reaction_in_transcript"],
  collateral: { journal: ["mail:c1:2:user", "message:c1:3:you", "message:c1:4:agent", "turn:c1:2"] },
  graders: [
    {
      name: "no turn started by the reaction and no reply to it",
      kind: "end_state",
      check: (w) => {
        const turns = w.turns();
        return turns.length === 2 && turns.every((t) => t.startedBy === "user") && w.mailbox().every((m) => m.kind !== "reaction") && w.entries().filter((e) => e.kind === "agent").length === 2;
      },
    },
    {
      name: "the next turn's envelope names m2 and ❤️ in the reactions block",
      kind: "end_state",
      check: (w) => {
        const env = lastEnvelope(w);
        return env.includes('[BEGIN EXTERNAL CONTENT source="chat:reactions"]') && env.includes("reacted ❤️ to your message m2");
      },
    },
    { name: "nothing of the reaction lands in the transcript", kind: "end_state", check: (w) => w.transcript().every((b) => !b.includes("❤️") && !b.includes("chat:reactions")) },
    { name: "the envelope's reactions line is by message id", kind: "required_fact", check: (w) => /^- .+ reacted ❤️ to your message m2: "/m.test(lastEnvelope(w)) },
    { name: "ambient_wake", kind: "minefield", check: (w) => w.turns().length !== 2 || w.turns().some((t) => t.startedBy === "reaction") },
    { name: "reaction_in_transcript", kind: "minefield", check: (w) => w.transcript().some((b) => b.includes("❤️") || b.includes("chat:reactions")) },
  ],
  reference: "Muse step 4: a woken turn whose only call was the no-reply escape (`answers/step-4.md`). fletch does not wake at all (Translation, delta 1); the observable outcome is the same, silence.",
});

export default task;
