// The Vault's sealed store (AD-12): its SQLite schema, the tenant data key (generated here, wrapped by
// the master key through the host's key service, and imported as non-extractable
// keys whose raw bytes are zeroed), and sealing and opening values under the tenant, owner and
// reference as additional data. `core.ts` builds the credentials, grants and egress on top; nothing
// here returns a value except `open`, which only the core calls after its checks.
import type { KeyService } from "@qyvr/host";
import type { EgressCode } from "../egress/policy.ts";

export interface VaultCtx {
  storage: { sql: { exec(query: string, ...bindings: unknown[]): { toArray(): Record<string, unknown>[]; rowsWritten?: number } }; transactionSync<R>(fn: () => R): R };
}

export interface VaultDeps {
  tenant: string;
  keys: KeyService;
  /** The VAPID contact for push services (`vapidSubject(env.OWNER_EMAIL)`, `vault/vapid.ts`). */
  vapidSubject?: string;
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  now: () => number;
  /** Types a value into the page of a browser session (M9); only `fill` calls it. */
  inject?: (session: string, selector: string, value: string) => Promise<void>;
  /** Whether `person` holds a company grant to `connector` for this purpose; the Company decides (M10.2). Absent, no company reference resolves. */
  entitled?: (person: string, connector: string, purpose: string) => Promise<boolean>;
}

export type Refused = { ok: false; code: string; reason: string };
export type Status = "active" | "revoked" | "expired" | "spent";
export type Row = Record<string, unknown>;
type Keys = { key: CryptoKey; grantKey: CryptoKey };
export type KeyState = { ok: true; keys: Keys } | { ok: false; code: string; reason: string };

const enc = new TextEncoder();
const dec = new TextDecoder();

export abstract class SealedVault {
  protected readonly ctx: VaultCtx;
  protected readonly deps: VaultDeps;
  protected keyState?: Promise<KeyState>;

  constructor(ctx: VaultCtx, deps: VaultDeps) {
    this.ctx = ctx;
    this.deps = deps;
  }


  protected sql(query: string, ...bindings: unknown[]): Row[] {
    return this.ctx.storage.sql.exec(query, ...bindings).toArray();
  }

  protected event(owner: string, ref: string, event: string, by: string, detail = "") {
    this.sql("INSERT INTO vault_events (at, owner, ref, event, by, detail) VALUES (?, ?, ?, ?, ?, ?)", this.deps.now(), owner, ref, event, by, detail);
  }

  // --- keys -------------------------------------------------------------------------------------

  /** The data key, unwrapped once per instance; created and wrapped on the tenant's first use. */
  protected dataKey(): Promise<KeyState> {
    this.keyState ??= this.loadKey().then((s) => {
      if (!s.ok) this.keyState = undefined; // a failed unwrap is retried on the next call, never cached
      return s;
    });
    return this.keyState;
  }

  protected async loadKey(): Promise<KeyState> {
    const stored = this.sql("SELECT blob FROM vault_key WHERE id = 1")[0]?.blob as string | undefined;
    let raw: Uint8Array;
    if (stored) {
      const r = await this.deps.keys.unwrap(stored);
      if (!r.ok) return { ok: false, code: r.code, reason: r.reason };
      raw = new Uint8Array(r.key);
    } else {
      raw = crypto.getRandomValues(new Uint8Array(32));
      const w = await this.deps.keys.wrap(raw);
      if (!w.ok) {
        raw.fill(0);
        return { ok: false, code: w.code, reason: w.reason };
      }
      this.sql("INSERT INTO vault_key (id, blob, created_at) VALUES (1, ?, ?)", w.blob, this.deps.now());
    }
    try {
      const key = await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
      const base = await crypto.subtle.importKey("raw", raw, "HKDF", false, ["deriveKey"]);
      const grantKey = await crypto.subtle.deriveKey(
        { name: "HKDF", hash: "SHA-256", salt: enc.encode(`qyvr-tenant:${this.deps.tenant}`), info: enc.encode("qyvr-cred-grant:v1") },
        base,
        { name: "HMAC", hash: "SHA-256", length: 256 },
        false,
        ["sign", "verify"],
      );
      return { ok: true, keys: { key, grantKey } };
    } finally {
      raw.fill(0);
    }
  }

  protected aad(owner: string, ref: string) {
    return enc.encode(`qyvr-cred:v2:${this.deps.tenant}:${owner}:${ref}`);
  }

  protected async seal(owner: string, ref: string, value: string): Promise<{ ok: true; iv: Uint8Array; ct: Uint8Array } | Refused> {
    const k = await this.dataKey();
    if (!k.ok) return { ok: false, code: "VAULT_LOCKED", reason: `${k.code}: ${k.reason}` };
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: this.aad(owner, ref) }, k.keys.key, enc.encode(value)));
    return { ok: true, iv, ct };
  }

  /** Opens a value with no status or grant check: redaction of what was already typed (`scrub`) and `reveal` after its checks. */
  protected async open(owner: string, ref: string): Promise<{ ok: true; value: string } | { ok: false; code: EgressCode; reason: string }> {
    const row = this.sql("SELECT iv, ct FROM secrets WHERE owner = ? AND ref = ?", owner, ref)[0];
    if (!row) return { ok: false, code: "EGRESS_CRED_UNKNOWN", reason: `${ref} is not in the vault` };
    const k = await this.dataKey();
    if (!k.ok) return { ok: false, code: "EGRESS_VAULT_LOCKED", reason: `${k.code}: ${k.reason}` };
    try {
      const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: row.iv as Uint8Array, additionalData: this.aad(owner, ref) }, k.keys.key, row.ct as Uint8Array);
      return { ok: true, value: dec.decode(pt) };
    } catch {
      return { ok: false, code: "EGRESS_VAULT_LOCKED", reason: `${ref} does not open under this tenant's key` };
    }
  }

  protected status(row: Row): Status {
    if (row.used_at !== null && row.used_at !== undefined) return "spent";
    if (row.revoked_at !== null && row.revoked_at !== undefined) return "revoked";
    if (row.expires_at !== null && row.expires_at !== undefined && Number(row.expires_at) <= this.deps.now()) return "expired";
    return "active";
  }
}
