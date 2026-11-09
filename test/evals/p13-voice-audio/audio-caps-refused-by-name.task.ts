// T-P13-03 (B-P13-02, B-P13-03): an mp3 over AUDIO_MAX is refused ATTACHMENT_TOO_LARGE_AUDIO and an audio type outside ATTACHMENT_TYPES ATTACHMENT_TYPE_UNSUPPORTED, both before storage and in words; an mp3 within the cap is transcribed onto its row. Run by F71: skipped by name here (`skipped.test.ts`) until its own [F71] tier-1 run lands;
// the graders read what that part adds to the world (`world.ts`, the optional members), and the part refines them before
// its first run (no run has graded them, so a change then is not an oracle correction).
import { defineTask, type Grader } from "../../support/task.ts";
import type { P13World } from "./world.ts";
import { TRANSCRIPT } from "./world.ts";

const graders: Grader<P13World>[] = [
  { name: "the first refused ATTACHMENT_TOO_LARGE_AUDIO with the cap in the words", kind: "end_state", check: (w) => w.uploads[0]?.code === "ATTACHMENT_TOO_LARGE_AUDIO" && /8 MB/.test(w.uploads[0]?.words ?? "") },
  { name: "the second refused ATTACHMENT_TYPE_UNSUPPORTED with the type in the words", kind: "end_state", check: (w) => w.uploads[1]?.code === "ATTACHMENT_TYPE_UNSUPPORTED" && /p13-probe\.flac/.test(w.uploads[1]?.words ?? "") },
  { name: "the third transcribed with its transcript on its row", kind: "end_state", check: (w) => w.rows().length === 1 && w.rows()[0]?.transcript === TRANSCRIPT },
  { name: "stored_unread", kind: "minefield", check: (w) => w.rows().some((r) => r.cls === "audio" && r.transcript === null && r.code === null) },
  { name: "silent_drop", kind: "minefield", check: (w) => w.uploads.some((u) => u.status >= 400 && !u.code) },
];

export const task = defineTask<P13World>({
  id: "T-P13-03",
  cluster: "P13",
  clauses: ["B-P13-02", "B-P13-03"],
  priority: "must-have",
  tier: 1,
  setup: { seed: 1303, records: ["chat:c1", "the AI binding faked for whisper-large-v3-turbo"], files: ["p13-big.mp3", "p13-probe.flac", "p13-probe.mp3"], jobs: [] },
  turns: [
    { kind: "event", name: "voice-note", payload: {"name": "p13-big.mp3", "frames": "20200"} },
    { kind: "event", name: "voice-note", payload: {"name": "p13-probe.flac", "type": "audio/flac"} },
    { kind: "event", name: "voice-note", payload: {"name": "p13-probe.mp3"} },
  ],
  end_state: graders.filter((g) => g.kind === "end_state").map((g) => g.name),
  required_facts: graders.filter((g) => g.kind === "required_fact").map((g) => g.name),
  minefields: graders.filter((g) => g.kind === "minefield").map((g) => g.name),
  collateral: {},
  graders,
  reference: "Muse's two caps (B-P13-03); fletch's one cap and checkAttachment's refusal shape (delta 1).",
});

export default task;
