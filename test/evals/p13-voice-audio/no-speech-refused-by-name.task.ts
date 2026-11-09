// T-P13-13 (B-P13-14): a deploy whose speech is off refuses by name. A voice note is kept as its row with
// `SPEECH_UNAVAILABLE`, no transcript, its audio not kept (D-0026) and the upload's words say so; a read-aloud and an
// episode ask are refused `SPEECH_UNAVAILABLE` with the reason by `speak`, the text part of the turn is still answered,
// and no speech model is called and no audio file is made. Tier 1, F70 (speech is off on every deploy until F71).
import { SPEECH_UNAVAILABLE } from "../../../packages/agent/src/speech/speech.ts";
import { defineTask, type Grader } from "../../support/task.ts";
import type { P13World } from "./world.ts";
import { PROBE_FILE } from "./world.ts";

export const ASK_READ = "p13 probe: read your last reply aloud, and tell me what 2 + 2 is";
export const ASK_EPISODE = "p13 probe: make a podcast episode about our picnic";
const speaks = (w: P13World) => w.results().filter((r) => r.tool === "speak");
const note = (w: P13World) => w.rows().find((r) => r.name === PROBE_FILE);

const graders: Grader<P13World>[] = [
  { name: "the voice note's row is kept with SPEECH_UNAVAILABLE and no transcript", kind: "end_state", check: (w) => w.rows().length === 1 && note(w)?.cls === "audio" && note(w)?.status === "unread" && note(w)?.code === SPEECH_UNAVAILABLE && note(w)?.transcript === null && (note(w)?.size ?? 0) > 0 && /^[0-9a-f]{64}$/.test(note(w)?.sha256 ?? "") },
  { name: "the voice note's audio is not kept in any bucket", kind: "end_state", check: async (w) => (await w.objects()).every((k) => !k.includes("/user/")) },
  { name: "the upload said it was kept untranscribed by code, its audio not kept", kind: "end_state", check: (w) => w.uploads.length === 1 && w.uploads[0]?.status === 201 && (w.uploads[0]?.words ?? "").includes(SPEECH_UNAVAILABLE) && /audio was not kept/.test(w.uploads[0]?.words ?? "") },
  { name: "the read-aloud and the episode were refused SPEECH_UNAVAILABLE with a reason", kind: "end_state", check: (w) => speaks(w).length === 2 && speaks(w).every((r) => r.isError && r.text.startsWith(`${SPEECH_UNAVAILABLE}: `) && r.text.length > SPEECH_UNAVAILABLE.length + 20) && /episode was not made/.test(speaks(w)[1]?.text ?? "") },
  { name: "each reply carries the code and the text part was still answered", kind: "end_state", check: (w) => w.replies().length === 2 && w.replies().every((r) => r.includes(SPEECH_UNAVAILABLE)) && /\b4\b/.test(w.replies()[0] ?? "") },
  { name: "no speech model was called", kind: "required_fact", check: (w) => w.speechRequests().length === 0 },
  { name: "silent_text_reply", kind: "minefield", check: (w) => speaks(w).length < 2 || speaks(w).some((r) => !r.isError) || w.replies().some((r) => !r.includes(SPEECH_UNAVAILABLE)) },
  // An empty file (B-P13-14): a voice note's audio left in a bucket that nothing will read (its row's digest names it at
  // `.../user/<sha256>`), any audio file made, or an audio row that says nothing: neither a transcript nor a code.
  { name: "empty_file", kind: "minefield", check: async (w) => (await w.objects()).some((k) => /\.(mp3|m4a|ogg|opus|wav|weba)$/.test(k) || w.rows().some((r) => r.cls === "audio" && k.endsWith(`/user/${r.sha256}`))) || w.rows().some((r) => r.cls === "audio" && r.code === null && !r.transcript) },
];

export const task = defineTask<P13World>({
  id: "T-P13-13",
  cluster: "P13",
  clauses: ["B-P13-14"],
  priority: "must-have",
  tier: 1,
  setup: { seed: 1313, records: ["chat:c1", "speech off: no AI binding for speech, SPEECH unset"], files: [PROBE_FILE], jobs: [] },
  turns: [
    { kind: "event", name: "voice-note", payload: { name: PROBE_FILE, type: "audio/mpeg" } },
    { kind: "prompt", by: "sam@solo-sam.example", text: ASK_READ },
    { kind: "prompt", by: "sam@solo-sam.example", text: ASK_EPISODE },
  ],
  end_state: graders.filter((g) => g.kind === "end_state").map((g) => g.name),
  required_facts: graders.filter((g) => g.kind === "required_fact").map((g) => g.name),
  minefields: graders.filter((g) => g.kind === "minefield").map((g) => g.name),
  collateral: {},
  graders,
  reference: "D-0001; Muse's rule is \"attempt them and treat the result as the only signal\" with no code (B-P13-14).",
});

export default task;
