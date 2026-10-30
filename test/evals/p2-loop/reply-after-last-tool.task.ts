// T-P2-03 (B-P2-03): no words reach Sam before the last tool's result; the reply streams after it as one agent
// entry (Translation, delta 2: one streamed bubble, two paragraphs where Muse splits two). The fixture `steps_lookup`
// notes how many frames Sam's socket had when it ran; its result follows at once, before the next request.
import people from "../../fixtures/people.json" with { type: "json" };
import { defineTask } from "../../support/task.ts";
import type { Frame, P2World } from "./world.ts";

const sam = people.people.find((p) => p.id === "sam-solo")!;

export const PARAS = ["Method: I looked up both steps.", "Result: 4 files, 2 of them .md."];
const words = (f: Frame) => f.type === "delta" || f.type === "message";
const firstWords = (w: P2World) => w.frames().findIndex(words);
const lastTool = (w: P2World) => w.marks().at(-1)?.frames ?? -1;

export const task = defineTask<P2World>({
  id: "T-P2-03",
  cluster: "P2",
  clauses: ["B-P2-03"],
  priority: "must-have",
  tier: 1,
  setup: { seed: 3, records: ["chat:c1"], files: [], jobs: [] },
  turns: [{ kind: "prompt", by: sam.email, text: "Look up both steps and tell me what you find." }],
  end_state: ["no agent entry and no words frame before the second tool's result", "the reply streams as one agent entry after it", "the 👍 frame is the only frame before the words"],
  required_facts: ["the entry's text holds both paragraphs"],
  minefields: ["early_bubble"],
  collateral: { journal: ["mail:c1:1:user", "message:c1:1:you", "message:c1:2:agent", "turn:c1:1"] },
  graders: [
    { name: "no agent entry and no words frame before the second tool's result", kind: "end_state", check: (w) => w.marks().length === 2 && !w.frames().slice(0, lastTool(w)).some(words) },
    { name: "the reply streams as one agent entry after it", kind: "end_state", check: (w) => w.entries().filter((e) => e.kind === "agent").length === 1 && firstWords(w) >= lastTool(w) },
    {
      name: "the 👍 frame is the only frame before the words",
      kind: "end_state",
      check: (w) => {
        const before = w.frames().slice(0, firstWords(w));
        return before.filter((f) => f.type !== "turn_started").every((f) => f.type === "reaction" && f.by === "agent" && f.emoji === "👍");
      },
    },
    { name: "the entry's text holds both paragraphs", kind: "required_fact", check: (w) => w.entries().some((e) => e.kind === "agent" && e.text === PARAS.join("\n\n")) },
    { name: "early_bubble", kind: "minefield", check: (w) => w.frames().slice(0, lastTool(w)).some(words) },
  ],
  reference: "Muse steps 3 and 4 (`answers/step-3.md` 2: two rows, one context item, both after the last tool output); fletch streams one bubble and keeps `send_to_user` for a deliberate early message (delta 2).",
});

export default task;
