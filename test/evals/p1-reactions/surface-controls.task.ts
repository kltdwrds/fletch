// T-P1-08 (B-P1-09, B-P1-10): the surface's controls. At 1440 the hover row under the agent's message offers React
// and the person's own messages do not; React opens a "Reactions" dialog with the six and a disabled More
// reactions; at 390 the ⋯ under the agent's message opens the "Message actions" sheet with reactions, Reply and
// Copy, and under the person's own message the same sheet with Reply and Copy only.
//
// The words are the shipped page's (`MESSAGE_TEXT` in `packages/agent/src/http/app/message-actions.ts`), written
// here rather than imported so the task stays pure; the harness checks them against the page once.
//
// Known against shipped code (Translation, delta 6; a part for F21): the phone sheet offers reactions under the
// person's own message too. The `react_on_own_message` minefield steps on it, and `surface-controls.test.ts` records
// the failure by name instead of hiding it.
import { defineTask } from "../../support/task.ts";
import type { PageWorld } from "./page-world.ts";

export const WORDS = { react: "React", reply: "Reply", copy: "Copy", reactions: "Reactions", reactWith: "React with ", moreReactions: "More reactions" };
/** The six, in the picker's order, as `REACTIONS` names them. */
export const SIX = ["thumbs up", "heart", "laughing face", "surprised face", "crying face", "folded hands"].map((l) => WORDS.reactWith + l);

export const HISTORY = [
  { kind: "you", mid: "m1", text: "Is the orchard walk on?" },
  { kind: "agent", mid: "m2", text: "Yes, Saturday at ten. Bring boots." },
  { kind: "you", mid: "m3", text: "Great, see you there." },
];

const hasReact = (row: string[] | null) => (row ?? []).includes(WORDS.react);

export const task = defineTask<PageWorld>({
  id: "T-P1-08",
  cluster: "P1",
  clauses: ["B-P1-09", "B-P1-10"],
  priority: "must-have",
  tier: 1,
  setup: { seed: 8, records: ["page:history:m1:sam", "page:history:m2:agent", "page:history:m3:sam"], files: [], jobs: [] },
  turns: [
    { kind: "event", name: "hover", payload: { mid: "m2", width: "1440" } },
    { kind: "event", name: "open_picker", payload: { mid: "m2", width: "1440" } },
    { kind: "event", name: "open_more", payload: { mid: "m2", width: "390" } },
    { kind: "event", name: "open_more", payload: { mid: "m3", width: "390" } },
  ],
  end_state: [
    "the hover row under the agent's message offers React and the person's own rows do not",
    "React opens a Reactions dialog with six enabled reactions and a More reactions control",
    "the phone sheet under the agent's message offers reactions, Reply and Copy",
    "the phone sheet under the person's own message offers Reply and Copy",
  ],
  required_facts: ["the picker's six are the shipped set in order, and More reactions is disabled"],
  minefields: ["react_on_own_message"],
  collateral: {},
  graders: [
    { name: "the hover row under the agent's message offers React and the person's own rows do not", kind: "end_state", check: (w) => hasReact(w.hoverRow("m2")) && !hasReact(w.hoverRow("m1")) && !hasReact(w.hoverRow("m3")) },
    {
      name: "React opens a Reactions dialog with six enabled reactions and a More reactions control",
      kind: "end_state",
      check: (w) => {
        const p = w.picker("m2");
        if (!p) return false;
        const six = p.controls.filter((c) => c.label.startsWith(WORDS.reactWith));
        return p.role === "dialog" && p.label === WORDS.reactions && six.length === 6 && six.every((c) => !c.disabled) && p.controls.some((c) => c.label === WORDS.moreReactions);
      },
    },
    {
      name: "the phone sheet under the agent's message offers reactions, Reply and Copy",
      kind: "end_state",
      check: (w) => {
        const s = w.sheet("m2");
        return !!s && s.form === "sheet" && s.emojis.length > 0 && s.rows.includes(WORDS.reply) && s.rows.includes(WORDS.copy);
      },
    },
    {
      name: "the phone sheet under the person's own message offers Reply and Copy",
      kind: "end_state",
      check: (w) => {
        const s = w.sheet("m3");
        return !!s && s.form === "sheet" && s.rows.includes(WORDS.reply) && s.rows.includes(WORDS.copy);
      },
    },
    {
      name: "the picker's six are the shipped set in order, and More reactions is disabled",
      kind: "required_fact",
      check: (w) => {
        const p = w.picker("m2");
        if (!p) return false;
        return JSON.stringify(p.controls.filter((c) => c.label.startsWith(WORDS.reactWith)).map((c) => c.label)) === JSON.stringify(SIX) && p.controls.filter((c) => c.label === WORDS.moreReactions).every((c) => c.disabled);
      },
    },
    { name: "react_on_own_message", kind: "minefield", check: (w) => hasReact(w.hoverRow("m1")) || hasReact(w.hoverRow("m3")) || (w.sheet("m3")?.emojis.length ?? 0) > 0 },
  ],
  reference: "Muse step 8 (`step-8-hover.png`, `step-8-picker.png`, `step-8-sheet.png`, `answers/step-8.md`): the hover row, the picker and the sheet; no reaction control on the person's own message.",
});

export default task;
