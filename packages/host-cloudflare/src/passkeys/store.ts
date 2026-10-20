// Passkey, session and recovery storage over a Durable Object's SQLite (F1). Synchronous throughout: hashing is
// `@noble/hashes` because `crypto.subtle.digest` is async. Tokens and recovery codes
// are stored only as SHA-256 hashes; addresses are stored normalised.
import { sha256 as noble } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { normalizeEmail } from "../email.ts";
import { b64u } from "../keys.ts";

export type Sql = Pick<DurableObjectStorage, "sql" | "transactionSync">;

export const PASSKEY_SCHEMA = `
CREATE TABLE IF NOT EXISTS passkeys(id TEXT PRIMARY KEY, email TEXT NOT NULL, public_key BLOB NOT NULL, counter INTEGER NOT NULL, transports TEXT NOT NULL, at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY, email TEXT NOT NULL, at INTEGER NOT NULL, expires_at INTEGER NOT NULL, needs_passkey INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS recovery(email TEXT PRIMARY KEY, code_hash TEXT NOT NULL, spent_at INTEGER);
CREATE TABLE IF NOT EXISTS challenges(id TEXT PRIMARY KEY, challenge TEXT NOT NULL, kind TEXT NOT NULL, at INTEGER NOT NULL)
`;

export const CHALLENGE_TTL_MS = 300_000;
export const SESSION_TTL_MS = 30 * 24 * 3600 * 1000;

const sha256 = (text: string): string => bytesToHex(noble(new TextEncoder().encode(text)));
const randomBytes = (n: number): Uint8Array => crypto.getRandomValues(new Uint8Array(n));

/** Creates the tables once per storage; the stores call it from their constructors. */
const ready = new WeakSet<object>();
export function ensureSchema(storage: Sql): void {
  if (ready.has(storage)) return;
  storage.sql.exec(PASSKEY_SCHEMA);
  ready.add(storage);
}

function bytesOf(value: unknown): Uint8Array {
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (value instanceof Uint8Array) return new Uint8Array(value);
  throw new Error("PASSKEY_STORE_CORRUPT: public key is not a blob");
}

export type PasskeyKind = "register" | "authenticate";

export class PasskeyStore {
  private readonly storage: Sql;
  private readonly now: () => number;

  constructor(storage: Sql, now: () => number) {
    this.storage = storage;
    this.now = now;
    ensureSchema(storage);
  }

  count(): number {
    return Number(this.storage.sql.exec("SELECT COUNT(*) AS n FROM passkeys").one().n);
  }

  add(c: { id: string; email: string; publicKey: Uint8Array; counter: number; transports: string[] }): void {
    this.storage.sql.exec(
      "INSERT INTO passkeys(id, email, public_key, counter, transports, at) VALUES(?, ?, ?, ?, ?, ?)",
      c.id,
      normalizeEmail(c.email),
      c.publicKey,
      c.counter,
      JSON.stringify(c.transports),
      this.now(),
    );
  }

  byId(id: string): { id: string; email: string; publicKey: Uint8Array; counter: number } | null {
    const row = this.storage.sql.exec("SELECT id, email, public_key, counter FROM passkeys WHERE id = ?", id).toArray()[0];
    if (!row) return null;
    return { id: String(row.id), email: String(row.email), publicKey: bytesOf(row.public_key), counter: Number(row.counter) };
  }

  bump(id: string, counter: number): void {
    this.storage.sql.exec("UPDATE passkeys SET counter = ? WHERE id = ?", counter, id);
  }

  /** The registered passkeys without their public keys. */
  list(): { id: string; email: string; at: number }[] {
    return this.storage.sql
      .exec("SELECT id, email, at FROM passkeys ORDER BY at, id")
      .toArray()
      .map((r) => ({ id: String(r.id), email: String(r.email), at: Number(r.at) }));
  }

  remove(id: string): void {
    this.storage.sql.exec("DELETE FROM passkeys WHERE id = ?", id);
  }

  putChallenge(id: string, challenge: string, kind: PasskeyKind): void {
    this.storage.sql.exec("INSERT OR REPLACE INTO challenges(id, challenge, kind, at) VALUES(?, ?, ?, ?)", id, challenge, kind, this.now());
  }

  /** Single use: the row is deleted whether or not it is still fresh. */
  takeChallenge(id: string, kind: PasskeyKind): string | null {
    return this.storage.transactionSync(() => {
      const row = this.storage.sql.exec("SELECT challenge, kind, at FROM challenges WHERE id = ?", id).toArray()[0];
      if (!row || row.kind !== kind) return null;
      this.storage.sql.exec("DELETE FROM challenges WHERE id = ?", id);
      return this.now() - Number(row.at) > CHALLENGE_TTL_MS ? null : String(row.challenge);
    });
  }
}

export class SessionStore {
  readonly SESSION_TTL_MS = SESSION_TTL_MS;

  private readonly storage: Sql;
  private readonly now: () => number;

  constructor(storage: Sql, now: () => number) {
    this.storage = storage;
    this.now = now;
    ensureSchema(storage);
  }

  /** Returns the raw token (32 random bytes, base64url); only its SHA-256 is stored. */
  mint(email: string, needsPasskey: boolean): string {
    const token = b64u(randomBytes(32));
    const at = this.now();
    this.storage.sql.exec(
      "INSERT INTO sessions(token_hash, email, at, expires_at, needs_passkey) VALUES(?, ?, ?, ?, ?)",
      sha256(token),
      normalizeEmail(email),
      at,
      at + SESSION_TTL_MS,
      needsPasskey ? 1 : 0,
    );
    return token;
  }

  lookup(token: string): { email: string; needsPasskey: boolean } | "unknown" | "expired" {
    const row = this.storage.sql.exec("SELECT email, expires_at, needs_passkey FROM sessions WHERE token_hash = ?", sha256(token)).toArray()[0];
    if (!row) return "unknown";
    if (this.now() > Number(row.expires_at)) return "expired";
    return { email: String(row.email), needsPasskey: Number(row.needs_passkey) === 1 };
  }

  revoke(token: string): void {
    this.storage.sql.exec("DELETE FROM sessions WHERE token_hash = ?", sha256(token));
  }
}

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** Upper-case, no separators, and Crockford's look-alikes folded (I, L to 1; O to 0). */
const canonicalCode = (code: string): string =>
  code.toUpperCase().replace(/[\s-]/g, "").replace(/[IL]/g, "1").replace(/O/g, "0");

export class RecoveryStore {
  private readonly storage: Sql;
  private readonly now: () => number;

  constructor(storage: Sql, now: () => number) {
    this.storage = storage;
    this.now = now;
    ensureSchema(storage);
  }

  /** A fresh code, 20 base32-Crockford characters in 4 groups; replaces any earlier code for the address. */
  issue(email: string): string {
    const chars = Array.from(randomBytes(20), (b) => CROCKFORD[b & 31] as string).join("");
    const code = chars.match(/.{5}/g)?.join("-") ?? chars;
    this.storage.sql.exec("INSERT OR REPLACE INTO recovery(email, code_hash, spent_at) VALUES(?, ?, NULL)", normalizeEmail(email), sha256(canonicalCode(code)));
    return code;
  }

  redeem(email: string, code: string): { ok: true } | { ok: false; code: "RECOVERY_CODE_INVALID" | "RECOVERY_CODE_SPENT" } {
    return this.storage.transactionSync(() => {
      const key = normalizeEmail(email);
      const row = this.storage.sql.exec("SELECT code_hash, spent_at FROM recovery WHERE email = ?", key).toArray()[0];
      if (!row || row.code_hash !== sha256(canonicalCode(code))) return { ok: false, code: "RECOVERY_CODE_INVALID" } as const;
      if (row.spent_at !== null) return { ok: false, code: "RECOVERY_CODE_SPENT" } as const;
      this.storage.sql.exec("UPDATE recovery SET spent_at = ? WHERE email = ?", this.now(), key);
      return { ok: true } as const;
    });
  }
}
