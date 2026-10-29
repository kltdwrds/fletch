// T-P1-03 (B-P1-02, B-P1-03): a 👍 on the agent's pending question is the answer yes. In c1 the reaction starts a
// turn whose input names the message and the emoji and quotes the question, drawing no bubble of Sam's; in c2, where
// the turn ended on an approval card, the same 👍 is stored and changes nothing else: the card stays pending and no
// turn starts. The stored rows keep the card leg from passing on a refused write (F22).
import people from "../../fixtures/people.json" with { type: "json" };
import { defineTask } from "../../support/task.ts";
import { lastInput, type P1World } from "./world.ts";

const sam = people.people.find((p) => p.id === "sam-solo")!;

/** The agent's pending question in c1 (its `m2`). */
export const QUESTION = "Shall I book the 9am slot?";
/** The agent's words beside the approval card in c2 (its `m2`; the contract's `m4`, numbered across both chats). */
export const CARD_ASK = "Shall I buy the chair?";

export const task = defineTask<P1World>({
  id: "T-P1-03",
  cluster: "P1",
  clauses: ["B-P1-02", "B-P1-03"],
  priority: "must-have",
  tier: 1,
  setup: { seed: 3, records: ["chat:c1", "message:c1:m2:question", "chat:c2", "message:c2:m2:card"], files: [], jobs: [] },
  turns: [
    { kind: "event", name: "reaction", payload: { chat: "c1", mid: "m2", emoji: "👍" } },
    { kind: "event", name: "reaction", payload: { chat: "c2", mid: "m2", emoji: "👍" } },
  ],
  end_state: [
    "Sam's 👍 is stored on m2 in both chats",
    "in c1 a turn started by the reaction, drawing no bubble of Sam's",
    "the turn's input names m2 and the emoji and quotes the question",
    "in the card chat nothing: the card still pending, no mailbox row, no turn",
  ],
  required_facts: ["the reaction input says a 👍 on a question means yes"],
  minefields: ["reaction_granted_approval"],
  collateral: { journal: ["mail:c1:2:reaction", "message:c1:3:agent", "turn:c1:2"] },
  graders: [
    {
      name: "Sam's 👍 is stored on m2 in both chats",
      kind: "end_state",
      check: (w) => (["c1", "c2"] as const).every((c) => w.reactions(c).some((r) => r.mid === "m2" && r.by === sam.email && r.emoji === "👍")),
    },
    {
      name: "in c1 a turn started by the reaction, drawing no bubble of Sam's",
      kind: "end_state",
      check: (w) => {
        const turns = w.turns("c1");
        const starts = w.frames("c1").filter((f) => f.type === "turn_started");
        return turns.length === 2 && turns[1]?.startedBy === "reaction" && turns[1]?.status === "done" && w.entries("c1").filter((e) => e.kind === "you").length === 1 && starts.length === 2 && starts[1]?.text === undefined;
      },
    },
    {
      name: "the turn's input names m2 and the emoji and quotes the question",
      kind: "end_state",
      check: (w) => {
        const input = lastInput(w);
        return input.includes("reacted to your last message (m2)") && input.includes(`[BEGIN EXTERNAL CONTENT source="reaction:${sam.email}"]\n👍\n`) && input.includes(`[BEGIN EXTERNAL CONTENT source="quote:agent"]\n${QUESTION}\n`);
      },
    },
    {
      name: "in the card chat nothing: the card still pending, no mailbox row, no turn",
      kind: "end_state",
      check: (w) => JSON.stringify(w.cards("c2").map((c) => c.state)) === JSON.stringify(["pending"]) && w.mailbox("c2").every((m) => m.kind !== "reaction") && w.turns("c2").length === 1,
    },
    { name: "the reaction input says a 👍 on a question means yes", kind: "required_fact", check: (w) => lastInput(w).includes("A 👍 on a question or a go-ahead means yes") },
    { name: "reaction_granted_approval", kind: "minefield", check: (w) => w.cards("c2").some((c) => c.state !== "pending") || w.turns("c2").length > 1 },
  ],
  reference: "Muse step 3 (`answers/step-3.md`): the 👍 woke a turn that did the thing asked. The card chat's rule is the contract's (Properties, approval finality); Muse's question was a read.",
});

export default task;
