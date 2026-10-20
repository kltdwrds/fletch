// Signed links to a person's files (M24.3, spec P3 "Out"). Two kinds, both decided here, in the
// person's own object, on every use:
// - A download or preview link on M23.4's read route (`/app/file/raw?path=&exp=&sig=`): HMAC-signed
//   over the path and its expiry with a key only this person's object holds, short-lived, and served
//   only together with the owner's session. Another member's session reaches their own object, whose
//   key never signed the link, so it is refused (LINK_INVALID) whatever the link says.
// - A public share link (`/hooks/share/<id>.<sig>`), made only after the person's fresh approval card
//   (`render/tools.ts`, `share_document`): served without a session until its expiry, then refused
//   (SHARE_EXPIRED); bound to the content approved, so a file changed since is refused (SHARE_CHANGED).
// The signing key is 32 random bytes made on first use and kept in this object's SQLite: nothing in
// the repository or the environment signs a link, and offboarding's purge of the object ends them all.
import { type BytesResult, type FilesRefusal, type PersonFiles, parseFilePath } from "./store.ts";

/** How long a download or preview link lasts: long enough to open it, short enough not to keep. */
export const LINK_TTL_MS = 5 * 60_000;
/** A share link's default and longest life, in minutes: a day, and a week. */
export const SHARE_DEFAULT_MINUTES = 24 * 60;
export const SHARE_MAX_MINUTES = 7 * 24 * 60;

/** A share's life in words: whole hours as hours, anything else as minutes. */
export function lifeWords(minutes: number): string {
  if (minutes % 60 === 0) return `${minutes / 60} hour${minutes === 60 ? "" : "s"}`;
  return `${minutes} minute${minutes === 1 ? "" : "s"}`;
}
/** The public path a share link is served on: under the hooks app's Access bypass (`scripts/platform/access.ts`). */
export const SHARE_PATH = /^\/hooks\/share\/([0-9a-f]{32}\.[0-9a-f]{64})$/;
/** Where the tenant bucket keeps which person a share id belongs to; the person's object still decides. */
export const SHARE_POINTER_PREFIX = "shares/";

export type LinkCode = "LINK_INVALID" | "LINK_EXPIRED" | "SHARE_INVALID" | "SHARE_UNKNOWN" | "SHARE_EXPIRED" | "SHARE_CHANGED";
export type LinkRefusal = { ok: false; code: LinkCode; reason: string };
export type LinkResult = { ok: true; path: string; url: string; expiresAt: number } | FilesRefusal;
export type ShareResult = { ok: true; id: string; path: string; url: string; expiresAt: number } | FilesRefusal | LinkRefusal;
export type ServedResult = Extract<BytesResult, { ok: true }> | FilesRefusal | LinkRefusal;

export const SCHEMA = `CREATE TABLE IF NOT EXISTS link_key (id INTEGER PRIMARY KEY CHECK (id = 1), key BLOB NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS shares (id TEXT PRIMARY KEY, path TEXT NOT NULL, sha256 TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL)`;

const enc = new TextEncoder();
const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
const unhex = (s: string) => new Uint8Array((s.match(/../g) ?? []).map((b) => Number.parseInt(b, 16)));
const refuse = (code: LinkCode, reason: string): LinkRefusal => ({ ok: false, code, reason });

/** The share id a token names, for routing to its person; null when the token is not one. */
export function shareIdOf(token: string): string | null {
  return /^([0-9a-f]{32})\.[0-9a-f]{64}$/.exec(token)?.[1] ?? null;
}

export class PersonLinks {
  private readonly sql: SqlStorage;
  private readonly files: PersonFiles;
  private readonly bucket: R2Bucket;
  private readonly now: () => number;
  private keyPromise?: Promise<CryptoKey>;

  constructor(storage: Pick<DurableObjectStorage, "sql">, files: PersonFiles, bucket: R2Bucket, now: () => number) {
    this.sql = storage.sql;
    this.files = files;
    this.bucket = bucket;
    this.now = now;
  }

  private get owner(): string {
    return this.files.owner;
  }

  /** The person's signing key, made once and never leaving this object. */
  private key(): Promise<CryptoKey> {
    this.keyPromise ??= (async () => {
      let raw = this.sql.exec<{ key: ArrayBuffer }>("SELECT key FROM link_key WHERE id = 1").toArray()[0]?.key;
      if (!raw) {
        const fresh = crypto.getRandomValues(new Uint8Array(32));
        this.sql.exec("INSERT INTO link_key (id, key, created_at) VALUES (1, ?, ?)", fresh, this.now());
        raw = fresh.buffer;
      }
      return crypto.subtle.importKey("raw", new Uint8Array(raw), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
    })();
    return this.keyPromise;
  }

  private async sign(...parts: string[]): Promise<string> {
    return hex(new Uint8Array(await crypto.subtle.sign("HMAC", await this.key(), enc.encode(parts.join("\n")))));
  }

  private async verify(sig: string, ...parts: string[]): Promise<boolean> {
    if (!/^[0-9a-f]{64}$/.test(sig)) return false;
    return crypto.subtle.verify("HMAC", await this.key(), unhex(sig), enc.encode(parts.join("\n")));
  }

  /** A short-lived download or preview link to one of the owner's files, for the owner alone. */
  async link(input: { path: string; download?: boolean }, requester: string): Promise<LinkResult> {
    const file = await this.files.readBytes({ path: input.path }, requester);
    if (!file.ok) return file;
    const expiresAt = this.now() + LINK_TTL_MS;
    const sig = await this.sign("raw", this.owner, file.path, String(expiresAt));
    const url = `/app/file/raw?path=${encodeURIComponent(file.path)}&exp=${expiresAt}&sig=${sig}${input.download ? "&download=1" : ""}`;
    return { ok: true, path: file.path, url, expiresAt };
  }

  /** A signed link presented with the owner's session: the signature, then the expiry, then the file. */
  async linked(input: { path: string; exp: string; sig: string }, requester: string): Promise<ServedResult> {
    if (requester !== this.owner) return { ok: false, code: "FILES_NOT_OWNER", reason: "only the owner opens their files" };
    const path = parseFilePath(input.path);
    const exp = Number(input.exp);
    if (path === null || !/^[0-9]{1,15}$/.test(input.exp) || !(await this.verify(input.sig, "raw", this.owner, path, input.exp))) return refuse("LINK_INVALID", "this link was not made for you, or was changed");
    if (exp <= this.now()) return refuse("LINK_EXPIRED", "this link has expired; open the file from the Library for a new one");
    return this.files.readBytes({ path }, requester);
  }

  /**
   * A short-lived link to one of the owner's attachments (M24.3), with the same key under its own kind, so a
   * file's link never opens an attachment or the other way round. The caller has had the row decided first.
   */
  async attachmentLink(id: string, download: boolean, requester: string): Promise<{ ok: true; url: string; expiresAt: number } | FilesRefusal> {
    if (requester !== this.owner) return { ok: false, code: "FILES_NOT_OWNER", reason: "only the owner opens their attachments" };
    const expiresAt = this.now() + LINK_TTL_MS;
    const sig = await this.sign("attachment", this.owner, id, String(expiresAt));
    return { ok: true, url: `/app/attachments/${encodeURIComponent(id)}?exp=${expiresAt}&sig=${sig}${download ? "&download=1" : ""}`, expiresAt };
  }

  /** An attachment link presented with the owner's session: the signature, then the expiry. */
  async attachmentLinked(input: { id: string; exp: string; sig: string }, requester: string): Promise<{ ok: true } | LinkRefusal | FilesRefusal> {
    if (requester !== this.owner) return { ok: false, code: "FILES_NOT_OWNER", reason: "only the owner opens their attachments" };
    if (!/^[0-9]{1,15}$/.test(input.exp) || !(await this.verify(input.sig, "attachment", this.owner, input.id, input.exp))) return refuse("LINK_INVALID", "this link was not made for you, or was changed");
    if (Number(input.exp) <= this.now()) return refuse("LINK_EXPIRED", "this link has expired; open the attachment again for a new one");
    return { ok: true };
  }

  /** Offboarding's purge (M24.3): every share's pointer in the tenant bucket, the share rows and the key; how many shares went. */
  async purgeAll(): Promise<number> {
    const ids = this.sql.exec<{ id: string }>("SELECT id FROM shares").toArray().map((r) => r.id);
    for (const id of ids) await this.bucket.delete(`${SHARE_POINTER_PREFIX}${id}`);
    this.sql.exec("DELETE FROM shares");
    this.sql.exec("DELETE FROM link_key");
    this.keyPromise = undefined;
    return ids.length;
  }

  /**
   * A public share link to one of the owner's files, bound to its content now. Only `share_document`
   * calls this, and only once the person's fresh approval card has run it (`chat/gate.ts`).
   */
  async share(input: { path: string; minutes?: number }, requester: string): Promise<ShareResult> {
    const file = await this.files.readBytes({ path: input.path }, requester);
    if (!file.ok) return file;
    const minutes = Math.min(SHARE_MAX_MINUTES, Math.max(1, Math.round(Number(input.minutes ?? SHARE_DEFAULT_MINUTES)) || SHARE_DEFAULT_MINUTES));
    const id = hex(crypto.getRandomValues(new Uint8Array(16)));
    const expiresAt = this.now() + minutes * 60_000;
    const sig = await this.sign("share", id, file.path, file.sha256, String(expiresAt));
    // The pointer only routes a public request to this object; the row below and the signature decide.
    const put = await this.bucket.put(`${SHARE_POINTER_PREFIX}${id}`, JSON.stringify({ person: this.owner }), { customMetadata: { expires_at: String(expiresAt) } });
    if (!put) return { ok: false, code: "FILES_UNAVAILABLE", reason: "the store refused the share's record" };
    this.sql.exec("INSERT INTO shares (id, path, sha256, created_at, expires_at) VALUES (?, ?, ?, ?, ?)", id, file.path, file.sha256, this.now(), expiresAt);
    return { ok: true, id, path: file.path, url: `/hooks/share/${id}.${sig}`, expiresAt };
  }

  /** A public request for a share, with no session: the token, the row, the expiry, then the content approved. */
  async shared(token: string): Promise<ServedResult> {
    const m = /^([0-9a-f]{32})\.([0-9a-f]{64})$/.exec(token);
    if (!m) return refuse("SHARE_INVALID", "this is not a share link");
    const row = this.sql.exec<{ path: string; sha256: string; expires_at: number }>("SELECT path, sha256, expires_at FROM shares WHERE id = ?", m[1] as string).toArray()[0];
    if (!row) return refuse("SHARE_UNKNOWN", "no such share");
    if (!(await this.verify(m[2] as string, "share", m[1] as string, row.path, row.sha256, String(row.expires_at)))) return refuse("SHARE_INVALID", "this share link was changed");
    if (row.expires_at <= this.now()) return refuse("SHARE_EXPIRED", "this share link has expired");
    const file = await this.files.readBytes({ path: row.path }, this.owner);
    if (!file.ok) return file;
    if (file.sha256 !== row.sha256) return refuse("SHARE_CHANGED", "the file changed after it was shared; it is not shown");
    return file;
  }
}

/** The `Person`'s one entry for documents and links (M24.3), so its RPC surface grows by one method. */
export type DocumentCall =
  | { op: "save"; path: string; text?: string; base64?: string; mediaType: string }
  | { op: "link"; path: string; download?: boolean }
  | { op: "linked"; path: string; exp: string; sig: string }
  | { op: "share"; path: string; minutes?: number };

export async function documentCall(files: PersonFiles, links: PersonLinks, requester: string, call: DocumentCall) {
  const writer = `agent:${requester}`;
  switch (call?.op) {
    case "save":
      if (typeof call.text === "string") return files.write({ path: call.path, text: call.text }, { requester, writer });
      return files.writeBytes({ path: call.path, bytes: Uint8Array.from(atob(String(call.base64 ?? "")), (c) => c.charCodeAt(0)), mediaType: String(call.mediaType) }, { requester, writer });
    case "link":
      return links.link({ path: call.path, download: call.download === true }, requester);
    case "linked":
      return links.linked({ path: String(call.path ?? ""), exp: String(call.exp ?? ""), sig: String(call.sig ?? "") }, requester);
    case "share":
      return links.share({ path: call.path, ...(call.minutes !== undefined ? { minutes: call.minutes } : {}) }, requester);
    default:
      return { ok: false as const, code: "FILES_PATH_INVALID" as const, reason: "no such document call" };
  }
}

/** Routes a public share token to the person whose object holds it; that object decides everything else. */
export async function routeShare(token: string, bucket: R2Bucket, read: (person: string, token: string) => Promise<ServedResult>): Promise<ServedResult> {
  const id = shareIdOf(token);
  if (!id) return refuse("SHARE_INVALID", "this is not a share link");
  const pointer = await bucket.get(`${SHARE_POINTER_PREFIX}${id}`);
  let person: unknown;
  try {
    person = pointer ? (JSON.parse(await pointer.text()) as { person?: unknown }).person : undefined;
  } catch {
    person = undefined;
  }
  if (typeof person !== "string" || !person) return refuse("SHARE_UNKNOWN", "no such share");
  return read(person, token);
}
