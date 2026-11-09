// The `speech` namespace (P13, F70): `speak` reads a text aloud or makes an episode, and `speech_status` says what this
// deploy does with speech and calls. Until F71 builds speech on the `AI` binding, `speak` is refused
// `SPEECH_UNAVAILABLE` with its reason, so a read-aloud or an episode ask is never a silent text reply or an empty file
// (B-P13-14); an ask to call is refused `VOICE_CALL_UNAVAILABLE` (D-0026: no live calls). No tool here, or anywhere,
// opens a microphone, starts dictation or starts a call (B-P13-01): capture is a client control only.
import { Type } from "@earendil-works/pi-ai";
import type { Namespace, ToolSpec } from "../tools/registry.ts";
import { type Speech, type SpeechEnv, speechRefusal, VOICE_CALL_REASON, VOICE_CALL_UNAVAILABLE, voiceCallRefusal } from "./speech.ts";

const SpeakParams = Type.Object({
  text: Type.String({ minLength: 1, description: "The text to read aloud, verbatim, or the episode's source text." }),
  as: Type.Optional(Type.Union([Type.Literal("read_aloud"), Type.Literal("episode")], { description: "read_aloud (the default) reads the text verbatim; episode makes a spoken episode from it." })),
});
const StatusParams = Type.Object({});

const text = (t: string, details: Record<string, unknown> = {}) => ({ content: [{ type: "text" as const, text: t }], details });

/** The namespace for a chat, over this deploy's speech (`speechOf(env)`; null is off, as on every deploy before F71). */
export function speechNamespace(speech: Speech | null, env: SpeechEnv): Namespace {
  const speak: ToolSpec<typeof SpeakParams> = {
    name: "speak",
    kind: "observation",
    label: "Read aloud",
    description: "Read a text aloud to one audio file in the person's files, or make a spoken episode from it; only when the person asks. Refused by code when this deploy cannot speak; then say so with the code and answer the rest of the request in text.",
    parameters: SpeakParams,
    // No deploy speaks before F71 (`Speech` has no speaker yet): every call is refused by name with the reason that applies.
    execute: async (_id, p) => {
      const r = speechRefusal(env);
      throw new Error(`${r.code}: ${r.reason}; ${p.as === "episode" ? "the episode was not made" : "nothing was read aloud"} and no file was saved.`);
    },
  };
  const status: ToolSpec<typeof StatusParams> = {
    name: "speech_status",
    kind: "observation",
    label: "What speech and calls do here",
    description: "Say what this deploy does with speech: whether it transcribes voice notes or reads aloud, and that it has no voice calls and keeps nothing from one. Call it when asked to call, or what a call keeps.",
    parameters: StatusParams,
    execute: async () => {
      const s = speech ? { ok: true as const } : speechRefusal(env);
      const c = voiceCallRefusal();
      const speechLine = s.ok ? "speech: on" : `speech: ${s.code}: ${s.reason}`;
      return text(`${speechLine}\ncalls: ${c.code}: ${VOICE_CALL_REASON}`, { speech: s, calls: { ...c, kept: "nothing" }, code: VOICE_CALL_UNAVAILABLE });
    },
  };
  return { name: "speech", description: "read a text aloud or make a spoken episode; what speech and calls do on this deploy", deferral: "names", tools: [speak, status] as ToolSpec[] };
}
