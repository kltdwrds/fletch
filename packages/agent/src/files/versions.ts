// A Library that keeps what it replaced (F103, P11 delta 9, B-P11-05 and the trash half of B-P11-14), built on D-0028
// (PROPOSED, one-way) as one deletable unit. Every write over a home file first keeps the replaced bytes as version n
// of its path; a delete moves the file and its versions to the trash. Rows in this Person object's SQLite
// (`file_versions`, `file_trash`, the migration `person.file-versions`), bytes in R2 under the person's home key and a
// `versions/` prefix, one object per kept copy, named by a random id so no key carries the file's path. Owner-only on
// every call; a share never reaches any of it (`PersonLinks.shared` reads the live `files` row alone). Caps: 20
// versions per path and 30 days in the trash, the oldest dropped first, each drop one content-free Ledger journal row.
// If D-0028 is rejected, this file, its migration, its routes and the tool fields that read it are deleted, and an edit
// says again that the earlier content was not kept (the PR's "To revert D-0028" names each).
import type { JournalRow } from "../grants/journal.ts";
import { homeKey } from "../memory/home.ts";

export const VERSIONS_MAX = 20;
export const TRASH_DAYS = 30;
export const TRASH_MS = TRASH_DAYS * 24 * 60 * 60_000;
export const VERSIONS_DIR = "versions";

export const SCHEMA = `CREATE TABLE IF NOT EXISTS file_versions (
  id TEXT PRIMARY KEY, path TEXT NOT NULL, n INTEGER NOT NULL, size INTEGER NOT NULL, sha256 TEXT NOT NULL,
  writer TEXT NOT NULL, at INTEGER NOT NULL, media_type TEXT, trash_id TEXT
);
CREATE INDEX IF NOT EXISTS file_versions_path ON file_versions (path, trash_id, n);
CREATE TABLE IF NOT EXISTS file_trash (
  id TEXT PRIMARY KEY, path TEXT NOT NULL, size INTEGER NOT NULL, sha256 TEXT NOT NULL, writer TEXT NOT NULL,
  updated_at INTEGER NOT NULL, media_type TEXT, pinned INTEGER NOT NULL DEFAULT 0, trashed_at INTEGER NOT NULL
)`;

export type HistoryCode = "FILES_NOT_OWNER" | "FILES_PATH_INVALID" | "FILES_NOT_FOUND" | "FILES_UNAVAILABLE" | "FILES_EXISTS" | "FILES_VERSION_NOT_FOUND" | "FILES_TRASH_NOT_FOUND";
export type HistoryRefusal = { ok: false; code: HistoryCode; reason: string };
/** One kept version of a path as the owner lists it. */
export interface VersionEntry { n: number; size: number; sha256: string; writer: string; at: number; mediaType: string | null }
/** One trashed file: its path, size, when it went and when the cap ends it, and how many versions went with it. */
export interface TrashEntry { id: string; path: string; size: number; sha256: string; mediaType: string | null; trashedAt: number; expiresAt: number; versions: number }
/** The row a kept copy is made from: the file as it stood. */
export interface KeptRow { path: string; size: number; sha256: string; writer: string; updated_at: number; media_type: string | null; pinned?: number }
/** A drop's journal sink: the owner's Ledger, as `journaled.ts` writes every other file row. */
export type DropSink = (row: JournalRow) => Promise<unknown>;

type VRow = { id: string; path: string; n: number; size: number; sha256: string; writer: string; at: number; media_type: string | null; trash_id: string | null };
type TRow = { id: string; path: string; size: number; sha256: string; writer: string; updated_at: number; media_type: string | null; pinned: number; trashed_at: number };

const refuse = (code: HistoryCode, reason: string): HistoryRefusal => ({ ok: false, code, reason });
const rid = () => [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");

async function sha(bytes: Uint8Array): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** One content-free row for a history action of the owner's (a restore, a cap's drop, an emptied trash). */
export function historyRow(o: { owner: string; by: "agent" | "person" | "cap"; actionKind: "files.restore" | "files.version-drop" | "files.purge"; path: string; at: number }): JournalRow {
  return {
    id: `${o.actionKind}.${rid()}`,
    at: o.at,
    // A cap's drop is the owner's own store acting for them: their agent, as the journal knows actors.
    actor: `${o.by === "cap" ? "agent" : o.by}:${o.owner}`,
    principal: o.owner,
    actionKind: o.actionKind,
    subjectRef: `personal;resource:file:${o.path}`,
    counterpart: "own-agent",
    origin: o.owner,
    hops: 0,
    decision: "auto",
    grantId: null,
    outcome: "DONE",
    runId: `files:${o.at}`,
    tokens: 0,
  };
}

export class FileHistory {
  private readonly sql: SqlStorage;
  private readonly bucket: R2Bucket;
  private readonly owner: string;
  private readonly now: () => number;
  private readonly journal?: DropSink;

  constructor(sql: SqlStorage, bucket: R2Bucket, owner: string, now: () => number, journal?: DropSink) {
    this.sql = sql;
    this.bucket = bucket;
    this.owner = owner;
    this.now = now;
    this.journal = journal;
  }

  /** The R2 key of one kept copy: under the home key's `versions/` prefix, by id. */
  key(id: string): string {
    return homeKey(this.owner, `${VERSIONS_DIR}/${id}`);
  }

  private async drop(kind: "files.version-drop" | "files.purge", path: string): Promise<void> {
    if (!this.journal) return;
    try {
      await this.journal(historyRow({ owner: this.owner, by: "cap", actionKind: kind, path, at: this.now() }));
    } catch {
      // A drop the Ledger did not take is still a drop; the bytes are gone either way, and nothing says otherwise.
    }
  }

  private live(path: string): VRow[] {
    return this.sql.exec<VRow>("SELECT * FROM file_versions WHERE path = ? AND trash_id IS NULL ORDER BY n", path).toArray();
  }

  /** How many versions each live path keeps, for the listing. */
  counts(): Map<string, number> {
    const rows = this.sql.exec<{ path: string; c: number }>("SELECT path, COUNT(*) AS c FROM file_versions WHERE trash_id IS NULL GROUP BY path").toArray();
    return new Map(rows.map((r) => [r.path, Number(r.c)]));
  }

  /**
   * Keeps the file as it stood as the next version of its path, before the write that replaces it; then the cap drops
   * the oldest beyond `VERSIONS_MAX`. The number kept, or a refusal: a copy the store did not take stops the write.
   */
  async keep(r: KeptRow, bytes: Uint8Array): Promise<{ ok: true; n: number } | HistoryRefusal> {
    if ((await sha(bytes)) !== r.sha256) return refuse("FILES_UNAVAILABLE", `the stored copy of ${r.path} differs from its record, so it was not replaced`);
    const id = rid();
    const put = await this.bucket.put(this.key(id), bytes, { ...(r.media_type ? { httpMetadata: { contentType: r.media_type } } : {}), customMetadata: { sha256: r.sha256 } });
    if (!put) return refuse("FILES_UNAVAILABLE", `the store refused to keep the earlier ${r.path}, so it was not replaced`);
    const n = (this.live(r.path).at(-1)?.n ?? 0) + 1;
    this.sql.exec("INSERT INTO file_versions (id, path, n, size, sha256, writer, at, media_type, trash_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)", id, r.path, n, r.size, r.sha256, r.writer, r.updated_at, r.media_type);
    const over = this.live(r.path).slice(0, -VERSIONS_MAX);
    for (const v of over) {
      await this.bucket.delete(this.key(v.id));
      this.sql.exec("DELETE FROM file_versions WHERE id = ?", v.id);
      await this.drop("files.version-drop", r.path);
    }
    return { ok: true, n };
  }

  versions(path: string, requester: string): { ok: true; path: string; versions: VersionEntry[] } | HistoryRefusal {
    if (requester !== this.owner) return refuse("FILES_NOT_OWNER", "only the owner reads their versions");
    return { ok: true, path, versions: this.live(path).map((v) => ({ n: v.n, size: v.size, sha256: v.sha256, writer: v.writer, at: v.at, mediaType: v.media_type })) };
  }

  /** One version's bytes, checked against its row; the owner alone. */
  async open(path: string, n: number, requester: string): Promise<{ ok: true; path: string; n: number; sha256: string; size: number; bytes: Uint8Array; mediaType: string | null } | HistoryRefusal> {
    if (requester !== this.owner) return refuse("FILES_NOT_OWNER", "only the owner reads their versions");
    const v = this.live(path).find((x) => x.n === n);
    if (!v) return refuse("FILES_VERSION_NOT_FOUND", `${path} has no version ${n}`);
    const obj = await this.bucket.get(this.key(v.id));
    const bytes = obj ? new Uint8Array(await obj.arrayBuffer()) : null;
    if (bytes === null || (await sha(bytes)) !== v.sha256) return refuse("FILES_UNAVAILABLE", `the kept copy of ${path} version ${n} is missing or differs from its record`);
    return { ok: true, path, n, sha256: v.sha256, size: v.size, bytes, mediaType: v.media_type };
  }

  /** Moves a file being deleted, and its versions, to the trash: its bytes kept under a new id first. */
  async toTrash(r: KeptRow, bytes: Uint8Array): Promise<{ ok: true; id: string } | HistoryRefusal> {
    const id = rid();
    const put = await this.bucket.put(this.key(id), bytes, { ...(r.media_type ? { httpMetadata: { contentType: r.media_type } } : {}), customMetadata: { sha256: r.sha256 } });
    if (!put) return refuse("FILES_UNAVAILABLE", `the store refused to keep ${r.path} in the trash, so it was not deleted`);
    this.sql.exec("INSERT INTO file_trash (id, path, size, sha256, writer, updated_at, media_type, pinned, trashed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", id, r.path, r.size, r.sha256, r.writer, r.updated_at, r.media_type, r.pinned ?? 0, this.now());
    this.sql.exec("UPDATE file_versions SET trash_id = ? WHERE path = ? AND trash_id IS NULL", id, r.path);
    return { ok: true, id };
  }

  /** Ends one trashed file and its versions, bytes first; journaled as a purge. */
  private async end(t: TRow): Promise<void> {
    for (const v of this.sql.exec<{ id: string }>("SELECT id FROM file_versions WHERE trash_id = ?", t.id).toArray()) await this.bucket.delete(this.key(v.id));
    await this.bucket.delete(this.key(t.id));
    this.sql.exec("DELETE FROM file_versions WHERE trash_id = ?", t.id);
    this.sql.exec("DELETE FROM file_trash WHERE id = ?", t.id);
    await this.drop("files.purge", t.path);
  }

  /** The cap: a file trashed `TRASH_DAYS` ago ends, the oldest first. */
  async sweep(): Promise<number> {
    const old = this.sql.exec<TRow>("SELECT * FROM file_trash WHERE trashed_at <= ? ORDER BY trashed_at", this.now() - TRASH_MS).toArray();
    for (const t of old) await this.end(t);
    return old.length;
  }

  async trash(requester: string): Promise<{ ok: true; trash: TrashEntry[] } | HistoryRefusal> {
    if (requester !== this.owner) return refuse("FILES_NOT_OWNER", "only the owner reads their trash");
    await this.sweep();
    const rows = this.sql.exec<TRow & { c: number }>("SELECT t.*, (SELECT COUNT(*) FROM file_versions v WHERE v.trash_id = t.id) AS c FROM file_trash t ORDER BY t.trashed_at DESC").toArray();
    return { ok: true, trash: rows.map((t) => ({ id: t.id, path: t.path, size: t.size, sha256: t.sha256, mediaType: t.media_type, trashedAt: t.trashed_at, expiresAt: t.trashed_at + TRASH_MS, versions: Number(t.c) })) };
  }

  /**
   * Takes a trashed file out (the newest of its path, or the one `id` names): its row as it was, its bytes checked,
   * its versions live again. The caller writes the `files` row; this one says what to write.
   */
  async untrash(path: string, requester: string, id?: string): Promise<{ ok: true; row: KeptRow; bytes: Uint8Array; finish: () => Promise<void> } | HistoryRefusal> {
    if (requester !== this.owner) return refuse("FILES_NOT_OWNER", "only the owner restores their files");
    await this.sweep();
    const t = (id ? this.sql.exec<TRow>("SELECT * FROM file_trash WHERE id = ?", id) : this.sql.exec<TRow>("SELECT * FROM file_trash WHERE path = ? ORDER BY trashed_at DESC", path)).toArray()[0];
    if (!t || (path && t.path !== path)) return refuse("FILES_TRASH_NOT_FOUND", `${path || id} is not in the trash`);
    if (this.live(t.path).length > 0) return refuse("FILES_EXISTS", `a file is already at ${t.path}`);
    const obj = await this.bucket.get(this.key(t.id));
    const bytes = obj ? new Uint8Array(await obj.arrayBuffer()) : null;
    if (bytes === null || (await sha(bytes)) !== t.sha256) return refuse("FILES_UNAVAILABLE", `the trashed copy of ${t.path} is missing or differs from its record`);
    const finish = async () => {
      this.sql.exec("UPDATE file_versions SET trash_id = NULL WHERE trash_id = ?", t.id);
      this.sql.exec("DELETE FROM file_trash WHERE id = ?", t.id);
      await this.bucket.delete(this.key(t.id));
    };
    return { ok: true, row: { path: t.path, size: t.size, sha256: t.sha256, writer: t.writer, updated_at: t.updated_at, media_type: t.media_type, pinned: t.pinned }, bytes, finish };
  }

  /** Empties the trash: every trashed file and its versions end now. How many went. */
  async empty(requester: string): Promise<{ ok: true; emptied: number } | HistoryRefusal> {
    if (requester !== this.owner) return refuse("FILES_NOT_OWNER", "only the owner empties their trash");
    const rows = this.sql.exec<TRow>("SELECT * FROM file_trash ORDER BY trashed_at").toArray();
    for (const t of rows) await this.end(t);
    return { ok: true, emptied: rows.length };
  }

  /** Offboarding's purge: every version and every trashed file, bytes first. */
  async purgeAll(): Promise<number> {
    const ids = [...this.sql.exec<{ id: string }>("SELECT id FROM file_versions").toArray(), ...this.sql.exec<{ id: string }>("SELECT id FROM file_trash").toArray()];
    for (const r of ids) await this.bucket.delete(this.key(r.id));
    this.sql.exec("DELETE FROM file_versions");
    this.sql.exec("DELETE FROM file_trash");
    return ids.length;
  }
}
