// The tenant's VAPID key pair (RFC 8292, M14.1), held by the `Vault`: created on first use, its private
// half sealed with AES-GCM under the tenant data key (its own AAD, so it opens as nothing else), and
// used only to sign a push authorization for an endpoint at a known push service. The public key is
// what a browser subscribes with; nothing returns the private key.
import { b64u, checkEndpoint, vapidClaims } from "../delivery/webpush.ts";

type DataKey = { ok: true; key: CryptoKey } | { ok: false; code: string; reason: string };
export type VapidRefusal = { ok: false; code: "VAULT_LOCKED" | "PUSH_ENDPOINT_POLICY"; reason: string };

export interface VapidDeps {
  sql: (query: string, ...bindings: unknown[]) => Array<Record<string, unknown>>;
  dataKey: () => Promise<DataKey>;
  tenant: string;
  now: () => number;
  /** The JWT's `sub` (`vapidSubject(OWNER_EMAIL)`): the deploy owner's `mailto:`; absent, the claim is left out. */
  subject?: string;
}

const enc = new TextEncoder();

export class VapidKeys {
  private readonly deps: VapidDeps;
  private signer?: Promise<{ ok: true; key: CryptoKey; publicKey: string } | VapidRefusal>;

  constructor(deps: VapidDeps) {
    this.deps = deps;
  }

  private aad() {
    return enc.encode(`qyvr-vapid:v1:${this.deps.tenant}`);
  }

  private load() {
    this.signer ??= this.open().then((s) => {
      if (!s.ok) this.signer = undefined;
      return s;
    });
    return this.signer;
  }

  private async open(): Promise<{ ok: true; key: CryptoKey; publicKey: string } | VapidRefusal> {
    const k = await this.deps.dataKey();
    if (!k.ok) return { ok: false, code: "VAULT_LOCKED", reason: `${k.code}: ${k.reason}` };
    const row = this.deps.sql("SELECT public, iv, ct FROM vapid_key WHERE id = 1")[0];
    let pkcs8: Uint8Array;
    let publicKey: string;
    if (row) {
      try {
        pkcs8 = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: row.iv as Uint8Array, additionalData: this.aad() }, k.key, row.ct as Uint8Array));
      } catch {
        return { ok: false, code: "VAULT_LOCKED", reason: "the VAPID key does not open under this tenant's key" };
      }
      publicKey = String(row.public);
    } else {
      const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
      pkcs8 = new Uint8Array((await crypto.subtle.exportKey("pkcs8", pair.privateKey)) as ArrayBuffer);
      publicKey = b64u(new Uint8Array((await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer));
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: this.aad() }, k.key, pkcs8));
      this.deps.sql("INSERT INTO vapid_key (id, public, iv, ct, created_at) VALUES (1, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING", publicKey, iv, ct, this.deps.now());
    }
    try {
      const key = await crypto.subtle.importKey("pkcs8", pkcs8, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
      return { ok: true, key, publicKey };
    } finally {
      pkcs8.fill(0);
    }
  }

  /** The application server key a browser subscribes with (65-byte point, base64url). */
  async publicKey(): Promise<{ ok: true; key: string } | VapidRefusal> {
    const s = await this.load();
    return s.ok ? { ok: true, key: s.publicKey } : s;
  }

  /** `Authorization: vapid t=<jwt>, k=<key>` for one endpoint; refused for anything but a push service. */
  async authorization(endpoint: string): Promise<{ ok: true; header: string } | VapidRefusal> {
    const e = checkEndpoint(endpoint);
    if (!e.ok) return e;
    const s = await this.load();
    if (!s.ok) return s;
    const { header, claims } = vapidClaims(e.url, this.deps.now(), this.deps.subject);
    const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, s.key, enc.encode(`${header}.${claims}`)));
    return { ok: true, header: `vapid t=${header}.${claims}.${b64u(sig)}, k=${s.publicKey}` };
  }
}
