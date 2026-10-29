// T-P1-10 (B-P1-07): the care register is accepted and kept. The agent's `react 🫶` on Sam's news is not refused,
// is stored as that one grapheme (U+1FAF6, not normalised to ❤️ or 🙏), and is drawn after a reload.
import people from "../../fixtures/people.json" with { type: "json" };
import { defineTask } from "../../support/task.ts";
import { AGENT, type P1World } from "./world.ts";

const sam = people.people.find((p) => p.id === "sam-solo")!;

export const NEWS = "My dad's scan came back and it is not good.";
export const FIRST_REPLY = "I am here. Tell me what you need tonight.";
export const PROMPT = "Thanks. I will drive up after work.";
export const CARE = "🫶";

export const task = defineTask<P1World>({
  id: "T-P1-10",
  cluster: "P1",
  clauses: ["B-P1-07"],
  priority: "must-have",
  tier: 1,
  setup: { seed: 10, records: ["chat:c1", "message:m1"], files: [], jobs: [] },
  turns: [{ kind: "prompt", by: sam.email, text: PROMPT }],
  end_state: ["one agent row on m1 and it is 🫶, one grapheme, U+1FAF6", "a reload draws 🫶 on m1"],
  required_facts: [],
  minefields: ["care_refused", "care_normalised"],
  collateral: { journal: ["mail:c1:2:user", "message:c1:3:you", "message:c1:4:agent", "turn:c1:2"] },
  graders: [
    {
      name: "one agent row on m1 and it is 🫶, one grapheme, U+1FAF6",
      kind: "end_state",
      check: (w) => {
        const rows = w.reactions().filter((r) => r.mid === "m1" && r.by === AGENT);
        if (rows.length !== 1) return false;
        const e = rows[0].emoji;
        return e === CARE && [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(e)].length === 1 && e.codePointAt(0) === 0x1faf6;
      },
    },
    {
      name: "a reload draws 🫶 on m1",
      kind: "end_state",
      check: async (w) => {
        const m1 = (await w.reload()).find((e) => e.mid === "m1");
        return JSON.stringify(m1?.reactions ?? []) === JSON.stringify([{ by: "agent", emoji: CARE }]);
      },
    },
    { name: "care_refused", kind: "minefield", check: (w) => w.requests().some((r) => r.messages.at(-1)?.text.includes("REACTION_UNKNOWN") === true) },
    { name: "care_normalised", kind: "minefield", check: (w) => w.reactions().some((r) => r.mid === "m1" && r.by === AGENT && r.emoji !== CARE) },
  ],
  reference: "Muse step 6 (`answers/step-6.md`): `hatch:heart_v1` stored and drawn; fletch's register is 🫶 (Translation, delta 5).",
});

export default task;
