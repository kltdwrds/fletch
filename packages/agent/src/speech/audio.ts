// A person's audio pieces and their voice (P13, F71), in their `Person` object's SQLite beside their files. A piece read
// aloud is an `audio_items` row naming its kind, its file under the person's files (`audio/<id>.mp3`, written through
// `PersonFiles.writeBytes`), its duration, its voice, its model, its source text and its topics (B-P13-07): never a loose
// file. Removal marks the row and moves the object under the person's `trash/` prefix in one action, and restore brings
// both back (B-P13-13); nothing about the file is held outside the deploy. The voice is one `speech_settings` row the
// person's explicit ask writes, with its writer (B-P13-10, B-P13-15).
import type { PersonFiles } from "../files/store.ts";
import { homeKey } from "../memory/home.ts";
import { DEFAULT_SPEAKER, SPEAKERS } from "./speech.ts";

export const SCHEMA = `CREATE TABLE IF NOT EXISTS audio_items (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, path TEXT NOT NULL, duration_ms INTEGER NOT NULL, voice TEXT NOT NULL, model TEXT NOT NULL,
  source TEXT NOT NULL, topics TEXT, chat_id TEXT, created_at INTEGER NOT NULL, removed_at INTEGER);
CREATE TABLE IF NOT EXISTS speech_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, writer TEXT NOT NULL, updated_at INTEGER NOT NULL);`;

export type AudioKind = "audio" | "episode";
/** One audio piece as the agent and the Library read it; never a bucket key. */
export type AudioItem = { id: string; kind: AudioKind; path: string; durationMs: number; voice: string; model: string; source: string; topics: string[]; chatId: string | null; at: number; removed: boolean };
type Fail = { ok: false; code: string; reason: string };

export type AudioCall =
  | { op: "save"; kind: AudioKind; bytes: Uint8Array; durationMs: number; voice: string; model: string; source: string; topics?: string[]; chatId?: string }
  | { op: "list"; removed?: boolean }
  | { op: "read"; id: string }
  | { op: "remove"; id: string }
  | { op: "restore"; id: string }
  | { op: "voice" }
  | { op: "voice-set"; speaker: string; writer: string };

export type AudioResult =
  | { ok: true; item: AudioItem }
  | { ok: true; items: AudioItem[] }
  | { ok: true; speaker: string; set: boolean; writer?: string }
  | Fail;

/** What the chat reaches on the owner's `Person` object, over RPC in production. */
export interface AudioApi {
  call(c: AudioCall, requester: string): Promise<AudioResult>;
}

type Row = { id: string; kind: AudioKind; path: string; duration_ms: number; voice: string; model: string; source: string; topics: string | null; chat_id: string | null; created_at: number; removed_at: number | null };
const ID = /^[0-9a-f-]{36}$/;
const item = (r: Row): AudioItem => ({ id: r.id, kind: r.kind, path: r.path, durationMs: r.duration_ms, voice: r.voice, model: r.model, source: r.source, topics: r.topics ? (JSON.parse(r.topics) as string[]) : [], chatId: r.chat_id, at: r.created_at, removed: r.removed_at !== null });

/** The bucket calls removal and restore need; R2 answers them. */
export interface AudioBucket {
  put(key: string, value: Uint8Array, opts?: { httpMetadata?: { contentType?: string } }): Promise<unknown>;
  get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null>;
  delete(key: string): Promise<unknown>;
}

export class PersonAudio implements AudioApi {
  private readonly storage: Pick<DurableObjectStorage, "sql">;
  private readonly files: Pick<PersonFiles, "writeBytes" | "remove" | "key">;
  private readonly bucket: AudioBucket;
  private readonly owner: string;
  private readonly now: () => number;
  constructor(storage: Pick<DurableObjectStorage, "sql">, files: Pick<PersonFiles, "writeBytes" | "remove" | "key">, bucket: AudioBucket, owner: string, now: () => number = () => Date.now()) {
    this.storage = storage;
    this.files = files;
    this.bucket = bucket;
    this.owner = owner;
    this.now = now;
  }

  private rows(where: string, ...args: SqlStorageValue[]): Row[] {
    return this.storage.sql.exec(`SELECT * FROM audio_items WHERE ${where} ORDER BY created_at, id`, ...args).toArray() as unknown as Row[];
  }

  /** The removed copy's key: under the person's own `trash/` prefix. */
  trashKey(path: string): string {
    return homeKey(this.owner, `trash/${path}`);
  }

  async call(c: AudioCall, requester: string): Promise<AudioResult> {
    if (requester !== this.owner) return { ok: false, code: "AUDIO_NOT_OWNER", reason: "audio pieces and the voice are their own person's" };
    if (c.op === "voice") return this.voice();
    if (c.op === "voice-set") return this.setVoice(c.speaker, c.writer);
    if (c.op === "save") return this.save(c);
    if (c.op === "list") return { ok: true, items: this.rows(c.removed ? "1 = 1" : "removed_at IS NULL").map(item) };
    const r = typeof c.id === "string" && ID.test(c.id) ? this.rows("id = ?", c.id)[0] : undefined;
    if (!r) return { ok: false, code: "AUDIO_NOT_FOUND", reason: "no audio piece of the person's has that id" };
    if (c.op === "read") return { ok: true, item: item(r) };
    if (c.op === "remove") return this.remove(r);
    return this.restore(r);
  }

  /** The person's voice: what they set, else the default speaker. */
  voice(): AudioResult {
    const r = this.storage.sql.exec<{ value: string; writer: string }>("SELECT value, writer FROM speech_settings WHERE key = 'speaker'").toArray()[0];
    return r ? { ok: true, speaker: r.value, set: true, writer: r.writer } : { ok: true, speaker: DEFAULT_SPEAKER, set: false };
  }

  private setVoice(speaker: string, writer: string): AudioResult {
    if (!(SPEAKERS as readonly string[]).includes(speaker)) return { ok: false, code: "VOICE_UNKNOWN", reason: `${String(speaker).slice(0, 40)} is not a speaker; the speakers are ${SPEAKERS.join(", ")}` };
    this.storage.sql.exec("INSERT INTO speech_settings (key, value, writer, updated_at) VALUES ('speaker', ?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, writer = excluded.writer, updated_at = excluded.updated_at", speaker, writer, this.now());
    return { ok: true, speaker, set: true, writer };
  }

  /** The file through `writeBytes` first, then its row: a row never names a file that was not written. */
  private async save(c: Extract<AudioCall, { op: "save" }>): Promise<AudioResult> {
    const id = crypto.randomUUID();
    const path = `audio/${id}.mp3`;
    const w = await this.files.writeBytes({ path, bytes: c.bytes, mediaType: "audio/mpeg" }, { requester: this.owner, writer: `agent:${this.owner}` });
    if (!w.ok) return { ok: false, code: (w as Fail).code, reason: `the audio was made but not saved: ${(w as Fail).reason}` };
    this.storage.sql.exec(
      "INSERT INTO audio_items (id, kind, path, duration_ms, voice, model, source, topics, chat_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      id, c.kind, path, Math.round(c.durationMs), c.voice, c.model, c.source, c.topics?.length ? JSON.stringify(c.topics.slice(0, 8).map((t) => String(t).slice(0, 40))) : null, c.chatId ?? null, this.now(),
    );
    return { ok: true, item: item(this.rows("id = ?", id)[0] as Row) };
  }

  /** The object copied under `trash/`, the row marked, then the file taken out of the person's files. */
  private async remove(r: Row): Promise<AudioResult> {
    if (r.removed_at !== null) return { ok: false, code: "AUDIO_ALREADY_REMOVED", reason: "that audio piece is already removed; restore brings it back" };
    const o = await this.bucket.get(this.files.key(r.path));
    if (!o) return { ok: false, code: "AUDIO_NOT_STORED", reason: "the audio file is missing from the person's files" };
    await this.bucket.put(this.trashKey(r.path), new Uint8Array(await o.arrayBuffer()), { httpMetadata: { contentType: "audio/mpeg" } });
    this.storage.sql.exec("UPDATE audio_items SET removed_at = ? WHERE id = ?", this.now(), r.id);
    await this.files.remove({ path: r.path }, this.owner);
    return { ok: true, item: item(this.rows("id = ?", r.id)[0] as Row) };
  }

  /** The file written back from `trash/`, the row unmarked, then the trash copy deleted. */
  private async restore(r: Row): Promise<AudioResult> {
    if (r.removed_at === null) return { ok: false, code: "AUDIO_NOT_REMOVED", reason: "that audio piece is not removed" };
    const o = await this.bucket.get(this.trashKey(r.path));
    if (!o) return { ok: false, code: "AUDIO_NOT_STORED", reason: "the removed copy is missing from the person's trash" };
    const w = await this.files.writeBytes({ path: r.path, bytes: new Uint8Array(await o.arrayBuffer()), mediaType: "audio/mpeg" }, { requester: this.owner, writer: `agent:${this.owner}` });
    if (!w.ok) return { ok: false, code: (w as Fail).code, reason: `the audio was not restored: ${(w as Fail).reason}` };
    this.storage.sql.exec("UPDATE audio_items SET removed_at = NULL WHERE id = ?", r.id);
    await this.bucket.delete(this.trashKey(r.path));
    return { ok: true, item: item(this.rows("id = ?", r.id)[0] as Row) };
  }
}
