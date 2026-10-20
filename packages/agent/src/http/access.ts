// Verifies the tenant's Cloudflare Access application token (AD-18), as Access's docs require of an
// origin: the `Cf-Access-Jwt-Assertion` header, RS256 against the team's published keys matched by
// `kid`, the team domain as issuer, this tenant's application audience, and the token's time window.
// The authenticated-user email header Access also sends is never read: only a verified token's
// claim names anyone. Pure apart from the injected key source, so every refusal is tested.

export const ACCESS_JWT_HEADER = "cf-access-jwt-assertion";

export interface AccessClaims {
  iss: string;
  aud: string[];
  exp: number;
  nbf?: number;
  iat?: number;
  sub?: string;
  /** Present on identity tokens; absent on service-token tokens. */
  email?: string;
  /** A service token's client id; set only on service-token tokens. */
  common_name?: string;
  type?: string;
}

export type AccessRefusal =
  | "ACCESS_TOKEN_MISSING"
  | "ACCESS_TOKEN_MALFORMED"
  | "ACCESS_ALG_REFUSED"
  | "ACCESS_KEY_UNKNOWN"
  | "ACCESS_SIGNATURE_INVALID"
  | "ACCESS_ISSUER_MISMATCH"
  | "ACCESS_AUDIENCE_MISMATCH"
  | "ACCESS_TOKEN_EXPIRED"
  | "ACCESS_TOKEN_NOT_YET_VALID"
  | "ACCESS_KEYS_UNAVAILABLE"
  | "ACCESS_NOT_CONFIGURED";

export type AccessVerdict = { ok: true; claims: AccessClaims } | { ok: false; code: AccessRefusal; reason: string };

/** Looks a signing key up by `kid`; null when the team publishes no such key. Throws when the keys cannot be read. */
export type KeySource = (kid: string) => Promise<CryptoKey | null>;

export interface AccessConfig {
  issuer: string;
  audience: string;
}

/** Tolerance for clock skew between Access and this isolate. */
export const CLOCK_SKEW_S = 30;

const dec = new TextDecoder();
const enc = new TextEncoder();

function b64url(text: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) throw new Error("not base64url");
  const pad = text.length % 4 === 2 ? "==" : text.length % 4 === 3 ? "=" : "";
  return Uint8Array.from(atob(text.replace(/-/g, "+").replace(/_/g, "/") + pad), (c) => c.charCodeAt(0));
}

const refuse = (code: AccessRefusal, reason: string): AccessVerdict => ({ ok: false, code, reason });

export async function verifyAccessJwt(token: string | null, config: AccessConfig, keys: KeySource, nowMs: number): Promise<AccessVerdict> {
  if (!config.issuer || !config.audience) return refuse("ACCESS_NOT_CONFIGURED", "the tenant has no Access issuer or audience");
  if (!token) return refuse("ACCESS_TOKEN_MISSING", `no ${ACCESS_JWT_HEADER} header`);
  const parts = token.split(".");
  if (parts.length !== 3) return refuse("ACCESS_TOKEN_MALFORMED", "a JWT has three parts");
  const [h, p, s] = parts as [string, string, string];
  let header: Record<string, unknown>;
  let claims: Record<string, unknown>;
  let signature: Uint8Array;
  try {
    header = JSON.parse(dec.decode(b64url(h)));
    claims = JSON.parse(dec.decode(b64url(p)));
    signature = b64url(s);
  } catch {
    return refuse("ACCESS_TOKEN_MALFORMED", "a part is not base64url JSON");
  }
  if (!header || typeof header !== "object" || !claims || typeof claims !== "object") return refuse("ACCESS_TOKEN_MALFORMED", "header or payload is not an object");
  // Access signs with RS256 only; `none`, HMAC and every other algorithm are refused before any key is read.
  if (header.alg !== "RS256") return refuse("ACCESS_ALG_REFUSED", `alg ${String(header.alg)} is not RS256`);
  if (typeof header.kid !== "string" || !header.kid) return refuse("ACCESS_TOKEN_MALFORMED", "no kid");

  let key: CryptoKey | null;
  try {
    key = await keys(header.kid);
  } catch (error) {
    return refuse("ACCESS_KEYS_UNAVAILABLE", (error as Error).message);
  }
  if (!key) return refuse("ACCESS_KEY_UNKNOWN", "the team publishes no key with this kid");
  const valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, signature, enc.encode(`${h}.${p}`));
  if (!valid) return refuse("ACCESS_SIGNATURE_INVALID", "signature does not verify");

  if (claims.iss !== config.issuer) return refuse("ACCESS_ISSUER_MISMATCH", "iss is not the team domain");
  const aud = typeof claims.aud === "string" ? [claims.aud] : Array.isArray(claims.aud) ? claims.aud.filter((a): a is string => typeof a === "string") : [];
  if (!aud.includes(config.audience)) return refuse("ACCESS_AUDIENCE_MISMATCH", "aud does not name this tenant's application");
  const now = Math.floor(nowMs / 1000);
  if (typeof claims.exp !== "number") return refuse("ACCESS_TOKEN_MALFORMED", "no exp");
  if (claims.exp + CLOCK_SKEW_S <= now) return refuse("ACCESS_TOKEN_EXPIRED", "exp has passed");
  if (typeof claims.nbf === "number" && claims.nbf - CLOCK_SKEW_S > now) return refuse("ACCESS_TOKEN_NOT_YET_VALID", "nbf is in the future");

  return {
    ok: true,
    claims: {
      iss: claims.iss as string,
      aud,
      exp: claims.exp,
      ...(typeof claims.nbf === "number" ? { nbf: claims.nbf } : {}),
      ...(typeof claims.iat === "number" ? { iat: claims.iat } : {}),
      ...(typeof claims.sub === "string" ? { sub: claims.sub } : {}),
      ...(typeof claims.email === "string" && claims.email ? { email: claims.email } : {}),
      ...(typeof claims.common_name === "string" && claims.common_name ? { common_name: claims.common_name } : {}),
      ...(typeof claims.type === "string" ? { type: claims.type } : {}),
    },
  };
}

type Jwk = JsonWebKey & { kid?: string };

/** How long fetched team keys are trusted before a refetch; Access rotates every six weeks. */
export const KEYS_TTL_MS = 10 * 60 * 1000;
/** An unknown `kid` refetches at most this often, so forged kids cannot drive a fetch per request. */
export const KEYS_REFETCH_MS = 60 * 1000;

/**
 * The team's keys from `<issuer>/cdn-cgi/access/certs`, cached per isolate. A `kid` the cache does
 * not hold triggers one refetch (rotation), rate-limited; a failed read throws, which the verifier
 * reports as ACCESS_KEYS_UNAVAILABLE rather than as a bad token.
 */
export function teamKeys(issuer: string, fetcher: (url: string) => Promise<Response>, now: () => number): KeySource {
  let cache: { at: number; keys: Map<string, CryptoKey> } | null = null;
  const load = async () => {
    const res = await fetcher(`${issuer}/cdn-cgi/access/certs`);
    if (!res.ok) throw new Error(`team keys answered ${res.status}`);
    const body = (await res.json()) as { keys?: Jwk[] };
    const keys = new Map<string, CryptoKey>();
    for (const jwk of body.keys ?? []) {
      if (jwk.kty !== "RSA" || !jwk.kid) continue;
      const { kid, ...material } = jwk;
      keys.set(kid, await crypto.subtle.importKey("jwk", { ...material, alg: "RS256", ext: true }, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]));
    }
    cache = { at: now(), keys };
    return keys;
  };
  return async (kid) => {
    if (!cache || now() - cache.at > KEYS_TTL_MS) return (await load()).get(kid) ?? null;
    const hit = cache.keys.get(kid);
    if (hit) return hit;
    if (now() - cache.at > KEYS_REFETCH_MS) return (await load()).get(kid) ?? null;
    return null;
  };
}
