// T-P1-07 (B-P1-08, B-P1-09): a person removes their own reaction by sending the same emoji again. The frame
// says null, the row is gone, the agent's row on the other message stays, a reload shows the same, and nothing
// woke. The reactions table is read by the graders and deliberately not snapshotted (`world.ts`): the kit grades a
// removed snapshot key as collateral, and the removal is the point of this task.
import { defineTask } from "../../support/task.ts";
import { AGENT, type P1World } from "./world.ts";

/** The exchange in c1: Sam's `m1` (agent 👍 on it), the agent's `m2` (Sam's ❤️ on it). */
export const ASK = "Is the orchard walk on?";
export const ANSWER = "Yes, Saturday at ten. Bring boots.";

export const task = defineTask<P1World>({
  id: "T-P1-07",
  cluster: "P1",
  clauses: ["B-P1-08", "B-P1-09"],
  priority: "must-have",
  tier: 1,
  setup: { seed: 7, records: ["chat:c1", "message:m1", "message:m2", "reaction:m1:agent:👍", "reaction:m2:sam:❤️"], files: [], jobs: [] },
  turns: [{ kind: "event", name: "reaction", payload: { chat: "c1", mid: "m2", emoji: "❤️" } }],
  end_state: ["the second ❤️ removed Sam's reaction on m2: the frame says null and the row is gone", "the agent's 👍 on m1 is untouched", "a reload shows m1 with the agent's 👍 and m2 bare"],
  required_facts: ["no turn started and no reaction mail"],
  minefields: ["removal_wake", "other_side_removed"],
  collateral: {},
  graders: [
    {
      name: "the second ❤️ removed Sam's reaction on m2: the frame says null and the row is gone",
      kind: "end_state",
      check: (w) => {
        const last = w.frames().findLast((f) => f.type === "reaction" && f.mid === "m2");
        return last?.by === "you" && last.emoji === null && w.reactions().every((r) => r.mid !== "m2");
      },
    },
    { name: "the agent's 👍 on m1 is untouched", kind: "end_state", check: (w) => JSON.stringify(w.reactions()) === JSON.stringify([{ mid: "m1", by: AGENT, emoji: "👍" }]) },
    {
      name: "a reload shows m1 with the agent's 👍 and m2 bare",
      kind: "end_state",
      check: async (w) => {
        const entries = await w.reload();
        const m1 = entries.find((e) => e.mid === "m1");
        const m2 = entries.find((e) => e.mid === "m2");
        return JSON.stringify(m1?.reactions ?? []) === JSON.stringify([{ by: "agent", emoji: "👍" }]) && (m2?.reactions ?? []).length === 0;
      },
    },
    { name: "no turn started and no reaction mail", kind: "required_fact", check: (w) => w.turns().length === 1 && w.mailbox().every((m) => m.kind !== "reaction") },
    { name: "removal_wake", kind: "minefield", check: (w) => w.turns().length !== 1 || w.mailbox().some((m) => m.kind === "reaction") },
    { name: "other_side_removed", kind: "minefield", check: (w) => !w.reactions().some((r) => r.mid === "m1" && r.by === AGENT && r.emoji === "👍") },
  ],
  reference: "Muse step 7 (`step-7-after.png`, `answers/step-7.md`): the same emoji again removes; the assistant's own reaction stays.",
});

export default task;
