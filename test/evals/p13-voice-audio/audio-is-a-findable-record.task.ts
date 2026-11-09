// T-P13-07 (B-P13-07): the record holds kind audio, duration, voice, model, the source text and its file path; the agent's answer comes from audio_list or audio_read; the Library's Audio section lists the item and opens its player. Run by F71 (the record and the agent's read) and F72 (the Library's Audio section): F72 runs it whole (`surfaces.test.ts`);
// the graders read what that part adds to the world (`world.ts`, the optional members), and the part refines them before
// its first run (no run has graded them, so a change then is not an oracle correction).
import { defineTask, type Grader } from "../../support/task.ts";
import type { P13World } from "./world.ts";
import { SPEAK_MODEL } from "./world.ts";

const graders: Grader<P13World>[] = [
  { name: "the record holds kind, duration, voice, model, source and path", kind: "end_state", check: (w) => (w.audio?.() ?? []).some((a) => a.kind === "audio" && a.durationMs > 0 && !!a.voice && a.model === SPEAK_MODEL && !!a.source && !!a.path) },
  { name: "the answer came from audio_list or audio_read", kind: "end_state", check: (w) => w.results().some((r) => r.tool === "audio_list" || r.tool === "audio_read") },
  { name: "the Library's Audio section lists it with a player (F72)", kind: "end_state", check: async (w) => ((await w.library?.()) ?? []).some((l) => l.player && (w.audio?.() ?? []).some((a) => a.id === l.id)) },
  { name: "loose_file", kind: "minefield", check: async (w) => (await w.objects()).some((k) => k.endsWith(".mp3") && !(w.audio?.() ?? []).some((a) => k.endsWith(a.path))) },
  { name: "source_missing", kind: "minefield", check: (w) => (w.audio?.() ?? []).some((a) => !a.source) },
];

export const task = defineTask<P13World>({
  id: "T-P13-07",
  cluster: "P13",
  clauses: ["B-P13-07"],
  priority: "must-have",
  tier: 1,
  setup: { seed: 1307, records: ["chat:c1 after T-P13-05's render"], files: [], jobs: [] },
  turns: [
    { kind: "prompt", by: "sam@solo-sam.example", text: "what did that audio say and where is it" },
  ],
  end_state: graders.filter((g) => g.kind === "end_state").map((g) => g.name),
  required_facts: graders.filter((g) => g.kind === "required_fact").map((g) => g.name),
  minefields: graders.filter((g) => g.kind === "minefield").map((g) => g.name),
  collateral: {},
  graders,
  reference: "Muse's gap (B-P13-07); fletch is stronger.",
});

export default task;
