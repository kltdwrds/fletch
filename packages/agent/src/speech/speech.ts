// Speech on this deploy (P13, D-0026): whether it can transcribe a voice note or speak a reply, and the refusals by
// name when it cannot. Speech runs on the `AI` binding (whisper-large-v3-turbo in, aura-2-en out) under a Ledger price
// and a monthly cap; until F71 builds that path no deploy has it, so `speechOf` is null everywhere and every speech ask
// is refused `SPEECH_UNAVAILABLE` with the reason that applies, never a silent text reply or an empty file (D-0001,
// B-P13-14). The codes are the agent's own: D-0026 keeps `@qyvr/host`'s `HostFeature` as it is.
//
// A voice call does not exist on any deploy (D-0026: no live calls): an ask to call is refused
// `VOICE_CALL_UNAVAILABLE`, and nothing from a call is kept because none happens (B-P13-12).

export const SPEECH_UNAVAILABLE = "SPEECH_UNAVAILABLE";
export const VOICE_CALL_UNAVAILABLE = "VOICE_CALL_UNAVAILABLE";

/** The transcriber and the speaker F71 builds on the `AI` binding; no deploy has one before it. */
export interface Speech {
  transcribe(input: { bytes: Uint8Array; mime: string }): Promise<{ ok: true; text: string } | { ok: false; code: string; reason: string }>;
}

/** The env a deploy's speech is read from: the `AI` binding and the `SPEECH` var (`off` switches speech off). */
export type SpeechEnv = { AI?: unknown; SPEECH?: string };

/** Why this deploy has no speech, in the person's words; the first that applies. */
export function speechOffReason(env: SpeechEnv): string {
  if (!env.AI) return "this deploy has no AI binding, so it cannot transcribe or speak";
  if (String(env.SPEECH ?? "").toLowerCase() === "off") return "speech is switched off on this deploy (its SPEECH setting is off), so it cannot transcribe or speak";
  return "speech is not turned on for this deploy yet, so it cannot transcribe or speak";
}

/**
 * This deploy's speech: null when `AI` is unbound, when `SPEECH` is `off`, and (until F71 builds the transcriber and the
 * speaker behind a Ledger price and the monthly cap) on every deploy.
 */
export function speechOf(_env: SpeechEnv): Speech | null {
  return null;
}

/** The refusal of a read-aloud or an episode, or a voice note's untranscribed row: the code and its reason. */
export const speechRefusal = (env: SpeechEnv) => ({ ok: false as const, code: SPEECH_UNAVAILABLE, reason: speechOffReason(env) });

/** The reason an ask to call is refused, the same on every deploy. */
export const VOICE_CALL_REASON = "this deploy has no voice calls: none can be started, taken or joined, and nothing from one is kept, because none happens";

export const voiceCallRefusal = () => ({ ok: false as const, code: VOICE_CALL_UNAVAILABLE, reason: VOICE_CALL_REASON });
