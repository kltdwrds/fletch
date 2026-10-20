// Webhook signatures (M6.1, AD-4), borrowed from the Standard Webhooks specification
// (standardwebhooks.com) rather than invented: the sender signs `<id>.<timestamp>.<body>` with
// HMAC-SHA256 under the source's secret and sends `webhook-id`, `webhook-timestamp` (seconds) and
// `webhook-signature` (space-separated `v1,<base64>` entries). Replay protection is the timestamp's
// tolerance here plus the event id's dedupe in the `Ingress`. Pure, so it unit-tests in Node.

export const SECRET_PREFIX = "whsec_";
/** A signed timestamp further than this from the receiver's clock is refused. */
export const TOLERANCE_S = 5 * 60;

export type SignatureCode = "HOOK_HEADERS_MISSING" | "HOOK_TIMESTAMP_INVALID" | "HOOK_TIMESTAMP_STALE" | "HOOK_SIGNATURE_INVALID" | "HOOK_SECRET_INVALID";
export type SignatureVerdict = { ok: true; id: string } | { ok: false; code: SignatureCode; reason: string };

const EVENT_ID = /^[A-Za-z0-9._:-]{1,128}$/;

function b64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function unb64(text: string): Uint8Array | null {
  try {
    return Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

/** A new source secret: 32 random bytes, `whsec_`-prefixed base64, shown to the owner once. */
export function newSecret(): string {
  return `${SECRET_PREFIX}${b64(crypto.getRandomValues(new Uint8Array(32)))}`;
}

async function hmac(secret: string, content: string): Promise<Uint8Array | null> {
  const raw = secret.startsWith(SECRET_PREFIX) ? unb64(secret.slice(SECRET_PREFIX.length)) : null;
  if (!raw || raw.byteLength < 16) return null;
  const key = await crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(content)));
}

/** The headers a sender attaches; the tests and the docs' example sender use it. */
export async function signWebhook(secret: string, id: string, timestampS: number, body: string): Promise<Record<string, string>> {
  const mac = await hmac(secret, `${id}.${timestampS}.${body}`);
  if (!mac) throw new Error("HOOK_SECRET_INVALID");
  return { "webhook-id": id, "webhook-timestamp": String(timestampS), "webhook-signature": `v1,${b64(mac)}` };
}

function equal(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  let diff = 0;
  for (let i = 0; i < a.byteLength; i++) diff |= (a[i] as number) ^ (b[i] as number);
  return diff === 0;
}

/** Verifies a delivery against the source's secret at `nowMs`; every refusal carries a code. */
export async function verifyWebhook(secret: string, headers: Record<string, string | undefined>, body: string, nowMs: number): Promise<SignatureVerdict> {
  const id = headers["webhook-id"];
  const ts = headers["webhook-timestamp"];
  const sig = headers["webhook-signature"];
  if (!id || !ts || !sig) return { ok: false, code: "HOOK_HEADERS_MISSING", reason: "webhook-id, webhook-timestamp and webhook-signature are required" };
  if (!EVENT_ID.test(id)) return { ok: false, code: "HOOK_HEADERS_MISSING", reason: "webhook-id is 1 to 128 of letters, digits and ._:-" };
  if (!/^\d{1,12}$/.test(ts)) return { ok: false, code: "HOOK_TIMESTAMP_INVALID", reason: "webhook-timestamp is whole seconds" };
  if (Math.abs(nowMs / 1000 - Number(ts)) > TOLERANCE_S) return { ok: false, code: "HOOK_TIMESTAMP_STALE", reason: `the signed time is more than ${TOLERANCE_S} s from now` };
  const expected = await hmac(secret, `${id}.${ts}.${body}`);
  if (!expected) return { ok: false, code: "HOOK_SECRET_INVALID", reason: "the source's secret is unusable" };
  for (const entry of sig.split(" ")) {
    const [version, value] = entry.split(",", 2);
    const given = version === "v1" && value ? unb64(value) : null;
    if (given && equal(given, expected)) return { ok: true, id };
  }
  return { ok: false, code: "HOOK_SIGNATURE_INVALID", reason: "no v1 signature matches the body" };
}
