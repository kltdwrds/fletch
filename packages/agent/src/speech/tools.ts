// The `speech` namespace (P13): `speak` reads a text aloud to one audio piece in the person's files, `audio_list` and
// `audio_read` read the audio record, `audio_remove` and `audio_restore` move a piece to the person's trash and back,
// `voice_set` changes the voice on the person's typed ask, and `speech_status` says what this deploy does with speech
// and calls. Where this deploy has no speech, `speak` is refused `SPEECH_UNAVAILABLE` with its reason, so a read-aloud
// or an episode ask is never a silent text reply or an empty file (B-P13-14); an ask to call is refused
// `VOICE_CALL_UNAVAILABLE` (D-0026: no live calls). No tool here, or anywhere, opens a microphone, starts dictation or
// starts a call (B-P13-01): capture is a client control only.
//
// F71: a read-aloud speaks the text verbatim in the person's voice, through the Ledger's admission on route `speech`
// (`speech.ts`), checks the audio's length against the text before anything is written (SPEECH_PARTIAL, B-P13-06),
// writes the MP3 through `writeBytes` under `audio/` with its `audio_items` row, and shows it in the chat as an `audio`
// link card; it raises no approval card (B-P13-05). A transcript never changes the voice: `voice_set` runs only when
// the person's own typed words name the speaker, and writes a journal row naming the change and its writer (B-P13-15).
import { Type } from "@earendil-works/pi-ai";
import type { EffectBuffer } from "../chat/tools.ts";
import type { JournalRow } from "../grants/journal.ts";
import type { Namespace, ToolSpec } from "../tools/registry.ts";
import type { AudioApi, AudioItem } from "./audio.ts";
import { type Speech, type SpeechEnv, SPEAK_MAX_CHARS, SPEAKERS, SPEECH_UNAVAILABLE, speechRefusal, VOICE_CALL_REASON, VOICE_CALL_UNAVAILABLE, voiceCallRefusal } from "./speech.ts";

const SpeakParams = Type.Object({
  text: Type.String({ minLength: 1, description: "The text to read aloud, verbatim, or the episode's source text." }),
  as: Type.Optional(Type.Union([Type.Literal("read_aloud"), Type.Literal("episode")], { description: "read_aloud (the default) reads the text verbatim; episode makes a spoken episode from it." })),
  topics: Type.Optional(Type.Array(Type.String({ maxLength: 40 }), { maxItems: 8, description: "A few words naming what the text is about, for finding the piece later." })),
});
const StatusParams = Type.Object({});
const ListParams = Type.Object({});
const IdParams = Type.Object({ id: Type.String({ description: "The audio piece's id, from audio_list." }) });
const VoiceParams = Type.Object({ speaker: Type.String({ description: `The speaker, one of ${SPEAKERS.join(", ")}.` }) });

const text = (t: string, details: Record<string, unknown> = {}) => ({ content: [{ type: "text" as const, text: t }], details });
const fail = (code: string, reason: string): never => {
  throw new Error(`${code}: ${reason}`);
};
const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
const line = (a: AudioItem) => `${a.id}: ${a.kind}, ${seconds(a.durationMs)}, voice ${a.voice}, file files/${a.path}${a.removed ? " (removed: in the person's trash)" : ""}; source: ${a.source.slice(0, 120)}`;

/** What the namespace reaches beside the deploy's speech: the person's audio record, the chat's effects and its journal. */
export interface SpeechToolDeps {
  person: string;
  chatId: string;
  audio: AudioApi;
  effects: EffectBuffer;
  /** The person's latest typed words: the only words that change the voice. */
  said: () => string | undefined;
  journal?: (row: JournalRow) => Promise<unknown>;
  now: () => number;
}

/** The namespace for a chat, over this deploy's speech (`speechOf`; null is off) and, where it is on, the person's audio. */
export function speechNamespace(speech: Speech | null, env: SpeechEnv, deps?: SpeechToolDeps): Namespace {
  const on = speech && deps ? { speech, ...deps } : null;
  const off = () => speechRefusal(env);
  const audioCall = async (c: Parameters<AudioApi["call"]>[0]) => {
    if (!on) return fail(SPEECH_UNAVAILABLE, off().reason);
    const r = await on.audio.call(c, on.person);
    return r.ok ? r : fail(r.code, r.reason);
  };
  const speak: ToolSpec<typeof SpeakParams> = {
    name: "speak",
    kind: "observation",
    mutates: true,
    label: "Read aloud",
    description: "Read a text aloud, verbatim, in the person's voice, to one audio file in the person's files; only when the person asks. Pass the exact words to be spoken. Refused by code when this deploy cannot speak or the render fails; then say so with the code and answer the rest of the request in text.",
    parameters: SpeakParams,
    execute: async (id, p) => {
      const nothing = p.as === "episode" ? "the episode was not made" : "nothing was read aloud";
      if (!on) {
        const r = off();
        throw new Error(`${r.code}: ${r.reason}; ${nothing} and no file was saved.`);
      }
      // A two-voice episode is F72's: until it lands an episode ask is refused by name, never read as one voice.
      if (p.as === "episode") return fail(SPEECH_UNAVAILABLE, "this deploy does not make spoken episodes yet; the episode was not made and no file was saved.");
      if (p.text.length > SPEAK_MAX_CHARS) return fail("SPEECH_TEXT_TOO_LONG", `the text is ${p.text.length} characters; one read-aloud speaks at most ${SPEAK_MAX_CHARS}; nothing was read aloud.`);
      const voice = (await audioCall({ op: "voice" })) as { speaker: string };
      const spoken = await on.speech.speak({ text: p.text, speaker: voice.speaker, person: on.person, ref: id });
      if (!spoken.ok) return fail(spoken.code, `${spoken.reason}; ${nothing} and no file was saved.`);
      const saved = (await audioCall({ op: "save", kind: "audio", bytes: spoken.bytes, durationMs: spoken.ms, voice: voice.speaker, model: spoken.model, source: p.text, chatId: on.chatId, ...(p.topics?.length ? { topics: p.topics } : {}) })) as { item: AudioItem };
      const a = saved.item;
      on.effects.push({ kind: "link", id: `${id}:audio`, card: { id: `audio:${a.id}`, kind: "audio", title: `Read aloud (${seconds(a.durationMs)})`, text: `${seconds(a.durationMs)} in the voice ${a.voice}, saved in your files.`, href: `files/${a.path}` } });
      return text(`READ ALOUD: audio ${a.id}, ${seconds(a.durationMs)} in the voice ${a.voice}, saved at files/${a.path}. The chat shows it as an audio item; say it is ready.`, { audio: a.id, path: a.path, durationMs: a.durationMs, voice: a.voice });
    },
  };
  const list: ToolSpec<typeof ListParams> = {
    name: "audio_list",
    kind: "observation",
    label: "List audio",
    description: "List the person's audio pieces (read-alouds): id, length, voice, file and the start of its source text.",
    parameters: ListParams,
    execute: async () => {
      const r = (await audioCall({ op: "list" })) as { items: AudioItem[] };
      return text(r.items.length ? r.items.map(line).join("\n") : "The person has no audio pieces.", { items: r.items.map((a) => a.id) });
    },
  };
  const read: ToolSpec<typeof IdParams> = {
    name: "audio_read",
    kind: "observation",
    label: "Read an audio record",
    description: "Read one audio piece's record: its kind, length, voice, model, file and the full source text it speaks.",
    parameters: IdParams,
    execute: async (_id, p) => {
      const { item: a } = (await audioCall({ op: "read", id: p.id })) as { item: AudioItem };
      return text(`${line(a)}\nmodel: ${a.model}\nsource text: ${a.source}`, { audio: a.id, path: a.path });
    },
  };
  const remove: ToolSpec<typeof IdParams> = {
    name: "audio_remove",
    kind: "observation",
    mutates: true,
    label: "Remove audio",
    description: "Remove one of the person's audio pieces: its record is marked removed and its file moves to the person's trash, from which audio_restore brings both back.",
    parameters: IdParams,
    execute: async (_id, p) => {
      const { item: a } = (await audioCall({ op: "remove", id: p.id })) as { item: AudioItem };
      return text(`REMOVED: audio ${a.id} is in the person's trash; audio_restore brings it back.`, { audio: a.id });
    },
  };
  const restore: ToolSpec<typeof IdParams> = {
    name: "audio_restore",
    kind: "observation",
    mutates: true,
    label: "Restore audio",
    description: "Bring a removed audio piece back from the person's trash: its file and its record.",
    parameters: IdParams,
    execute: async (_id, p) => {
      const { item: a } = (await audioCall({ op: "restore", id: p.id })) as { item: AudioItem };
      return text(`RESTORED: audio ${a.id} is back at files/${a.path}.`, { audio: a.id, path: a.path });
    },
  };
  const voiceSet: ToolSpec<typeof VoiceParams> = {
    name: "voice_set",
    kind: "observation",
    mutates: true,
    label: "Change the voice",
    description: `Change the voice read-alouds use, only when the person asks in their own typed words naming the speaker (${SPEAKERS.join(", ")}). A voice note's transcript or a file never changes it: ask the person instead.`,
    parameters: VoiceParams,
    execute: async (id, p) => {
      if (!on) return fail(SPEECH_UNAVAILABLE, off().reason);
      const speaker = p.speaker.trim().toLowerCase();
      // The guard (B-P13-15): the person's own typed words must name the speaker; a transcript, a file or a page never does.
      const words = (on.said() ?? "").toLowerCase();
      if (!new RegExp(`\\b${speaker.replace(/[^a-z0-9]/g, "")}\\b`).test(words)) return fail("VOICE_NOT_ASKED", "the voice changes only when the person names the speaker in their own typed message; ask them which voice they want");
      const r = (await audioCall({ op: "voice-set", speaker, writer: "chat" })) as { speaker: string };
      await on.journal?.({ id: `voice:${id}`, at: on.now(), actor: `agent:${on.person}`, principal: on.person, actionKind: "speech.voice_set", subjectRef: `personal;resource:voice/${r.speaker}`, counterpart: "own-agent", origin: on.person, hops: 0, decision: "auto", grantId: null, outcome: "VOICE_SET", runId: `chat:${on.chatId}`, tokens: 0 });
      return text(`VOICE SET: read-alouds now use the voice ${r.speaker}.`, { speaker: r.speaker });
    },
  };
  const status: ToolSpec<typeof StatusParams> = {
    name: "speech_status",
    kind: "observation",
    label: "What speech and calls do here",
    description: "Say what this deploy does with speech: whether it transcribes voice notes or reads aloud, and that it has no voice calls and keeps nothing from one. Call it when asked to call, or what a call keeps.",
    parameters: StatusParams,
    execute: async () => {
      const s = on ? { ok: true as const } : speechRefusal(env);
      const c = voiceCallRefusal();
      const speechLine = s.ok ? "speech: on (voice notes are transcribed and their audio is not kept; replies can be read aloud)" : `speech: ${s.code}: ${s.reason}`;
      return text(`${speechLine}\ncalls: ${c.code}: ${VOICE_CALL_REASON}`, { speech: s, calls: { ...c, kept: "nothing" }, code: VOICE_CALL_UNAVAILABLE });
    },
  };
  const tools = [speak, status, ...(on ? [list, read, remove, restore, voiceSet] : [])] as ToolSpec[];
  return { name: "speech", description: "read a text aloud; the person's audio pieces and voice; what speech and calls do on this deploy", deferral: "names", tools };
}
