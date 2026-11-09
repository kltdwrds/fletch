// Speech on this deploy (P13, D-0026): whether it can transcribe a voice note or speak a reply, and the refusals by
// name when it cannot. Speech runs on the `AI` binding (whisper-large-v3-turbo in, aura-2-en out), each call admitted by
// the Ledger on route `speech` under the tenant's monthly speech cap and its daily caps, and written there as a
// `model_calls` row priced at `SPEECH_PRICES` (F71): no speech call exists outside that admission (B-P13-14). A deploy
// with no `AI` binding, or with its `SPEECH` var `off`, has none, and every speech ask is refused `SPEECH_UNAVAILABLE`
// with the reason that applies, never a silent text reply or an empty file (D-0001). The codes are the agent's own:
// D-0026 keeps `@qyvr/host`'s `HostFeature` as it is.
//
// A voice call does not exist on any deploy (D-0026: no live calls): an ask to call is refused
// `VOICE_CALL_UNAVAILABLE`, and nothing from a call is kept because none happens (B-P13-12).
import type { LedgerSink, ModelCallRow } from "../ledger/types.ts";
import { SPEAK_MODEL, TRANSCRIBE_MODEL } from "../model/routes.ts";
import { mp3Duration } from "./mp3.ts";

export const SPEECH_UNAVAILABLE = "SPEECH_UNAVAILABLE";
export const VOICE_CALL_UNAVAILABLE = "VOICE_CALL_UNAVAILABLE";
export const SPEECH_FAILED = "SPEECH_FAILED";
export const SPEECH_PARTIAL = "SPEECH_PARTIAL";

type Fail = { ok: false; code: string; reason: string };
export type Heard = { ok: true; text: string } | Fail;
export type Spoken = { ok: true; bytes: Uint8Array; ms: number; model: string } | Fail;

/** The transcriber and the speaker on the `AI` binding, each call admitted and written by the Ledger (F71). */
export interface Speech {
  transcribe(input: { bytes: Uint8Array; mime: string; person?: string; ref?: string }): Promise<Heard>;
  speak(input: { text: string; speaker: string; person: string; ref: string }): Promise<Spoken>;
}

/** The env a deploy's speech is read from: the `AI` binding and the `SPEECH` var (`off` switches speech off). */
export type SpeechEnv = { AI?: unknown; SPEECH?: string };
/** What admits and records each speech call: the tenant's Ledger, the tenant and the clock. */
export interface SpeechWire {
  ledger: LedgerSink;
  tenant: string;
  now(): number;
}

/** Why this deploy has no speech, in the person's words; the first that applies. */
export function speechOffReason(env: SpeechEnv): string {
  if (!env.AI) return "this deploy has no AI binding, so it cannot transcribe or speak";
  if (String(env.SPEECH ?? "").toLowerCase() === "off") return "speech is switched off on this deploy (its SPEECH setting is off), so it cannot transcribe or speak";
  return "speech is not offered on this turn: it runs only in the owner's own chat, with a Ledger that counts it";
}

/** The speakers aura-2-en offers that a person may pick (a subset of its catalog); `luna` until they pick one. */
export const SPEAKERS = ["luna", "asteria", "athena", "hera", "orion", "arcas", "perseus", "zeus", "apollo", "helios"] as const;
export const DEFAULT_SPEAKER = "luna";
/** The longest text one read-aloud speaks. */
export const SPEAK_MAX_CHARS = 2_000;

/**
 * This deploy's speech: null when `AI` is unbound, when `SPEECH` is `off`, or when no Ledger is wired to admit and
 * record its calls; otherwise the transcriber and speaker over the binding.
 */
export function speechOf(env: SpeechEnv, wire?: SpeechWire): Speech | null {
  if (!env.AI || String(env.SPEECH ?? "").toLowerCase() === "off" || !wire) return null;
  return speechService(env.AI as AiRun, wire);
}

type AiRun = { run(model: string, inputs: Record<string, unknown>): Promise<unknown> };

/** The bounds a spoken text's audio falls in: no faster than 25 characters a second, no slower than 4 and three seconds. */
export function spokenBounds(text: string): { minMs: number; maxMs: number } {
  return { minMs: Math.floor((text.length / 25) * 1000), maxMs: Math.ceil((text.length / 4) * 1000) + 3000 };
}

/** An audio file's length for its price: an MP3's frames, else its size at 128 kbit/s. */
const audioMs = (bytes: Uint8Array): number => mp3Duration(bytes).ms || Math.ceil((bytes.byteLength * 8) / 128);

async function bytesOf(out: unknown): Promise<Uint8Array | null> {
  if (out instanceof Uint8Array) return out;
  if (out instanceof ArrayBuffer) return new Uint8Array(out);
  if (out instanceof Response) return new Uint8Array(await out.arrayBuffer());
  if (out instanceof ReadableStream) return new Uint8Array(await new Response(out).arrayBuffer());
  const audio = (out as { audio?: unknown } | null)?.audio;
  if (typeof audio === "string") return Uint8Array.from(atob(audio), (c) => c.charCodeAt(0));
  return null;
}

function base64(bytes: Uint8Array): string {
  let data = "";
  for (let i = 0; i < bytes.length; i += 0x8000) data += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(data);
}

/** The service: each call admitted on route `speech` before `AI.run`, and written to the Ledger with its units. */
export function speechService(ai: AiRun, wire: SpeechWire): Speech {
  const call = async (model: string, person: string, runId: string, units: { ms?: number; chars?: number }, inputs: Record<string, unknown>): Promise<{ ok: true; out: unknown } | Fail> => {
    const row = (status: ModelCallRow["status"], code: string | null, startedAt: number | null): ModelCallRow => ({
      tenant: wire.tenant, person, runId, route: "speech", model, attempt: 1, status, code, httpStatus: null,
      inputTokens: 0, outputTokens: 0, reasoningTokens: 0, cachedTokens: 0, units, at: wire.now(),
      startedAt, firstTokenAt: null, finishedAt: startedAt === null ? null : wire.now(),
    });
    const record = (r: ModelCallRow) => wire.ledger.record(r).then(() => true, () => false);
    if (!wire.ledger.admit) return { ok: false, code: SPEECH_UNAVAILABLE, reason: "no Ledger admits speech on this deploy" };
    const admitted = await wire.ledger.admit({ person, runId, model, route: "speech" }).catch((e: unknown) => ({ ok: false as const, code: "BUDGET_UNAVAILABLE" as const, reason: String(e) }));
    if (!admitted.ok) {
      await record(row("refused", admitted.code, null));
      return { ok: false, code: admitted.code, reason: admitted.reason };
    }
    const started = wire.now();
    let out: unknown;
    try {
      out = await ai.run(model, inputs);
    } catch (e) {
      await record(row("failed", SPEECH_FAILED, started));
      return { ok: false, code: SPEECH_FAILED, reason: `the speech model failed: ${String((e as Error)?.message ?? e).slice(0, 160)}` };
    }
    if (!(await record(row("ok", null, started)))) return { ok: false, code: "LEDGER_UNAVAILABLE", reason: "the speech call's row was not written, so its result is not used" };
    return { ok: true, out };
  };
  return {
    async transcribe(input) {
      const r = await call(TRANSCRIBE_MODEL, input.person ?? "", `speech:transcribe:${input.ref ?? "note"}`, { ms: audioMs(input.bytes) }, { audio: base64(input.bytes) });
      if (!r.ok) return r;
      const text = String((r.out as { text?: unknown } | null)?.text ?? "").trim();
      return text ? { ok: true, text } : { ok: false, code: SPEECH_FAILED, reason: "the transcript came back empty" };
    },
    async speak(input) {
      const r = await call(SPEAK_MODEL, input.person, `speech:speak:${input.ref}`, { chars: input.text.length }, { text: input.text, speaker: input.speaker, encoding: "mp3" });
      if (!r.ok) return r;
      const bytes = await bytesOf(r.out);
      if (!bytes?.byteLength) return { ok: false, code: SPEECH_FAILED, reason: "the speech model returned no audio" };
      const { ms } = mp3Duration(bytes);
      const b = spokenBounds(input.text);
      if (ms < b.minMs) return { ok: false, code: SPEECH_PARTIAL, reason: `the audio is ${ms} ms, shorter than the ${b.minMs} ms the text needs, so it was cut short` };
      if (ms > b.maxMs) return { ok: false, code: SPEECH_FAILED, reason: `the audio is ${ms} ms, longer than the ${b.maxMs} ms the text could take` };
      return { ok: true, bytes, ms, model: SPEAK_MODEL };
    },
  };
}

/** The refusal of a read-aloud or an episode, or a voice note's untranscribed row: the code and its reason. */
export const speechRefusal = (env: SpeechEnv) => ({ ok: false as const, code: SPEECH_UNAVAILABLE, reason: speechOffReason(env) });

/** The reason an ask to call is refused, the same on every deploy. */
export const VOICE_CALL_REASON = "this deploy has no voice calls: none can be started, taken or joined, and nothing from one is kept, because none happens";

export const voiceCallRefusal = () => ({ ok: false as const, code: VOICE_CALL_UNAVAILABLE, reason: VOICE_CALL_REASON });

/** A podcast feed exists on no deploy (D-0026, P13 delta 8): an episode stays in the person's files and Library. */
export const PODCAST_FEED_UNAVAILABLE = "PODCAST_FEED_UNAVAILABLE";
export const PODCAST_FEED_REASON = "this deploy has no podcast feed: an episode stays in your files and your Library and is never published to a feed or a public address";
/** The most turns and characters one two-voice episode renders (each turn is one admitted speech call). */
export const EPISODE_MAX_TURNS = 24;
export const EPISODE_MAX_CHARS = 6_000;
