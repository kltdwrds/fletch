// T-P1-05 (B-P1-05, B-P1-06): one row per message per reactor. The agent's 🚀 then ❤️ on m1 replace in place, the
// same ❤️ again changes nothing (the frame says ❤️, never null: set, not toggled), a react on its own message m2
// is refused `REACTION_TARGET_NOT_PERSON`, and nothing lands on m2.
//
// The contract's required fact reads "the row's `at` is the second call's, or the result says so": fletch's `set`
// rewrites `at` on a same-emoji re-set (`ON CONFLICT DO UPDATE`) and the result does not say `changed`, and neither
// is visible to Sam; the grader reads what is: one row, still ❤️, and the third call's frame ❤️ rather than null.
import people from "../../fixtures/people.json" with { type: "json" };
import { defineTask } from "../../support/task.ts";
import { AGENT, type P1World } from "./world.ts";

const sam = people.people.find((p) => p.id === "sam-solo")!;

/** The exchange in c1: Sam's `m1`, the agent's `m2`. */
export const ASK = "Is the orchard walk on?";
export const ANSWER = "Yes, Saturday at ten. Bring boots.";
export const PROMPT = "React to my first message a few ways.";

export const task = defineTask<P1World>({
  id: "T-P1-05",
  cluster: "P1",
  clauses: ["B-P1-05", "B-P1-06"],
  priority: "must-have",
  tier: 1,
  setup: { seed: 5, records: ["chat:c1", "message:m1", "message:m2"], files: [], jobs: [] },
  turns: [{ kind: "prompt", by: sam.email, text: PROMPT }],
  end_state: ["one agent row on m1 with ❤️", "the fourth call was refused REACTION_TARGET_NOT_PERSON", "nothing on m2"],
  required_facts: ["the third call changed nothing: one row, still ❤️, its frame ❤️ and not null"],
  minefields: ["second_row_same_reactor", "reaction_on_agent_message"],
  collateral: { journal: ["mail:c1:2:user", "message:c1:3:you", "message:c1:4:agent", "turn:c1:2"] },
  graders: [
    { name: "one agent row on m1 with ❤️", kind: "end_state", check: (w) => JSON.stringify(w.reactions().filter((r) => r.mid === "m1")) === JSON.stringify([{ mid: "m1", by: AGENT, emoji: "❤️" }]) },
    { name: "the fourth call was refused REACTION_TARGET_NOT_PERSON", kind: "end_state", check: (w) => w.requests().some((r) => r.messages.at(-1)?.text.includes("REACTION_TARGET_NOT_PERSON") === true) },
    { name: "nothing on m2", kind: "end_state", check: (w) => w.reactions().every((r) => r.mid !== "m2") },
    {
      name: "the third call changed nothing: one row, still ❤️, its frame ❤️ and not null",
      kind: "required_fact",
      check: (w) => {
        const set = w.frames().filter((f) => f.type === "reaction" && f.mid === "m1" && f.by === "agent").map((f) => f.emoji);
        return JSON.stringify(set) === JSON.stringify(["🚀", "❤️", "❤️"]) && w.reactions().filter((r) => r.mid === "m1").length === 1;
      },
    },
    { name: "second_row_same_reactor", kind: "minefield", check: (w) => w.reactions().filter((r) => r.mid === "m1" && r.by === AGENT).length > 1 },
    {
      name: "reaction_on_agent_message",
      kind: "minefield",
      check: (w) => {
        const agents = new Set(w.entries().filter((e) => e.kind === "agent").map((e) => e.mid));
        return w.reactions().some((r) => r.by === AGENT && agents.has(r.mid));
      },
    },
  ],
  reference: "Muse step 5 D1-D4 (`answers/step-5.md`): replace, idempotent re-set, no target for an assistant message.",
});

export default task;
