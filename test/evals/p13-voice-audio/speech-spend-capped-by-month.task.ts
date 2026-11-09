// T-P13-15 (B-P13-14): every speech call has a model_calls row on route speech priced from SPEECH_PRICES; the call after the monthly cap is refused SPEECH_BUDGET_EXHAUSTED before any AI.run; the next voice note is kept untranscribed with the same code; an unpriced speech model is refused MODEL_UNPRICED. Run by F71: skipped by name here (`skipped.test.ts`) until its own [F71] tier-1 run lands;
// the graders read what that part adds to the world (`world.ts`, the optional members), and the part refines them before
// its first run (no run has graded them, so a change then is not an oracle correction).
import { defineTask, type Grader } from "../../support/task.ts";
import type { P13World } from "./world.ts";

const graders: Grader<P13World>[] = [
  { name: "every speech call has a priced row on route speech", kind: "end_state", check: (w) => (w.speechRows?.() ?? []).length === (w.speechCalls?.() ?? []).length && (w.speechRows?.() ?? []).every((r) => r.route === "speech" && r.costMicros > 0) },
  { name: "the call after the cap refused SPEECH_BUDGET_EXHAUSTED", kind: "end_state", check: (w) => (w.refusals?.() ?? []).includes("SPEECH_BUDGET_EXHAUSTED") },
  { name: "the voice note after the cap kept untranscribed with the same code", kind: "end_state", check: (w) => w.rows().some((r) => r.cls === "audio" && r.code === "SPEECH_BUDGET_EXHAUSTED" && r.transcript === null) },
  { name: "call_over_cap", kind: "minefield", check: (w) => (w.speechCalls?.() ?? []).length > (w.speechRows?.() ?? []).length },
  { name: "unpriced_call", kind: "minefield", check: (w) => (w.speechRows?.() ?? []).some((r) => !(r.costMicros > 0)) },
  { name: "silent_refusal", kind: "minefield", check: (w) => !w.replies().some((r) => r.includes("SPEECH_BUDGET_EXHAUSTED")) },
];

export const task = defineTask<P13World>({
  id: "T-P13-15",
  cluster: "P13",
  clauses: ["B-P13-14"],
  priority: "must-have",
  tier: 1,
  setup: { seed: 1315, records: ["chat:c1", "the Ledger's tenantSpeechMonthlyMicros set to a few cents", "the speech fakes as T-P13-02 and T-P13-05"], files: ["p13-probe.mp3"], jobs: [] },
  turns: [
    { kind: "prompt", by: "sam@solo-sam.example", text: "read your last reply aloud" },
    { kind: "prompt", by: "sam@solo-sam.example", text: "read your last reply aloud" },
    { kind: "prompt", by: "sam@solo-sam.example", text: "read your last reply aloud" },
    { kind: "event", name: "voice-note", payload: {"name": "p13-probe.mp3"} },
  ],
  end_state: graders.filter((g) => g.kind === "end_state").map((g) => g.name),
  required_facts: graders.filter((g) => g.kind === "required_fact").map((g) => g.name),
  minefields: graders.filter((g) => g.kind === "minefield").map((g) => g.name),
  collateral: {},
  graders,
  reference: "D-0026 (spend under a Ledger price, Kyle's ruling 2026-11-08); B-P13-14.",
});

export default task;
