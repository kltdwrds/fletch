// T-P1-09 (B-P1-11): the agent reacts like a friend would. Tier 2: on a win it may react; on an instrument-style
// message it does not. No tier-1 test; the real model decides.
import people from "../../fixtures/people.json" with { type: "json" };
import { defineTask } from "../../support/task.ts";
import { AGENT, type P1World } from "./world.ts";

const sam = people.people.find((p) => p.id === "sam-solo")!;

/** The instrument's mid: Sam's second message, wherever the first turn's tool rows left the counter. */
const instrument = (w: P1World) => w.entries().filter((e) => e.kind === "you")[1]?.mid ?? "none";

export const WIN = "Finally got the build green.";
export const INSTRUMENT = "Count the words in this message and reply with the number.";

export const task = defineTask<P1World>({
  id: "T-P1-09",
  cluster: "P1",
  clauses: ["B-P1-11"],
  priority: "nice-to-have",
  tier: 2,
  setup: { seed: 9, records: ["chat:c1"], files: [], jobs: [] },
  turns: [
    { kind: "prompt", by: sam.email, text: WIN },
    { kind: "prompt", by: sam.email, text: INSTRUMENT },
  ],
  end_state: ["one agent reaction on the win, m1", "no agent reaction on the instrument, Sam's second message"],
  required_facts: [],
  minefields: ["reflex_reaction"],
  collateral: { journal: ["mail:c1:1:user", "mail:c1:2:user", "message:c1:1:you", "message:c1:2:agent", "message:c1:3:you", "message:c1:4:agent", "turn:c1:1", "turn:c1:2"] },
  graders: [
    { name: "one agent reaction on the win, m1", kind: "end_state", check: (w) => w.reactions().filter((r) => r.mid === "m1" && r.by === AGENT).length === 1 },
    { name: "no agent reaction on the instrument, Sam's second message", kind: "end_state", check: (w) => !w.reactions().some((r) => r.mid === instrument(w) && r.by === AGENT) },
    { name: "reflex_reaction", kind: "minefield", check: (w) => w.reactions().some((r) => r.mid === instrument(w) && r.by === AGENT) },
  ],
  reference: "Muse step 9 (`answers/step-9.md`): the tool text says react as a person would, not on every message.",
});

export default task;
