// A person's attachments (M24.3), in their `Person` object's SQLite: one row per file the person sent in
// chat, per file a mail brought them, and per file a colleague's request carried to their agent. The bytes
// are in the tenant bucket, content-addressed under the uploader's own home (`person/<id>/user/<sha256>`),
// and the key is always derived here from the row's owner, never taken from a request. A row points at
// the chat message it was sent with or at the mail notice it came in, never both.
//
// Disclosure (scope item 8): a row is a personal item of its uploader with the audience it was shared to.
// The person's own uploads and mail are theirs; a colleague's request's attachment is the sender's, with
// the request's audience (the sender and whoever started the chain), so this person's own listing, reads
// and later turns never see it unless that audience names them. It is read by the turn that answers the
// request under the request's readers, as the request's words are. It is never ingested into this
// person's tree.
import { discloses, readersOf } from "../memory/disclosure.ts";
import { homeKey } from "../memory/home.ts";
import { type AttachmentClass, type Caps, CAPS, checkAttachment, cleanName, type ImageConverter, MAX_PER_MESSAGE, sha256Hex, toJpeg } from "./caps.ts";

/** The ingest seam (workstream A's `files/ingest.ts`), injected so the owning store stays testable alone. */
export type IngestResult =
  | { ok: true; kind: "image" | "document" | "archive" | "text"; treePath: string; pages: number; captionText?: string }
  | { ok: false; code: string; reason: string };
export type IngestFn = (input: { owner: string; attachmentId: string; name: string; mime: string; bytes: Uint8Array }) => Promise<IngestResult>;
export type DescribeFn = (name: string, result: IngestResult) => string;

/** The calls the bucket answers for attachments; R2 answers all four. */
export interface AttachmentBucket {
  put(key: string, value: Uint8Array, opts?: { httpMetadata?: { contentType?: string }; customMetadata?: Record<string, string> }): Promise<unknown>;
  head(key: string): Promise<{ size: number } | null>;
  get(key: string): Promise<{ size: number; body?: ReadableStream; arrayBuffer(): Promise<ArrayBuffer> } | null>;
  delete(key: string): Promise<unknown>;
}

export const attachmentKey = (owner: string, sha256: string) => homeKey(owner, `user/${sha256}`);
const SHA = /^[0-9a-f]{64}$/;
const ID = /^[0-9a-f-]{36}$/;

export const SCHEMA = `CREATE TABLE IF NOT EXISTS attachments (
  id TEXT PRIMARY KEY, owner TEXT NOT NULL, sha256 TEXT NOT NULL, name TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL, cls TEXT NOT NULL,
  source TEXT NOT NULL, chat_id TEXT, message_id TEXT, notice_id TEXT, request_id TEXT, audience TEXT,
  status TEXT NOT NULL, code TEXT, kind TEXT, tree_path TEXT, pages INTEGER, caption TEXT, created_at INTEGER NOT NULL,
  CHECK (message_id IS NULL OR notice_id IS NULL));`;

type Row = {
  id: string; owner: string; sha256: string; name: string; mime: string; size: number; cls: AttachmentClass; source: "chat" | "mail" | "request";
  chat_id: string | null; message_id: string | null; notice_id: string | null; request_id: string | null; audience: string | null;
  status: "read" | "unread"; code: string | null; kind: string | null; tree_path: string | null; pages: number | null; caption: string | null; created_at: number;
};

/** What the person and their page are shown of one attachment; never the bucket key. */
export type AttachmentView = { id: string; name: string; mime: string; size: number; source: Row["source"]; status: Row["status"]; code?: string; pages?: number; at: number };
/** What a colleague's request carries of one of the sender's attachments: metadata, never bytes or a key. */
export type AttachmentRef = { id: string; sha256: string; name: string; mime: string; size: number; cls: AttachmentClass; line: string };
export type Dropped = { name: string; code: string; words: string };
type Fail = { ok: false; code: string; reason: string };

export type AttachmentCall =
  | { op: "record"; sha256: string; name: string; mime: string; size: number; cls: AttachmentClass }
  | { op: "bind"; ids: string[]; chatId: string; messageId: string }
  | { op: "list" }
  | { op: "get"; id: string }
  | { op: "share"; ids: string[] };

export interface AttachmentDeps {
  person: string;
  bucket: AttachmentBucket;
  ingest: IngestFn;
  describe: DescribeFn;
  convert: ImageConverter | null;
  now(): number;
  caps?: Caps;
}

const view = (r: Row): AttachmentView => ({ id: r.id, name: r.name, mime: r.mime, size: r.size, source: r.source, status: r.status, ...(r.code ? { code: r.code } : {}), ...(r.pages ? { pages: r.pages } : {}), at: r.created_at });

export class PersonAttachments {
  private readonly storage: Pick<DurableObjectStorage, "sql">;
  private readonly deps: AttachmentDeps;
  constructor(storage: Pick<DurableObjectStorage, "sql">, deps: AttachmentDeps) {
    this.storage = storage;
    this.deps = deps;
  }

  private get sql(): Pick<SqlStorage, "exec"> {
    return this.storage.sql;
  }

  private rows(where: string, ...args: SqlStorageValue[]): Row[] {
    return this.sql.exec(`SELECT * FROM attachments WHERE ${where} ORDER BY created_at, id`, ...args).toArray() as unknown as Row[];
  }

  /** The disclosure gate over one row for the readers of a call; the uploader is the item's owner. */
  disclosed(r: Pick<Row, "owner" | "audience">, readers: readonly string[]): boolean {
    const audience = r.audience ? (JSON.parse(r.audience) as string[]) : null;
    return readers.length > 0 && readers.every((email) => discloses({ scope: "personal", owner: r.owner, audience }, { email, member: true, teams: [] }).ok);
  }

  /** The model's line for one row: its id, so the agent can name it, and the reader's words for it. */
  line(r: Row): string {
    const result: IngestResult =
      r.status === "read" ? { ok: true, kind: r.kind as "image", treePath: r.tree_path ?? "", pages: r.pages ?? 0, ...(r.caption ? { captionText: r.caption } : {}) } : { ok: false, code: r.code ?? "ATTACHMENT_UNREAD", reason: r.cls === "video" ? "a video is kept for the person; its content is not read" : "it could not be read" };
    return `[attachment ${r.id}] ${this.deps.describe(r.name, result)}`;
  }

  /** The person's own call from the app or their chat: refused for anyone else, where the rows live. */
  async call(by: string, c: AttachmentCall): Promise<unknown> {
    if (by !== this.deps.person) return { ok: false, code: "ATTACHMENT_NOT_OWNER", reason: "attachments are their own person's" };
    if (c.op === "record") return this.record(c);
    if (c.op === "bind") return this.bind(c);
    if (c.op === "share") return this.share(c.ids);
    if (c.op === "list") return { ok: true, attachments: this.rows("1 = 1").filter((r) => this.disclosed(r, [by])).map(view) };
    const r = typeof c.id === "string" && ID.test(c.id) ? this.rows("id = ?", c.id)[0] : undefined;
    if (!r) return { ok: false, code: "ATTACHMENT_NOT_FOUND", reason: "no such attachment" };
    if (!this.disclosed(r, [by])) return { ok: false, code: "ATTACHMENT_NOT_DISCLOSED", reason: "this attachment was shared with someone else" };
    return { ok: true, attachment: view(r), key: attachmentKey(r.owner, r.sha256) };
  }

  /**
   * Offboarding's purge (M24.3): every row this person's table keeps, and the stored copy of each row of
   * their own (a colleague's row points at the colleague's key and is not theirs to delete); how many rows went.
   */
  async purgeAll(): Promise<number> {
    const rows = this.rows("1 = 1");
    for (const sha of new Set(rows.filter((r) => r.owner === this.deps.person).map((r) => r.sha256))) await this.deps.bucket.delete(attachmentKey(this.deps.person, sha));
    this.sql.exec("DELETE FROM attachments");
    return rows.length;
  }

  /** A file the app's route stored under this person's key: checked there, kept here, then read for the agent. */
  private async record(c: Extract<AttachmentCall, { op: "record" }>): Promise<{ ok: true; attachment: AttachmentView; line: string } | Fail> {
    if (!SHA.test(String(c.sha256))) return { ok: false, code: "ATTACHMENT_INVALID", reason: "sha256 is 64 hex digits" };
    const stored = await this.deps.bucket.head(attachmentKey(this.deps.person, c.sha256));
    if (!stored || stored.size !== c.size) return { ok: false, code: "ATTACHMENT_NOT_STORED", reason: "no stored file of that digest and size" };
    const r = await this.keep({ sha256: c.sha256, name: cleanName(c.name), mime: c.mime, size: c.size, cls: c.cls, source: "chat" });
    return { ok: true, attachment: view(r), line: this.line(r) };
  }

  /** Inserts a row of this person's own and reads it for the agent: its result is stored as it came, failures included. */
  private async keep(a: { sha256: string; name: string; mime: string; size: number; cls: AttachmentClass; source: "chat" | "mail"; chatId?: string; noticeId?: string; bytes?: Uint8Array }): Promise<Row> {
    const id = crypto.randomUUID();
    const p = this.deps.person;
    this.sql.exec(
      "INSERT INTO attachments (id, owner, sha256, name, mime, size, cls, source, chat_id, notice_id, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'unread', ?)",
      id, p, a.sha256, a.name, a.mime, a.size, a.cls, a.source, a.chatId ?? null, a.noticeId ?? null, this.deps.now(),
    );
    let result: IngestResult = { ok: false, code: "ATTACHMENT_VIDEO_UNREAD", reason: "a video is kept, not read" };
    if (a.cls !== "video") {
      const bytes = a.bytes ?? (await this.read(attachmentKey(p, a.sha256)));
      try {
        result = bytes ? await this.deps.ingest({ owner: p, attachmentId: id, name: a.name, mime: a.mime, bytes }) : { ok: false, code: "ATTACHMENT_NOT_STORED", reason: "the stored file is gone" };
      } catch (e) {
        result = { ok: false, code: "INGEST_FAILED", reason: String((e as Error)?.message ?? e).slice(0, 200) };
      }
    }
    if (result.ok) this.sql.exec("UPDATE attachments SET status = 'read', kind = ?, tree_path = ?, pages = ?, caption = ? WHERE id = ?", result.kind, result.treePath, result.pages, result.captionText ?? null, id);
    else this.sql.exec("UPDATE attachments SET code = ? WHERE id = ?", result.code, id);
    return this.rows("id = ?", id)[0] as Row;
  }

  private async read(key: string): Promise<Uint8Array | null> {
    const o = await this.deps.bucket.get(key);
    return o ? new Uint8Array(await o.arrayBuffer()) : null;
  }

  /** The person's message names the attachments it carries; each must be theirs and not sent with another message. */
  private bind(c: Extract<AttachmentCall, { op: "bind" }>): { ok: true; lines: string[] } | Fail {
    const ids = [...new Set(Array.isArray(c.ids) ? c.ids : [])];
    if (!ids.length || ids.length > MAX_PER_MESSAGE) return { ok: false, code: "ATTACHMENTS_INVALID", reason: `a message carries 1 to ${MAX_PER_MESSAGE} attachments` };
    const rows: Row[] = [];
    for (const id of ids) {
      const r = typeof id === "string" && ID.test(id) ? this.rows("id = ? AND owner = ? AND source = 'chat'", id, this.deps.person)[0] : undefined;
      if (!r) return { ok: false, code: "ATTACHMENT_NOT_FOUND", reason: "no such attachment of the person's" };
      if (r.message_id && (r.message_id !== c.messageId || r.chat_id !== c.chatId)) return { ok: false, code: "ATTACHMENT_ALREADY_SENT", reason: "that attachment went with another message" };
      rows.push(r);
    }
    for (const r of rows) this.sql.exec("UPDATE attachments SET chat_id = ?, message_id = ? WHERE id = ?", c.chatId, c.messageId, r.id);
    return { ok: true, lines: rows.map((r) => this.line(r)) };
  }

  /** The person's agent attaches their own files to a request to a colleague's agent: metadata only. */
  private share(ids: unknown): { ok: true; refs: AttachmentRef[] } | Fail {
    const list = [...new Set(Array.isArray(ids) ? ids : [])];
    if (!list.length || list.length > MAX_PER_MESSAGE) return { ok: false, code: "ATTACHMENTS_INVALID", reason: `a request carries 1 to ${MAX_PER_MESSAGE} attachments` };
    const refs: AttachmentRef[] = [];
    for (const id of list) {
      const r = typeof id === "string" && ID.test(id) ? this.rows("id = ? AND owner = ?", id, this.deps.person)[0] : undefined;
      if (!r) return { ok: false, code: "ATTACHMENT_NOT_FOUND", reason: "the agent can attach only its own person's files" };
      refs.push({ id: r.id, sha256: r.sha256, name: r.name, mime: r.mime, size: r.size, cls: r.cls, line: this.line(r) });
    }
    return { ok: true, refs };
  }

  /**
   * A colleague's request's attachments, arriving at this person's agent: kept as the sender's, with the
   * request's audience, pointing at the sender's own key. Nothing is read into this person's tree.
   */
  fromRequest(r: { from: string; origin: string; requestId: string; chatId: string; refs: unknown }): { ok: true; lines: string[] } | Fail {
    const refs = Array.isArray(r.refs) ? r.refs : [];
    if (refs.length > MAX_PER_MESSAGE) return { ok: false, code: "ATTACHMENTS_INVALID", reason: `a request carries at most ${MAX_PER_MESSAGE} attachments` };
    const audience = JSON.stringify(readersOf(r.from, [r.origin]).filter((e) => e !== this.deps.person).sort());
    const lines: string[] = [];
    for (const ref of refs as AttachmentRef[]) {
      if (!ref || !SHA.test(String(ref.sha256)) || !ID.test(String(ref.id)) || !(Number(ref.size) > 0)) return { ok: false, code: "ATTACHMENTS_INVALID", reason: "an attachment reference is malformed" };
      const id = crypto.randomUUID();
      this.sql.exec(
        "INSERT INTO attachments (id, owner, sha256, name, mime, size, cls, source, chat_id, request_id, audience, status, code, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'request', ?, ?, ?, 'unread', 'REQUEST_ATTACHMENT', ?)",
        id, r.from, ref.sha256, cleanName(ref.name), String(ref.mime), Number(ref.size), ref.cls === "video" || ref.cls === "image" ? ref.cls : "file", r.chatId, r.requestId, audience, this.deps.now(),
      );
      lines.push(String(ref.line ?? ""));
    }
    return { ok: true, lines };
  }

  /** A mail's attachments: each checked, converted, stored under this person's key and read; each dropped one said. */
  async fromMail(m: { chatId: string; noticeId: string; items: Array<{ name: string; mime: string; bytes: Uint8Array }>; dropped: Dropped[] }): Promise<{ kept: Array<{ name: string; line: string }>; dropped: Dropped[] }> {
    const kept: Array<{ name: string; line: string }> = [];
    const dropped = [...m.dropped];
    for (const item of m.items) {
      const a = checkAttachment({ name: item.name, mime: item.mime, size: item.bytes.byteLength }, this.deps.caps ?? CAPS);
      if (!a.ok) {
        dropped.push({ name: cleanName(item.name), code: a.code, words: a.words });
        continue;
      }
      let bytes = item.bytes;
      let name = a.name;
      if (a.convert) {
        const j = await toJpeg(this.deps.convert, a, bytes);
        if (!j.ok) {
          dropped.push({ name: a.name, code: j.code, words: j.words });
          continue;
        }
        ({ bytes, name } = j);
      }
      const sha256 = await sha256Hex(bytes);
      const mime = a.convert ? "image/jpeg" : a.mime;
      try {
        await this.deps.bucket.put(attachmentKey(this.deps.person, sha256), bytes, { httpMetadata: { contentType: mime }, customMetadata: { owner: this.deps.person } });
      } catch (e) {
        dropped.push({ name, code: "ATTACHMENT_STORE_FAILED", words: `${name} could not be stored (${String((e as Error)?.message ?? e).slice(0, 120)}).` });
        continue;
      }
      const r = await this.keep({ sha256, name, mime, size: bytes.byteLength, cls: a.cls, source: "mail", chatId: m.chatId, noticeId: m.noticeId, bytes });
      kept.push({ name, line: this.line(r) });
    }
    return { kept, dropped };
  }
}

