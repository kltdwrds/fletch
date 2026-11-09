// T-P13-16 (B-P13-10): Sam picks another speaker in Settings > Voice; the same record holds it with one journal row whose writer is settings, and the next read-aloud uses it. Run by F72 (`surfaces.test.ts`);
// the graders read what that part adds to the world (`world.ts`, the optional members), and the part refines them before
// its first run (no run has graded them, so a change then is not an oracle correction).
import { defineTask, type Grader } from "../../support/task.ts";
import type { P13World } from "./world.ts";
import { SPEAK_MODEL } from "./world.ts";

const graders: Grader<P13World>[] = [
  { name: "the record holds the speaker with one settings journal row", kind: "end_state", check: (w) => w.voice?.().speaker === "orion" && (w.voice?.().changes ?? []).filter((c) => c.writer === "settings").length === 1 },
  { name: "the next read-aloud uses it", kind: "end_state", check: (w) => (w.speechCalls?.() ?? []).some((c) => c.model === SPEAK_MODEL && c.inputs.speaker === "orion") },
  { name: "second_store", kind: "minefield", check: (w) => (w.voice?.().changes ?? []).some((c) => c.speaker !== w.voice?.().speaker) },
];

export const task = defineTask<P13World>({
  id: "T-P13-16",
  cluster: "P13",
  clauses: ["B-P13-10"],
  priority: "nice-to-have",
  tier: 1,
  setup: { seed: 1316, records: ["Sam's voice record set", "the Settings page"], files: [], jobs: [] },
  turns: [
    { kind: "event", name: "settings-voice", payload: {"speaker": "orion"} },
    { kind: "prompt", by: "sam@solo-sam.example", text: "read your last reply aloud" },
  ],
  end_state: graders.filter((g) => g.kind === "end_state").map((g) => g.name),
  required_facts: graders.filter((g) => g.kind === "required_fact").map((g) => g.name),
  minefields: graders.filter((g) => g.kind === "minefield").map((g) => g.name),
  collateral: {},
  graders,
  reference: "B-P13-10 (Settings Voice row, step-1-dom.md).",
});

export default task;
