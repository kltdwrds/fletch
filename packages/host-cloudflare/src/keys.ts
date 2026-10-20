// The secret-backed key service: one master key, held as a Worker secret, wraps each tenant's data
// key with the tenant id as additional authenticated data. Moved from qyvr-co's dispatcher keys.ts;
// the wrap/unwrap logic is unchanged. A blob wrapped for one tenant is refused when presented by
// another, first by its tenant field and, should that field be rewritten, by the AEAD itself.
import type { KeyFailure, KeyFailureCode, KeyService, UnwrapResult, WrapResult } from "@qyvr/host";

export const DATA_KEY_BYTES = 32;
const BLOB_VERSION = "qk1";
const TENANT_ID = /^[a-z][a-z0-9-]{1,30}$/;

const fail = (code: KeyFailureCode, reason: string): KeyFailure => ({ ok: false, code, reason });
const aad = (tenant: string) => new TextEncoder().encode(`qyvr-data-key:v1:${tenant}`);

export function b64u(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromB64u(text: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) return null;
  try {
    const bin = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

/** The master key from its secret: 32 random bytes, base64url, as `pnpm platform up` sets it. */
export async function importMaster(secret: string | undefined): Promise<CryptoKey | null> {
  const raw = secret ? fromB64u(secret.trim()) : null;
  if (raw?.byteLength !== 32) return null;
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function wrapDataKey(master: CryptoKey, tenant: string, raw: Uint8Array): Promise<WrapResult> {
  if (!(raw instanceof Uint8Array) || raw.byteLength !== DATA_KEY_BYTES) return fail("KEY_INVALID", `a data key is ${DATA_KEY_BYTES} bytes`);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: aad(tenant) }, master, raw));
  return { ok: true, blob: [BLOB_VERSION, tenant, b64u(iv), b64u(ct)].join(".") };
}

export async function unwrapDataKey(master: CryptoKey, tenant: string, blob: string): Promise<UnwrapResult> {
  const parts = typeof blob === "string" ? blob.split(".") : [];
  const iv = parts.length === 4 ? fromB64u(parts[2] as string) : null;
  const ct = parts.length === 4 ? fromB64u(parts[3] as string) : null;
  if (parts[0] !== BLOB_VERSION || !iv || iv.byteLength !== 12 || !ct) return fail("KEY_BLOB_MALFORMED", "not a wrapped data key");
  if (parts[1] !== tenant) return fail("KEY_TENANT_MISMATCH", "the blob was wrapped for another tenant");
  try {
    const raw = await crypto.subtle.decrypt({ name: "AES-GCM", iv, additionalData: aad(tenant) }, master, ct);
    return { ok: true, key: new Uint8Array(raw) };
  } catch {
    return fail("KEY_UNWRAP_FAILED", "the blob does not open for this tenant");
  }
}

/** The key service for one caller: the tenant and a master-key source. */
export function keyService(master: () => Promise<CryptoKey | null>, tenant: unknown): KeyService {
  const ready = async (): Promise<{ ok: true; master: CryptoKey; tenant: string } | KeyFailure> => {
    if (typeof tenant !== "string" || !TENANT_ID.test(tenant)) return fail("KEY_NO_TENANT", "the binding's props name no tenant");
    const key = await master();
    return key ? { ok: true, master: key, tenant } : fail("KEY_SERVICE_UNAVAILABLE", "the platform master key is not configured");
  };
  return {
    async wrap(raw) {
      const r = await ready();
      return r.ok ? wrapDataKey(r.master, r.tenant, raw) : r;
    },
    async unwrap(blob) {
      const r = await ready();
      return r.ok ? unwrapDataKey(r.master, r.tenant, blob) : r;
    },
  };
}

// The imported master, memoised per master-secret string for the life of the isolate.
const masters = new Map<string, Promise<CryptoKey | null>>();

function memoisedMaster(secret: string | undefined): Promise<CryptoKey | null> {
  if (!secret) return Promise.resolve(null);
  let imported = masters.get(secret);
  if (!imported) {
    imported = importMaster(secret);
    masters.set(secret, imported);
  }
  return imported;
}

/** The KeyService for one account: the master from its Worker secret, bound to `tenant`. */
export function secretKeyService(masterSecret: string | undefined, tenant: string): KeyService {
  return keyService(() => memoisedMaster(masterSecret), tenant);
}
