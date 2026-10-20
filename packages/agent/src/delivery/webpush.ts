// Web Push (AD-13, M14.1): the pure half. A subscription is checked before it is stored (the endpoint
// only at a known push service, so a crafted subscription cannot aim the person's object at an
// arbitrary host; the keys of the right shape); a payload is encrypted per RFC 8291 (aes128gcm, one
// record) to the subscription's keys; the VAPID authorization (RFC 8292) is an ES256 JWT whose key the
// `Vault` holds (`vault/vapid.ts`), never this module's caller.

/** Push services browsers subscribe through; a subdomain of the suffixes below is one too. */
export const PUSH_SERVICE_HOSTS = ["fcm.googleapis.com", "updates.push.services.mozilla.com", "web.push.apple.com"];
export const PUSH_SERVICE_SUFFIXES = [".notify.windows.com", ".push.apple.com"];

export interface PushSubscription {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export type PushCode = "PUSH_ENDPOINT_POLICY" | "PUSH_SUBSCRIPTION_INVALID";
export type SubscriptionCheck = { ok: true; sub: PushSubscription } | { ok: false; code: PushCode; reason: string };

const enc = new TextEncoder();

export function b64u(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromB64u(text: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) return null;
  try {
    const bin = atob(text.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (text.length % 4)) % 4));
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

/** An endpoint at a known push service over https on the default port, with no credentials in it. */
export function checkEndpoint(endpoint: unknown): { ok: true; url: URL } | { ok: false; code: "PUSH_ENDPOINT_POLICY"; reason: string } {
  let url: URL;
  try {
    url = new URL(String(endpoint ?? ""));
  } catch {
    return { ok: false, code: "PUSH_ENDPOINT_POLICY", reason: "the endpoint is not a URL" };
  }
  if (url.protocol !== "https:" || url.port !== "" || url.username || url.password) return { ok: false, code: "PUSH_ENDPOINT_POLICY", reason: "a push endpoint is https on the default port with no credentials" };
  const host = url.hostname.toLowerCase();
  if (!PUSH_SERVICE_HOSTS.includes(host) && !PUSH_SERVICE_SUFFIXES.some((s) => host.endsWith(s))) return { ok: false, code: "PUSH_ENDPOINT_POLICY", reason: `${host} is not a known push service` };
  return { ok: true, url };
}

/** A browser's `PushSubscription.toJSON()`: the endpoint and its two keys, checked. */
export function checkSubscription(input: unknown): SubscriptionCheck {
  const o = (input ?? {}) as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
  const e = checkEndpoint(o.endpoint);
  if (!e.ok) return e;
  const p256dh = typeof o.keys?.p256dh === "string" ? fromB64u(o.keys.p256dh) : null;
  const auth = typeof o.keys?.auth === "string" ? fromB64u(o.keys.auth) : null;
  if (p256dh?.length !== 65 || p256dh[0] !== 4) return { ok: false, code: "PUSH_SUBSCRIPTION_INVALID", reason: "keys.p256dh is not an uncompressed P-256 point" };
  if (auth?.length !== 16) return { ok: false, code: "PUSH_SUBSCRIPTION_INVALID", reason: "keys.auth is not 16 bytes" };
  return { ok: true, sub: { endpoint: e.url.toString(), p256dh: b64u(p256dh), auth: b64u(auth) } };
}

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, bytes: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, bytes * 8));
}

const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};

/** The content key and nonce both sides derive (RFC 8291 section 3.4). */
export async function deriveRecordKeys(ecdh: Uint8Array, auth: Uint8Array, uaPublic: Uint8Array, asPublic: Uint8Array, salt: Uint8Array) {
  const ikm = await hkdf(auth, ecdh, concat(enc.encode("WebPush: info\0"), uaPublic, asPublic), 32);
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);
  return { cek, nonce };
}

export const RECORD_SIZE = 4096;
/** A payload must fit one record with its delimiter and tag. */
export const PAYLOAD_MAX = RECORD_SIZE - 17 - 86;

/** The aes128gcm body for one subscription: header (salt, record size, sender key) and one record. */
export async function encryptPayload(sub: PushSubscription, payload: Uint8Array): Promise<{ ok: true; body: Uint8Array } | { ok: false; code: "PUSH_PAYLOAD_TOO_LARGE" | "PUSH_SUBSCRIPTION_INVALID"; reason: string }> {
  if (payload.length > PAYLOAD_MAX) return { ok: false, code: "PUSH_PAYLOAD_TOO_LARGE", reason: `a push payload is at most ${PAYLOAD_MAX} bytes` };
  const uaPublic = fromB64u(sub.p256dh);
  const auth = fromB64u(sub.auth);
  if (!uaPublic || !auth) return { ok: false, code: "PUSH_SUBSCRIPTION_INVALID", reason: "the stored subscription keys do not decode" };
  const local = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair;
  const asPublic = new Uint8Array((await crypto.subtle.exportKey("raw", local.publicKey)) as ArrayBuffer);
  const ua = await crypto.subtle.importKey("raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  // WebCrypto's member is `public`; the generated Workers types spell it `$public`, so the literal is cast.
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: ua } as never, local.privateKey, 256));
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const { cek, nonce } = await deriveRecordKeys(ecdh, auth, uaPublic, asPublic, salt);
  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const record = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, concat(payload, Uint8Array.of(2))));
  const header = new Uint8Array(21 + asPublic.length);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, RECORD_SIZE);
  header[20] = asPublic.length;
  header.set(asPublic, 21);
  return { ok: true, body: concat(header, record) };
}

/**
 * The VAPID `sub` (RFC 8292 section 2.1): a contact for the push service, here the deploy's owner as a `mailto:`
 * URI. With no owner address the claim is left out (the RFC's SHOULD), never filled with someone else's contact.
 */
export function vapidSubject(ownerEmail: string | undefined): string | undefined {
  const email = ownerEmail?.trim();
  return email && /^[^\s@]+@[^\s@]+$/.test(email) ? `mailto:${email}` : undefined;
}

/** The VAPID JWT's signing input for an endpoint's origin; the `Vault` signs it with ES256. */
export function vapidClaims(endpoint: URL, now: number, subject?: string): { header: string; claims: string } {
  const header = b64u(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  // At most 24 hours (RFC 8292 section 2); 12 hours leaves room for clock skew at the push service.
  const claims = b64u(enc.encode(JSON.stringify({ aud: endpoint.origin, exp: Math.floor(now / 1000) + 12 * 3600, ...(subject ? { sub: subject } : {}) })));
  return { header, claims };
}
