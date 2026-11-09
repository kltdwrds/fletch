// T-P13-05 (B-P13-05): one speak call with the reply verbatim in Sam's speaker, one MP3 in Sam's files, one audio record naming it, one audio chat item, no card, one Ledger row on route speech. Run by F71: skipped by name here (`skipped.test.ts`) until its own [F71] tier-1 run lands;
// the graders read what that part adds to the world (`world.ts`, the optional members), and the part refines them before
// its first run (no run has graded them, so a change then is not an oracle correction).
import { defineTask, type Grader } from "../../support/task.ts";
import type { P13World } from "./world.ts";
import { SPEAK_MODEL } from "./world.ts";

const graders: Grader<P13World>[] = [
  { name: "one audio record naming one MP3 in Sam's files", kind: "end_state", check: async (w) => (w.audio?.() ?? []).length === 1 && (await w.objects()).some((k) => k.endsWith((w.audio?.() ?? [])[0]?.path ?? "-")) },
  { name: "the text spoken is the reply verbatim in Sam's speaker", kind: "end_state", check: (w) => (w.speechCalls?.() ?? []).length === 1 && (w.speechCalls?.() ?? [])[0]?.inputs.text === w.replies()[0] && (w.speechCalls?.() ?? [])[0]?.inputs.speaker === w.voice?.().speaker },
  { name: "one Ledger row on route speech", kind: "end_state", check: (w) => (w.speechRows?.() ?? []).filter((r) => r.model === SPEAK_MODEL).length === 1 },
  { name: "paraphrased", kind: "minefield", check: (w) => (w.speechCalls?.() ?? []).some((c) => c.model === SPEAK_MODEL && c.inputs.text !== w.replies()[0]) },
  { name: "wrong_voice", kind: "minefield", check: (w) => (w.speechCalls?.() ?? []).some((c) => c.model === SPEAK_MODEL && c.inputs.speaker !== w.voice?.().speaker) },
  { name: "card_raised", kind: "minefield", check: (w) => (w.cards?.() ?? []).length > 0 },
  { name: "unasked_speech", kind: "minefield", check: (w) => (w.speechCalls?.() ?? []).filter((c) => c.model === SPEAK_MODEL).length > 1 },
];

export const task = defineTask<P13World>({
  id: "T-P13-05",
  cluster: "P13",
  clauses: ["B-P13-05"],
  priority: "must-have",
  tier: 1,
  setup: { seed: 1305, records: ["chat:c1 with one earlier reply", "the AI binding faked for aura-2-en", "Sam's voice record set to a catalog speaker"], files: [], jobs: [] },
  turns: [
    { kind: "prompt", by: "sam@solo-sam.example", text: "p13 probe: tell me one line about our picnic" },
    { kind: "prompt", by: "sam@solo-sam.example", text: "read your last reply aloud" },
  ],
  end_state: graders.filter((g) => g.kind === "end_state").map((g) => g.name),
  required_facts: graders.filter((g) => g.kind === "required_fact").map((g) => g.name),
  minefields: graders.filter((g) => g.kind === "minefield").map((g) => g.name),
  collateral: {},
  graders,
  reference: "Muse's one tts speak call and the audio item (answers/step-4.md, B-P13-05).",
});

export default task;
