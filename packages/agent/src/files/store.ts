// The person's virtual filesystem (muse-reference section 3's read/write tools): files under
// `files/` in the person's home, owner-only, decided here on every call. Small files live in the
// Person object's SQLite; a file above INLINE_MAX spills to R2 at `person/<person>/files/<path>`,
// and the row keeps its sha256 so a read checks what came back. Paths are validated against one
// pattern, so no tool reaches a key outside the person's `files/` prefix. From M24.3 a row may be a
// binary document (a rendered docx or odt): its bytes are always in R2 with their content type, its
// row names the type, and it is read only as bytes (`readBytes`), never as numbered lines.
import { homeKey } from "../memory/home.ts";
import { type DropSink, FileHistory, type HistoryRefusal, type KeptRow } from "./versions.ts";

export const INLINE_MAX = 16 * 1024;
export const FILE_MAX = 1024 * 1024;
export const FILES_DIR = "files";
export const PAGE_MAX = 200;

const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/;

export type FilesRefusal = { ok: false; code: "FILES_NOT_OWNER" | "FILES_PATH_INVALID" | "FILES_NOT_FOUND" | "FILES_TOO_LARGE" | "FILES_UNAVAILABLE" | "FILES_EXISTS" | "FILES_BINARY"; reason: string };
/** The largest binary document a row holds (a rendered docx or odt). */
export const BINARY_MAX = 10 * 1024 * 1024;
export interface FileEntry {
  path: string;
  size: number;
  sha256: string;
  writer: string;
  updated_at: number;
  spilled: boolean;
  /** Pinned in the Library (M23.4); a flag on the file's own row, so a pin never outlives its file. */
  pinned: boolean;
  /** The first lines of a small file, for the Library's thumbnail; only a list asked `preview` carries it. */
  preview?: string;
  /** Set on a binary document (M24.3): its content type. A text file has none. */
  mediaType?: string;
  /** How many earlier versions the path keeps (F103, D-0028 proposed). */
  versions: number;
}
export type ListResult = { ok: true; files: FileEntry[] } | FilesRefusal;
export type ReadResult = { ok: true; path: string; sha256: string; size: number; spilled: boolean; total: number; lines: Array<{ n: number; text: string }>; next: number | null } | FilesRefusal;
/**
 * `replaced`: an earlier file stood at this path and the write took its place (F100, delta 1 of P11). `kept`: the
 * version number the replaced bytes were kept as (F103, D-0028 proposed); absent, the earlier content was not kept.
 */
export type WriteResult = { ok: true; path: string; sha256: string; size: number; spilled: boolean; replaced: boolean; kept?: number } | FilesRefusal;
/** `trashed`: the file and its versions went to the trash (F103), not away. */
export type DeleteResult = { ok: true; path: string; trashed?: boolean } | FilesRefusal | HistoryRefusal;
export type RestoreResult = { ok: true; path: string; restored: number; kept?: number; sha256: string } | FilesRefusal | HistoryRefusal;
export type UntrashResult = { ok: true; path: string; versions: number } | FilesRefusal | HistoryRefusal;
export type RenameResult = { ok: true; path: string; to: string } | FilesRefusal;
export type PinResult = { ok: true; path: string; pinned: boolean } | FilesRefusal;
export type BytesResult = { ok: true; path: string; sha256: string; size: number; bytes: Uint8Array; mediaType: string | null } | FilesRefusal;

/** How much of a file's start the Library's thumbnail carries. */
export const PREVIEW_LINES = 6;
export const PREVIEW_CHARS = 280;

export const SCHEMA = `CREATE TABLE IF NOT EXISTS files (
  path TEXT PRIMARY KEY, size INTEGER NOT NULL, sha256 TEXT NOT NULL, writer TEXT NOT NULL,
  updated_at INTEGER NOT NULL, body TEXT, spilled INTEGER NOT NULL DEFAULT 0, pinned INTEGER NOT NULL DEFAULT 0
)`;

type Row = { path: string; size: number; sha256: string; writer: string; updated_at: number; body: string | null; spilled: number; pinned: number; media_type: string | null };

const refuse = (code: FilesRefusal["code"], reason: string): FilesRefusal => ({ ok: false, code, reason });

/** A home-relative file path, or null: segments only, no `..`, no empty part, bounded. */
export function parseFilePath(path: string): string | null {
  if (typeof path !== "string" || !path || path.length > 200) return null;
  const parts = path.split("/");
  if (parts.length > 8 || parts.some((p) => !SEGMENT.test(p) || p === "." || p === "..")) return null;
  return parts.join("/");
}

export async function sha256Hex(text: string | Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", typeof text === "string" ? new TextEncoder().encode(text) : text);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** A stored copy's bytes, or null when the object is missing. */
async function bytesOf(obj: R2ObjectBody | null): Promise<Uint8Array | null> {
  return obj ? new Uint8Array(await obj.arrayBuffer()) : null;
}

export class PersonFiles {
  readonly owner: string;
  private readonly storage: DurableObjectStorage;
  private readonly bucket: R2Bucket;
  private readonly now: () => number;
  /** The versions and the trash (F103, D-0028 proposed); `journal` takes a cap's drops. */
  readonly history: FileHistory;

  constructor(storage: DurableObjectStorage, bucket: R2Bucket, owner: string, now: () => number = () => Date.now(), journal?: DropSink) {
    this.storage = storage;
    this.bucket = bucket;
    this.owner = owner;
    this.now = now;
    this.history = new FileHistory(storage.sql, bucket, owner, now, journal);
  }

  /** A row's bytes as stored, or null when a spilled copy is missing. */
  private async stored(r: Row): Promise<Uint8Array | null> {
    return r.spilled === 1 ? bytesOf(await this.bucket.get(this.key(r.path))) : new TextEncoder().encode(r.body ?? "");
  }

  /** Keeps the row being replaced as its path's next version (F103): the number, or the refusal that stops the write. */
  private async keepPrevious(r: Row): Promise<{ ok: true; n: number } | FilesRefusal | HistoryRefusal> {
    const bytes = await this.stored(r);
    if (bytes === null) return refuse("FILES_UNAVAILABLE", `the stored copy of ${r.path} is missing, so it was not replaced`);
    return this.history.keep(r as KeptRow, bytes);
  }

  /** The R2 key of a spilled file. */
  key(path: string): string {
    return homeKey(this.owner, `${FILES_DIR}/${path}`);
  }

  private row(path: string): Row | undefined {
    return this.storage.sql.exec<Row>("SELECT * FROM files WHERE path = ?", path).toArray()[0];
  }

  private entry(r: Row, preview = false, counts?: Map<string, number>): FileEntry {
    const e: FileEntry = { path: r.path, size: r.size, sha256: r.sha256, writer: r.writer, updated_at: r.updated_at, spilled: r.spilled === 1, pinned: r.pinned === 1, ...(r.media_type ? { mediaType: r.media_type } : {}), versions: counts?.get(r.path) ?? 0 };
    // A spilled file's start is not held in the row, so its thumbnail is its type mark alone.
    if (preview && r.body !== null) e.preview = r.body.split("\n").slice(0, PREVIEW_LINES).join("\n").slice(0, PREVIEW_CHARS);
    return e;
  }

  list(input: { prefix?: string; preview?: boolean }, requester: string): ListResult {
    if (requester !== this.owner) return refuse("FILES_NOT_OWNER", "only the owner reads their files");
    const prefix = input.prefix ?? "";
    if (prefix && parseFilePath(prefix.replace(/\/$/, "")) === null) return refuse("FILES_PATH_INVALID", `not a file path: ${prefix}`);
    const rows = this.storage.sql.exec<Row>("SELECT * FROM files WHERE substr(path, 1, ?) = ? ORDER BY path", prefix.length, prefix).toArray();
    const counts = this.history.counts();
    return { ok: true, files: rows.map((r) => this.entry(r, input.preview === true, counts)) };
  }

  async read(input: { path: string; from?: number; limit?: number }, requester: string): Promise<ReadResult> {
    if (requester !== this.owner) return refuse("FILES_NOT_OWNER", "only the owner reads their files");
    const path = parseFilePath(input.path);
    if (path === null) return refuse("FILES_PATH_INVALID", `not a file path: ${input.path}`);
    const r = this.row(path);
    if (!r) return refuse("FILES_NOT_FOUND", `no file at ${path}`);
    if (r.media_type) return refuse("FILES_BINARY", `${path} is a ${r.media_type} document, not text; it opens from the Library or its download link`);
    let body = r.body;
    if (r.spilled === 1) {
      const obj = await this.bucket.get(this.key(path));
      body = obj ? await obj.text() : null;
      if (body === null || (await sha256Hex(body)) !== r.sha256) return refuse("FILES_UNAVAILABLE", `the stored copy of ${path} is missing or differs from its record`);
    }
    const all = (body ?? "").split("\n");
    const from = Math.max(1, input.from ?? 1);
    const limit = Math.min(PAGE_MAX, Math.max(1, input.limit ?? PAGE_MAX));
    const lines = all.slice(from - 1, from - 1 + limit).map((text, i) => ({ n: from + i, text }));
    const next = from - 1 + limit < all.length ? from + limit : null;
    return { ok: true, path, sha256: r.sha256, size: r.size, spilled: r.spilled === 1, total: all.length, lines, next };
  }

  async write(input: { path: string; text: string }, ctx: { requester: string; writer: string }): Promise<WriteResult> {
    if (ctx.requester !== this.owner) return refuse("FILES_NOT_OWNER", "only the owner writes their files");
    const path = parseFilePath(input.path);
    if (path === null) return refuse("FILES_PATH_INVALID", `not a file path: ${input.path}`);
    const size = new TextEncoder().encode(input.text).byteLength;
    if (size > FILE_MAX) return refuse("FILES_TOO_LARGE", `${size} bytes; the limit is ${FILE_MAX}`);
    const sha256 = await sha256Hex(input.text);
    const spilled = size > INLINE_MAX;
    const previous = this.row(path);
    // The replaced bytes are kept as a version before anything overwrites them (F103); a copy not kept stops the write.
    const kept = previous ? await this.keepPrevious(previous) : null;
    if (kept && !kept.ok) return kept as FilesRefusal;
    if (spilled) {
      const put = await this.bucket.put(this.key(path), input.text, { customMetadata: { sha256, writer: ctx.writer, updated_at: String(this.now()) } });
      if (!put) return refuse("FILES_UNAVAILABLE", `the store refused the write of ${path}`);
    }
    this.storage.sql.exec(
      "INSERT INTO files (path, size, sha256, writer, updated_at, body, spilled, media_type) VALUES (?, ?, ?, ?, ?, ?, ?, NULL) ON CONFLICT(path) DO UPDATE SET size = excluded.size, sha256 = excluded.sha256, writer = excluded.writer, updated_at = excluded.updated_at, body = excluded.body, spilled = excluded.spilled, media_type = NULL",
      path, size, sha256, ctx.writer, this.now(), spilled ? null : input.text, spilled ? 1 : 0,
    );
    // A file that shrank back inline leaves no stale copy behind.
    if (previous?.spilled === 1 && !spilled) await this.bucket.delete(this.key(path));
    return { ok: true, path, sha256, size, spilled, replaced: previous !== undefined, ...(kept?.ok ? { kept: kept.n } : {}) };
  }

  /**
   * Writes a binary document (M24.3): the bytes go to R2 under the person's home prefix with their
   * content type, and the row names the type, so the Library lists it and only `readBytes` serves it.
   */
  async writeBytes(input: { path: string; bytes: Uint8Array; mediaType: string }, ctx: { requester: string; writer: string }): Promise<WriteResult> {
    if (ctx.requester !== this.owner) return refuse("FILES_NOT_OWNER", "only the owner writes their files");
    const path = parseFilePath(input.path);
    if (path === null) return refuse("FILES_PATH_INVALID", `not a file path: ${input.path}`);
    const size = input.bytes.byteLength;
    if (size > BINARY_MAX) return refuse("FILES_TOO_LARGE", `${size} bytes; the limit for a document is ${BINARY_MAX}`);
    const sha256 = await sha256Hex(input.bytes);
    const previous = this.row(path);
    const replaced = previous !== undefined;
    const kept = previous ? await this.keepPrevious(previous) : null;
    if (kept && !kept.ok) return kept as FilesRefusal;
    const put = await this.bucket.put(this.key(path), input.bytes, { httpMetadata: { contentType: input.mediaType }, customMetadata: { sha256, writer: ctx.writer, updated_at: String(this.now()) } });
    if (!put) return refuse("FILES_UNAVAILABLE", `the store refused the write of ${path}`);
    this.storage.sql.exec(
      "INSERT INTO files (path, size, sha256, writer, updated_at, body, spilled, media_type) VALUES (?, ?, ?, ?, ?, NULL, 1, ?) ON CONFLICT(path) DO UPDATE SET size = excluded.size, sha256 = excluded.sha256, writer = excluded.writer, updated_at = excluded.updated_at, body = NULL, spilled = 1, media_type = excluded.media_type",
      path, size, sha256, ctx.writer, this.now(), input.mediaType,
    );
    return { ok: true, path, sha256, size, spilled: true, replaced, ...(kept?.ok ? { kept: kept.n } : {}) };
  }

  /** One file's bytes, text or binary, checked against its record; the owner alone. */
  async readBytes(input: { path: string }, requester: string): Promise<BytesResult> {
    if (requester !== this.owner) return refuse("FILES_NOT_OWNER", "only the owner reads their files");
    const path = parseFilePath(input.path);
    if (path === null) return refuse("FILES_PATH_INVALID", `not a file path: ${input.path}`);
    const r = this.row(path);
    if (!r) return refuse("FILES_NOT_FOUND", `no file at ${path}`);
    const bytes = await this.stored(r);
    if (bytes === null || (await sha256Hex(bytes)) !== r.sha256) return refuse("FILES_UNAVAILABLE", `the stored copy of ${path} is missing or differs from its record`);
    return { ok: true, path, sha256: r.sha256, size: r.size, bytes, mediaType: r.media_type };
  }

  /**
   * Every text file whole, for the person's export (M11.2); a spilled copy that is missing or differs is
   * refused. A binary document cannot travel in the Markdown bundle: it is named in `binary` instead.
   */
  async dump(): Promise<{ ok: true; files: Array<{ path: string; text: string }>; binary: string[] } | FilesRefusal> {
    const out: Array<{ path: string; text: string }> = [];
    const binary: string[] = [];
    for (const r of this.storage.sql.exec<Row>("SELECT * FROM files ORDER BY path").toArray()) {
      if (r.media_type) {
        binary.push(r.path);
        continue;
      }
      let body = r.body;
      if (r.spilled === 1) {
        const obj = await this.bucket.get(this.key(r.path));
        body = obj ? await obj.text() : null;
        if (body === null || (await sha256Hex(body)) !== r.sha256) return refuse("FILES_UNAVAILABLE", `the stored copy of ${r.path} is missing or differs from its record`);
      }
      out.push({ path: r.path, text: body ?? "" });
    }
    return { ok: true, files: out, binary };
  }

  /** Offboarding's purge (M11.2): every file and every spilled copy; returns how many files went. */
  async purgeAll(): Promise<number> {
    const rows = this.storage.sql.exec<Row>("SELECT * FROM files").toArray();
    for (const r of rows) if (r.spilled === 1) await this.bucket.delete(this.key(r.path));
    this.storage.sql.exec("DELETE FROM files");
    await this.history.purgeAll();
    return rows.length;
  }

  async remove(input: { path: string }, requester: string): Promise<DeleteResult> {
    if (requester !== this.owner) return refuse("FILES_NOT_OWNER", "only the owner deletes their files");
    const path = parseFilePath(input.path);
    if (path === null) return refuse("FILES_PATH_INVALID", `not a file path: ${input.path}`);
    const r = this.row(path);
    if (!r) return refuse("FILES_NOT_FOUND", `no file at ${path}`);
    // To the trash with its versions (F103), its bytes kept there before the live copy goes.
    const bytes = await this.stored(r);
    if (bytes === null || (await sha256Hex(bytes)) !== r.sha256) return refuse("FILES_UNAVAILABLE", `the stored copy of ${path} is missing or differs from its record`);
    const trashed = await this.history.toTrash(r as KeptRow, bytes);
    if (!trashed.ok) return trashed;
    if (r.spilled === 1) await this.bucket.delete(this.key(path));
    this.storage.sql.exec("DELETE FROM files WHERE path = ?", path);
    return { ok: true, path, trashed: true };
  }

  /**
   * Makes version `n` the current file again (F103): written as any write is, so the current bytes are kept as the
   * next version first and nothing is lost. The owner alone.
   */
  async restoreVersion(input: { path: string; n: number }, requester: string): Promise<RestoreResult> {
    if (requester !== this.owner) return refuse("FILES_NOT_OWNER", "only the owner restores their files");
    const path = parseFilePath(input.path);
    if (path === null) return refuse("FILES_PATH_INVALID", `not a file path: ${input.path}`);
    if (!this.row(path)) return refuse("FILES_NOT_FOUND", `no file at ${path}`);
    const v = await this.history.open(path, Number(input.n), requester);
    if (!v.ok) return v;
    const ctx = { requester, writer: requester };
    const w = v.mediaType ? await this.writeBytes({ path, bytes: v.bytes, mediaType: v.mediaType }, ctx) : await this.write({ path, text: new TextDecoder().decode(v.bytes) }, ctx);
    if (!w.ok) return w;
    return { ok: true, path, restored: v.n, ...(w.kept ? { kept: w.kept } : {}), sha256: w.sha256 };
  }

  /** Takes a file out of the trash with its versions (F103); refused when a file stands at its path. The owner alone. */
  async restoreTrashed(input: { path: string; id?: string }, requester: string): Promise<UntrashResult> {
    if (requester !== this.owner) return refuse("FILES_NOT_OWNER", "only the owner restores their files");
    const path = input.path ? parseFilePath(input.path) : "";
    if (path === null) return refuse("FILES_PATH_INVALID", `not a file path: ${input.path}`);
    if (path && this.row(path)) return refuse("FILES_EXISTS", `a file is already at ${path}`);
    const t = await this.history.untrash(path, requester, input.id);
    if (!t.ok) return t;
    if (this.row(t.row.path)) return refuse("FILES_EXISTS", `a file is already at ${t.row.path}`);
    const r = t.row;
    const inline = !r.media_type && r.size <= INLINE_MAX;
    if (!inline) {
      const put = await this.bucket.put(this.key(r.path), t.bytes, { ...(r.media_type ? { httpMetadata: { contentType: r.media_type } } : {}), customMetadata: { sha256: r.sha256, writer: r.writer, updated_at: String(r.updated_at) } });
      if (!put) return refuse("FILES_UNAVAILABLE", `the store refused the write of ${r.path}`);
    }
    this.storage.sql.exec(
      "INSERT INTO files (path, size, sha256, writer, updated_at, body, spilled, pinned, media_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      r.path, r.size, r.sha256, r.writer, r.updated_at, inline ? new TextDecoder().decode(t.bytes) : null, inline ? 0 : 1, r.pinned ?? 0, r.media_type,
    );
    await t.finish();
    return { ok: true, path: r.path, versions: this.history.counts().get(r.path) ?? 0 };
  }

  /** Moves a file to a new path in the person's own tree; an existing file at the new path is never overwritten. */
  async rename(input: { path: string; to: string }, requester: string): Promise<RenameResult> {
    if (requester !== this.owner) return refuse("FILES_NOT_OWNER", "only the owner renames their files");
    const path = parseFilePath(input.path);
    const to = parseFilePath(input.to);
    if (path === null) return refuse("FILES_PATH_INVALID", `not a file path: ${input.path}`);
    if (to === null) return refuse("FILES_PATH_INVALID", `not a file path: ${input.to}`);
    const r = this.row(path);
    if (!r) return refuse("FILES_NOT_FOUND", `no file at ${path}`);
    if (to === path) return { ok: true, path, to };
    if (this.row(to)) return refuse("FILES_EXISTS", `a file is already at ${to}`);
    if (r.spilled === 1) {
      // Copied as bytes, with the content type a binary document carries, so a document survives a rename.
      const body = await bytesOf(await this.bucket.get(this.key(path)));
      if (body === null || (await sha256Hex(body)) !== r.sha256) return refuse("FILES_UNAVAILABLE", `the stored copy of ${path} is missing or differs from its record`);
      const put = await this.bucket.put(this.key(to), body, { ...(r.media_type ? { httpMetadata: { contentType: r.media_type } } : {}), customMetadata: { sha256: r.sha256, writer: r.writer, updated_at: String(r.updated_at) } });
      if (!put) return refuse("FILES_UNAVAILABLE", `the store refused the write of ${to}`);
      await this.bucket.delete(this.key(path));
    }
    this.storage.sql.exec("UPDATE files SET path = ? WHERE path = ?", to, path);
    // A file's versions go where it goes (F103).
    this.storage.sql.exec("UPDATE file_versions SET path = ? WHERE path = ? AND trash_id IS NULL", to, path);
    return { ok: true, path, to };
  }

  async pin(input: { path: string; pinned: boolean }, requester: string): Promise<PinResult> {
    if (requester !== this.owner) return refuse("FILES_NOT_OWNER", "only the owner pins their files");
    const path = parseFilePath(input.path);
    if (path === null) return refuse("FILES_PATH_INVALID", `not a file path: ${input.path}`);
    if (!this.row(path)) return refuse("FILES_NOT_FOUND", `no file at ${path}`);
    this.storage.sql.exec("UPDATE files SET pinned = ? WHERE path = ?", input.pinned ? 1 : 0, path);
    return { ok: true, path, pinned: input.pinned };
  }
}
