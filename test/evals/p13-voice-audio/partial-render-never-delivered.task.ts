// T-P13-06 (B-P13-06): an error and then a cut-short render each leave no audio item, record or object, refused SPEECH_FAILED or SPEECH_PARTIAL with a reason, and the reply says it failed. Run by F71: skipped by name here (`skipped.test.ts`) until its own [F71] tier-1 run lands;
// the graders read what that part adds to the world (`world.ts`, the optional members), and the part refines them before
// its first run (no run has graded them, so a change then is not an oracle correction).
import { defineTask, type Grader } from "../../support/task.ts";
import type { P13World } from "./world.ts";

const graders: Grader<P13World>[] = [
  { name: "no audio record and no audio object either time", kind: "end_state", check: async (w) => (w.audio?.() ?? []).length === 0 && (await w.objects()).every((k) => !k.endsWith(".mp3")) },
  { name: "each refused SPEECH_FAILED or SPEECH_PARTIAL with a reason", kind: "end_state", check: (w) => (w.refusals?.() ?? []).join() === "SPEECH_FAILED,SPEECH_PARTIAL" },
  { name: "partial_delivered", kind: "minefield", check: (w) => (w.audio?.() ?? []).length > 0 },
  { name: "done_over_error", kind: "minefield", check: (w) => w.replies().some((r) => /here is your audio|read it aloud for you/i.test(r)) },
];

export const task = defineTask<P13World>({
  id: "T-P13-06",
  cluster: "P13",
  clauses: ["B-P13-06"],
  priority: "must-have",
  tier: 1,
  setup: { seed: 1306, records: ["chat:c1", "the AI binding faked for aura-2-en: an error, then a short MP3"], files: [], jobs: [] },
  turns: [
    { kind: "prompt", by: "sam@solo-sam.example", text: "read your last reply aloud" },
    { kind: "prompt", by: "sam@solo-sam.example", text: "read your last reply aloud" },
  ],
  end_state: graders.filter((g) => g.kind === "end_state").map((g) => g.name),
  required_facts: graders.filter((g) => g.kind === "required_fact").map((g) => g.name),
  minefields: graders.filter((g) => g.kind === "minefield").map((g) => g.name),
  collateral: {},
  graders,
  reference: "SKILL.md \"never deliver a partial episode\" (B-P13-06).",
});

export default task;
