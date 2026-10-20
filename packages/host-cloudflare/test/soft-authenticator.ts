// A software passkey for the real-ceremony test: a P-256 key from WebCrypto, a "none" attestation and
// assertions built by hand (CBOR, authenticator data, client data), the bytes a browser would send.
import { b64u } from "../src/keys.ts";

type Cbor = number | string | Uint8Array | Map<Cbor, Cbor>;

function head(major: number, n: number): number[] {
  if (n < 24) return [(major << 5) | n];
  if (n < 256) return [(major << 5) | 24, n];
  if (n < 65536) return [(major << 5) | 25, n >> 8, n & 255];
  return [(major << 5) | 26, (n >>> 24) & 255, (n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function cbor(value: Cbor): Uint8Array {
  if (typeof value === "number") return new Uint8Array(value >= 0 ? head(0, value) : head(1, -1 - value));
  if (typeof value === "string") {
    const bytes = new TextEncoder().encode(value);
    return concat(new Uint8Array(head(3, bytes.length)), bytes);
  }
  if (value instanceof Uint8Array) return concat(new Uint8Array(head(2, value.length)), value);
  const parts: Uint8Array[] = [new Uint8Array(head(5, value.size))];
  for (const [k, v] of value) parts.push(cbor(k), cbor(v));
  return concat(...parts);
}

export function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

const sha256 = async (bytes: Uint8Array) => new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes)));
const u32 = (n: number) => new Uint8Array([(n >>> 24) & 255, (n >> 16) & 255, (n >> 8) & 255, n & 255]);

/** WebCrypto signs ECDSA as r || s; WebAuthn carries it as an ASN.1 DER sequence of two integers. */
function der(raw: Uint8Array): Uint8Array {
  const int = (b: Uint8Array) => {
    let i = 0;
    while (i < b.length - 1 && b[i] === 0) i++;
    const v = b.subarray(i);
    const body = (v[0] as number) & 0x80 ? concat(new Uint8Array([0]), v) : v;
    return concat(new Uint8Array([2, body.length]), body);
  };
  const seq = concat(int(raw.subarray(0, 32)), int(raw.subarray(32)));
  return concat(new Uint8Array([0x30, seq.length]), seq);
}

const UP = 0x01;
const UV = 0x04;
const AT = 0x40;

export async function softAuthenticator(origin: string, rpId: string) {
  const keys = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const raw = new Uint8Array((await crypto.subtle.exportKey("raw", keys.publicKey)) as ArrayBuffer);
  const credId = crypto.getRandomValues(new Uint8Array(16));
  const id = b64u(credId);
  let counter = 0;
  const clientData = (type: string, challenge: string) => new TextEncoder().encode(JSON.stringify({ type, challenge, origin, crossOrigin: false }));

  return {
    id,
    get counter() {
      return counter;
    },
    async create(options: { challenge: string }) {
      const coseKey = cbor(new Map<Cbor, Cbor>([[1, 2], [3, -7], [-1, 1], [-2, raw.slice(1, 33)], [-3, raw.slice(33)]]));
      const authData = concat(await sha256(new TextEncoder().encode(rpId)), new Uint8Array([UP | UV | AT]), u32(counter), new Uint8Array(16), new Uint8Array([0, credId.length]), credId, coseKey);
      const attestationObject = cbor(new Map<Cbor, Cbor>([["fmt", "none"], ["attStmt", new Map()], ["authData", authData]]));
      return {
        id,
        rawId: id,
        type: "public-key",
        clientExtensionResults: {},
        response: { clientDataJSON: b64u(clientData("webauthn.create", options.challenge)), attestationObject: b64u(attestationObject), transports: ["internal"] },
      };
    },
    async get(options: { challenge: string }) {
      counter++;
      const authData = concat(await sha256(new TextEncoder().encode(rpId)), new Uint8Array([UP | UV]), u32(counter));
      const cd = clientData("webauthn.get", options.challenge);
      const signed = concat(authData, await sha256(cd));
      const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, keys.privateKey, new Uint8Array(signed)));
      return {
        id,
        rawId: id,
        type: "public-key",
        clientExtensionResults: {},
        response: { clientDataJSON: b64u(cd), authenticatorData: b64u(authData), signature: b64u(der(sig)) },
      };
    },
  };
}
