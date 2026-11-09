// The world the P13 tasks grade (F70): what Sam's chat, Sam's attachments and the deploy's sources show after the turns.
// Pure types, constants and the speech fakes, importable by Node with no worker harness, so the tier-2 runner can load a
// task file (F73). The tier-1 world (`harness.ts`) is the authority world's real `ChatEngine` chat with the real speech
// namespace and the attachment world's real upload route and `PersonAttachments` over an in-memory R2.
//
// The fake `AI` binding answers the two speech models D-0026 names: `@cf/openai/whisper-large-v3-turbo` with a fixed
// transcript, and `@cf/deepgram/aura-2-en` with a short MP3 generated here from silent MPEG frames (never a recording of
// a person); each can fail or be cut short on cue. F70 wires it nowhere a production path reaches (speech is off on every
// deploy until F71), so a task's grader that counts its calls holds "no model call".
import type { ScenarioWorld } from "../../support/scenario.ts";

export const TRANSCRIBE_MODEL = "@cf/openai/whisper-large-v3-turbo";
export const SPEAK_MODEL = "@cf/deepgram/aura-2-en";
export const SPEECH_MODELS = [TRANSCRIBE_MODEL, SPEAK_MODEL];
/** The fixture sentence: the transcript the fake answers, naming the two fixture people. */
export const TRANSCRIPT = "p13 probe. Sam Solo and Pat Solo are planning a picnic on Saturday.";
export const PROBE_FILE = "p13-probe.mp3";

/** Words that start audio capture, in a tool's name: a segment of it, as `start_call` or `mic_open` would carry. */
export const CAPTURE_NAME = /(^|_)(mic|microphone|dictate|dictation|record|recording|listen|capture|call|phone|voice_call)(_|$)/;
/** A route path segment that would start capture or a call server-side. */
export const CAPTURE_ROUTE = /\/(voice|dictat[a-z]*|mic|microphone|listen|recording|audio-in|phone|call)(?=\/|$)/i;

// One MPEG-1 Layer III frame header: 128 kbit/s, 44.1 kHz, joint stereo, no padding; 417 bytes a frame, 1152 samples.
const FRAME_HEADER = [0xff, 0xfb, 0x90, 0x64];
export const FRAME_BYTES = 417;
export const FRAME_MS = (1152 / 44100) * 1000;

/** A silent MP3 of `frames` frames (about 26 ms each), generated in the test. */
export function silentMp3(frames: number): Uint8Array {
  const out = new Uint8Array(frames * FRAME_BYTES);
  for (let i = 0; i < frames; i++) out.set(FRAME_HEADER, i * FRAME_BYTES);
  return out;
}

/** The duration an MP3 of these fixed frames carries, by counting frame headers. */
export function framesOf(mp3: Uint8Array): number {
  let n = 0;
  for (let i = 0; i + 3 < mp3.length; i += FRAME_BYTES) if (mp3[i] === 0xff && mp3[i + 1] === 0xfb) n++;
  return n;
}

/** The probe voice note: about four seconds of silent frames, named and typed as a browser's recorder would send it. */
export const probeNote = () => silentMp3(150);

export type SpeechCue = "ok" | "fail" | "short";
export interface SpeechCall {
  model: string;
  inputs: Record<string, unknown>;
}

/** The fake `AI` binding for speech: a transcript or an MP3, an error or a cut-short MP3 on cue, every call recorded. */
export function fakeSpeechAI(cues: SpeechCue[] = []) {
  const calls: SpeechCall[] = [];
  const queue = [...cues];
  const run = async (model: string, inputs: Record<string, unknown>): Promise<unknown> => {
    calls.push({ model, inputs });
    const cue = queue.shift() ?? "ok";
    if (cue === "fail") throw new Error(`AiError: 5006: ${model} failed`);
    if (model === TRANSCRIBE_MODEL) return cue === "short" ? { text: TRANSCRIPT.slice(0, 12) } : { text: TRANSCRIPT, segments: [], transcription_info: { language: "en" } };
    if (model === SPEAK_MODEL) return cue === "short" ? silentMp3(2) : silentMp3(200);
    throw new Error(`FAKE_SPEECH_UNKNOWN_MODEL: ${model}`);
  };
  return { calls, binding: { run } };
}

export type ToolLine = { name: string; description: string };
export type Upload = { name: string; status: number; code?: string; words: string };
export type AttachmentRow = { id: string; name: string; mime: string; size: number; cls: string; sha256: string; status: string; code: string | null; transcript: string | null };
export type ResultLine = { tool: string; text: string; isError: boolean };

/** What F71 and F72 add to the world (the audio record, the voice record, the Ledger's speech rows, cards, shares, the Library). */
export type AudioItem = { id: string; kind: "audio" | "episode"; path: string; durationMs: number; voice: string; model: string; source: string; topics?: string[]; removed: boolean };
export type SpeechRow = { route: string; model: string; costMicros: number };
export type CardLine = { kind: string; lines: string[]; pressed: boolean };
export type ShareLine = { path: string; url: string; endsAt: number; answers: string };

export interface P13World extends ScenarioWorld {
  /** The chat's tool reference as the model was shown it (every namespace's tools, by name and one line). */
  tools(): ToolLine[];
  /** Every tool name a spec in `packages/agent/src` declares, whatever its namespace's deferral. */
  declaredTools(): string[];
  /** Every route path literal under `packages/agent/src/http` and the entry. */
  routes(): string[];
  /** The chat's system prompt, as the model was shown it in its first chat request. */
  prefix(): string;
  /** Sam's typed messages in the chat, in order. */
  typed(): string[];
  /** The chat's replies, in order. */
  replies(): string[];
  /** What each tool returned in the chat, in order. */
  results(): ResultLine[];
  /** Each upload the composer made, with the route's answer. */
  uploads: Upload[];
  /** Sam's attachment rows as stored. */
  rows(): AttachmentRow[];
  /** Every object key in the tenant buckets. */
  objects(): Promise<string[]>;
  /** The model requests that named a speech model (F70: none). */
  speechRequests(): string[];
  /** F71: every call the fake speech binding answered. */
  speechCalls?(): SpeechCall[];
  /** F71: the audio records (`audio_items`), removed ones included. */
  audio?(): AudioItem[];
  /** F71: the person's voice record, and the journal rows naming its changes with their writer. */
  voice?(): { speaker: string | null; changes: Array<{ speaker: string; writer: string }> };
  /** F71: the Ledger's `model_calls` rows on route `speech`, and the refusals' codes in order. */
  speechRows?(): SpeechRow[];
  refusals?(): string[];
  /** F71: the cards raised in the chat, and the share links made. */
  cards?(): CardLine[];
  shares?(): ShareLine[];
  /** F72: the Library's Audio section as drawn, and the chat's audio items. */
  library?(): Array<{ id: string; player: boolean }>;
  /** F72: whether any route answers a feed. */
  feedRoutes?(): string[];
}
