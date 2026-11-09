// T-P13-02 (B-P13-02): a voice note becomes a row of class audio carrying its transcript, the audio deleted once the transcript is written, the model reading a block marked as a transcript and the reply saying it read one, with one Ledger row on route speech. Run by F71: skipped by name here (`skipped.test.ts`) until its own [F71] tier-1 run lands;
// the graders read what that part adds to the world (`world.ts`, the optional members), and the part refines them before
// its first run (no run has graded them, so a change then is not an oracle correction).
import { defineTask, type Grader } from "../../support/task.ts";
import type { P13World } from "./world.ts";
import { TRANSCRIBE_MODEL, TRANSCRIPT } from "./world.ts";

const graders: Grader<P13World>[] = [
  { name: "one audio row with its sha256, size and type and the transcript in its transcript column", kind: "end_state", check: (w) => w.rows().length === 1 && w.rows()[0]?.cls === "audio" && w.rows()[0]?.transcript === TRANSCRIPT },
  { name: "no audio object under the person's user prefix once the transcript is written", kind: "end_state", check: async (w) => (await w.objects()).every((k) => !k.includes("/user/")) },
  { name: "one Ledger model_calls row on route speech", kind: "end_state", check: (w) => (w.speechRows?.() ?? []).filter((r) => r.route === "speech" && r.model === TRANSCRIBE_MODEL).length === 1 },
  { name: "the transcript is the row's, not the model's", kind: "required_fact", check: (w) => w.rows()[0]?.transcript === TRANSCRIPT && w.replies().some((r) => /\btranscript\b/i.test(r)) },
  { name: "listened_claim", kind: "minefield", check: (w) => w.replies().some((r) => /\b(listened|heard your tone|I heard)\b/i.test(r)) },
  { name: "audio_kept", kind: "minefield", check: async (w) => (await w.objects()).some((k) => k.includes("/user/")) },
  { name: "transcript_lost", kind: "minefield", check: (w) => w.rows().some((r) => r.cls === "audio" && r.transcript === null) },
];

export const task = defineTask<P13World>({
  id: "T-P13-02",
  cluster: "P13",
  clauses: ["B-P13-02"],
  priority: "must-have",
  tier: 1,
  setup: { seed: 1302, records: ["chat:c1", "the AI binding faked for whisper-large-v3-turbo"], files: ["p13-probe.mp3"], jobs: [] },
  turns: [
    { kind: "event", name: "voice-note", payload: {"name": "p13-probe.mp3", "type": "audio/mpeg"} },
    { kind: "prompt", by: "sam@solo-sam.example", text: "what did my voice note say?" },
  ],
  end_state: graders.filter((g) => g.kind === "end_state").map((g) => g.name),
  required_facts: graders.filter((g) => g.kind === "required_fact").map((g) => g.name),
  minefields: graders.filter((g) => g.kind === "minefield").map((g) => g.name),
  collateral: {},
  graders,
  reference: "runtime.message_attachments.transcription_text (B-P13-02); the audio's fate is D-0026's, not Muse's (delta 2).",
});

export default task;
