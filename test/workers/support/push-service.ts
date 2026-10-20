// A fake push service and browser for M14.1, written from RFC 8291 and RFC 8292 rather than from the
// code under test: a browser subscription is a fresh ECDH key pair and auth secret; the service checks
// the VAPID authorization (ES256 over the JWT with the key in `k`, the endpoint's origin as `aud`, an
// expiry within 24 hours) and then the browser decrypts the aes128gcm body with its private key. A
// message is "delivered" only if both hold.
import { b64u, deriveRecordKeys, fromB64u } from "../../../packages/agent/src/delivery/webpush.ts";

export interface Browser {
  subscription: { endpoint: string; keys: { p256dh: string; auth: string } };
  privateKey: CryptoKey;
  publicRaw: Uint8Array;
  auth: Uint8Array;
}

/** A browser subscribed at `endpoint` (a URL at a known push service). */
export async function subscribeBrowser(endpoint: string): Promise<Browser> {
  const pair = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair;
  const publicRaw = new Uint8Array((await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer);
  const auth = crypto.getRandomValues(new Uint8Array(16));
  return { subscription: { endpoint, keys: { p256dh: b64u(publicRaw), auth: b64u(auth) } }, privateKey: pair.privateKey, publicRaw, auth };
}

/** RFC 8291 decryption of one aes128gcm record, as the browser does it. */
export async function decrypt(browser: Browser, body: Uint8Array): Promise<string> {
  const salt = body.slice(0, 16);
  const idlen = body[20] as number;
  const asPublic = body.slice(21, 21 + idlen);
  const record = body.slice(21 + idlen);
  const as = await crypto.subtle.importKey("raw", asPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: as } as never, browser.privateKey, 256));
  const { cek, nonce } = await deriveRecordKeys(ecdh, browser.auth, browser.publicRaw, asPublic, salt);
  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["decrypt"]);
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, key, record));
  let end = plain.length - 1;
  while (end >= 0 && plain[end] === 0) end--;
  if (plain[end] !== 2) throw new Error("PUSH_PADDING: last record delimiter missing");
  return new TextDecoder().decode(plain.slice(0, end));
}

/** Verifies `vapid t=<jwt>, k=<key>` for an endpoint at a moment; returns the reason it fails, or null. */
export async function checkVapid(header: string, endpoint: string, nowMs: number): Promise<string | null> {
  const m = /^vapid t=([^,\s]+),\s*k=([A-Za-z0-9_-]+)$/.exec(header);
  if (!m) return "not a vapid authorization";
  const [h, c, s] = (m[1] as string).split(".");
  const key = fromB64u(m[2] as string);
  const sig = fromB64u(s ?? "");
  if (!h || !c || !key || !sig) return "malformed";
  const pub = await crypto.subtle.importKey("raw", key, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  if (!(await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, pub, sig, new TextEncoder().encode(`${h}.${c}`)))) return "bad signature";
  const header_ = JSON.parse(new TextDecoder().decode(fromB64u(h) as Uint8Array));
  const claims = JSON.parse(new TextDecoder().decode(fromB64u(c) as Uint8Array));
  if (header_.alg !== "ES256") return "alg";
  if (claims.aud !== new URL(endpoint).origin) return "aud";
  if (!(claims.exp * 1000 > nowMs && claims.exp * 1000 <= nowMs + 86_400_000)) return "exp";
  return null;
}

export interface Received {
  endpoint: string;
  headers: Record<string, string>;
  status: number;
  payload: Record<string, unknown> | null;
  why: string | null;
}

/** The push service: answers each POST, keeps what it received, decrypting for the subscribed browser. */
export function fakePushService(clock: { now: number }) {
  const browsers = new Map<string, Browser>();
  const received: Received[] = [];
  /** Endpoints answered with a fixed status, e.g. 410 for an expired subscription. */
  const statuses = new Map<string, number>();
  const post = async (endpoint: string, init: { headers: Record<string, string>; body: Uint8Array }) => {
    const browser = browsers.get(endpoint);
    const forced = statuses.get(endpoint);
    let why = forced ? `forced ${forced}` : browser ? await checkVapid(init.headers.authorization ?? "", endpoint, clock.now) : "unknown endpoint";
    let payload: Record<string, unknown> | null = null;
    if (!why && browser) {
      try {
        payload = JSON.parse(await decrypt(browser, init.body));
      } catch (e) {
        why = `decrypt: ${String(e)}`;
      }
    }
    const status = forced ?? (why ? 400 : 201);
    received.push({ endpoint, headers: init.headers, status, payload, why });
    return { status };
  };
  return {
    received,
    statuses,
    post,
    /** A browser of the person's subscribed at a fresh endpoint of the given push service. */
    async browser(host = "fcm.googleapis.com"): Promise<Browser> {
      const b = await subscribeBrowser(`https://${host}/fcm/send/${crypto.randomUUID()}`);
      browsers.set(b.subscription.endpoint, b);
      return b;
    },
    delivered: () => received.filter((r) => r.status >= 200 && r.status < 300),
  };
}
