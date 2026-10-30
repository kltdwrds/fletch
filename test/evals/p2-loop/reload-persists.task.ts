// T-P2-11 (B-P2-11, B-P2-12): a reload draws every stored thing again, once, and nothing optimistic: Sam's long
// task with the agent's 👍, the two-bubble reply (an early `send_to_user` message, then the reply), a failure
// sentence and a refusal, over twelve stored tool rows of which none is drawn. Without the file card (F24, T-P2-10).
// fletch sends the whole history on open, so the top is drawn already; the scroll is a turn that changes nothing.
import { defineTask } from "../../support/task.ts";
import type { LoopPageWorld } from "./page-world.ts";

const MESSAGES = new Set(["you", "agent", "note"]);
const unfence = (s: string) => s.replace(/^\[BEGIN EXTERNAL CONTENT source="[^"]*"\]\n/, "").replace(/\n\[END EXTERNAL CONTENT source="[^"]*"\]$/, "");
const drawnMessages = (w: LoopPageWorld) => w.drawn().filter((d) => MESSAGES.has(d.kind));
const storedMessages = (w: LoopPageWorld) => w.stored().filter((e) => e.kind !== "thinking");
const idle = (w: LoopPageWorld) => ((s) => !s.dots && s.status === null && !s.stop)(w.working());
const toolDrawn = (w: LoopPageWorld) => w.drawn().some((d) => d.text.includes("EXTERNAL CONTENT") || w.toolRows().some((t) => d.text.includes(unfence(t.text))));

export const task = defineTask<LoopPageWorld>({
  id: "T-P2-11",
  cluster: "P2",
  clauses: ["B-P2-11", "B-P2-12"],
  priority: "must-have",
  tier: 1,
  setup: { seed: 11, records: ["chat:c1 (a long task with the agent's 👍 and a two-bubble reply, a failed read, a refused print; twelve tool rows)"], files: [], jobs: [] },
  turns: [
    { kind: "event", name: "reload" },
    { kind: "event", name: "scroll_top" },
  ],
  end_state: ["every stored message is drawn once, in order", "twelve tool rows are stored and none is drawn", "the 👍 is drawn on Sam's long task", "no typing dots, no status, no stop control after the reload"],
  required_facts: [],
  minefields: ["tool_row_drawn", "optimistic_left"],
  collateral: {},
  graders: [
    {
      name: "every stored message is drawn once, in order",
      kind: "end_state",
      check: (w) => {
        const drawn = drawnMessages(w).map((d) => d.text);
        const stored = storedMessages(w).map((e) => e.text ?? "");
        return stored.length >= 7 && JSON.stringify(drawn) === JSON.stringify(stored);
      },
    },
    { name: "twelve tool rows are stored and none is drawn", kind: "end_state", check: (w) => w.toolRows().length === 12 && !toolDrawn(w) },
    { name: "the 👍 is drawn on Sam's long task", kind: "end_state", check: (w) => drawnMessages(w)[0]?.kind === "you" && drawnMessages(w)[0]!.reactions.includes("👍") },
    { name: "no typing dots, no status, no stop control after the reload", kind: "end_state", check: (w) => idle(w) && w.seen().every((s) => !s.working.dots && s.working.status === null && !s.working.stop) },
    { name: "tool_row_drawn", kind: "minefield", check: (w) => toolDrawn(w) },
    { name: "optimistic_left", kind: "minefield", check: (w) => !idle(w) },
  ],
  reference: "Muse `step-8-dom.md` (40 of 45 articles, every item present after scrolling), `step-8-step3-region.png` (the 👍 and both bubbles).",
});

export default task;
