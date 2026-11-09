// T-P13-12 (B-P13-13): the record marked removed and its object moved under the person's trash prefix in one action; restore brings both back; nothing about the file is held outside the deploy. Run by F71: skipped by name here (`skipped.test.ts`) until its own [F71] tier-1 run lands;
// the graders read what that part adds to the world (`world.ts`, the optional members), and the part refines them before
// its first run (no run has graded them, so a change then is not an oracle correction).
import { defineTask, type Grader } from "../../support/task.ts";
import type { P13World } from "./world.ts";
import { SPEAK_MODEL } from "./world.ts";

const graders: Grader<P13World>[] = [
  { name: "restore brought the record and the object back", kind: "end_state", check: async (w) => (w.audio?.() ?? []).length === 1 && !(w.audio?.() ?? [])[0]?.removed && (await w.objects()).some((k) => k.endsWith((w.audio?.() ?? [])[0]?.path ?? "-")) },
  { name: "hard_delete", kind: "minefield", check: (w) => (w.audio?.() ?? []).length === 0 },
  { name: "orphan_object", kind: "minefield", check: async (w) => (await w.objects()).some((k) => k.includes("/trash/")) },
  { name: "external_copy", kind: "minefield", check: (w) => (w.speechCalls?.() ?? []).some((c) => c.model !== SPEAK_MODEL) },
];

export const task = defineTask<P13World>({
  id: "T-P13-12",
  cluster: "P13",
  clauses: ["B-P13-13"],
  priority: "must-have",
  tier: 1,
  setup: { seed: 1312, records: ["chat:c1 after T-P13-05's render"], files: [], jobs: [] },
  turns: [
    { kind: "prompt", by: "sam@solo-sam.example", text: "remove that audio" },
    { kind: "prompt", by: "sam@solo-sam.example", text: "restore it" },
  ],
  end_state: graders.filter((g) => g.kind === "end_state").map((g) => g.name),
  required_facts: graders.filter((g) => g.kind === "required_fact").map((g) => g.name),
  minefields: graders.filter((g) => g.kind === "minefield").map((g) => g.name),
  collateral: {},
  graders,
  reference: "Muse's trash.put and its un-removable media-artifact (B-P13-13).",
});

export default task;
