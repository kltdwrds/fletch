// Credential grants (M13, D4's format): a person's signed permission for their agent to use one
// credential, `{ agent_id, secret_ref, scope, expires_at, one_shot, nonce }`, MACed with a key the
// `Vault` derives from the tenant's data key, so a grant written or altered without that key does not
// verify. The Vault keeps every grant it signs and checks the signature, the expiry, the revocation,
// the scope and a one-shot's use on every resolution; the pure part is here.

export interface GrantScope {
  hosts: string[];
  /** Methods a request may use; empty for a grant that only fills. */
  methods: string[];
  fill: boolean;
}

export interface CredentialGrant {
  v: 1;
  tenant: string;
  /** `agent:<person>`: the person's own agent, the only grantee a credential grant has. */
  agent_id: string;
  secret_ref: string;
  scope: GrantScope;
  expires_at: number;
  one_shot: boolean;
  nonce: string;
}

export type GrantUseCode = "EGRESS_GRANT_INVALID" | "EGRESS_GRANT_EXPIRED" | "EGRESS_GRANT_REVOKED" | "EGRESS_GRANT_SPENT" | "EGRESS_GRANT_SCOPE";

/** The longest a grant lasts; a lasting permission is renewed by the person, never extended in place. */
export const GRANT_MAX_MS = 30 * 86_400_000;

const enc = new TextEncoder();
const hex = (bytes: Uint8Array) => [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
export const newNonce = () => hex(crypto.getRandomValues(new Uint8Array(16)));

/** The bytes the MAC covers: the grant's fields in a fixed order, so a stored body re-serialises the same. */
export function canonical(g: CredentialGrant): string {
  return JSON.stringify([g.v, g.tenant, g.agent_id, g.secret_ref, g.scope.hosts, g.scope.methods, g.scope.fill, g.expires_at, g.one_shot, g.nonce]);
}

export async function sign(key: CryptoKey, g: CredentialGrant): Promise<string> {
  return hex(new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(canonical(g)))));
}

export async function verifySignature(key: CryptoKey, g: CredentialGrant, mac: string): Promise<boolean> {
  if (!/^[0-9a-f]{64}$/.test(mac)) return false;
  const bytes = new Uint8Array((mac.match(/../g) ?? []).map((b) => Number.parseInt(b, 16)));
  return crypto.subtle.verify("HMAC", key, bytes, enc.encode(canonical(g)));
}

export interface StoredGrant {
  grant: CredentialGrant;
  mac: string;
  revoked_at: number | null;
  used_at: number | null;
}

/** What a resolution asks of a grant: which host, and a method or a fill. */
export interface Use {
  person: string;
  ref: string;
  host: string;
  method: string;
  tenant: string;
  at: number;
}

/**
 * Checks one stored grant against one use, signature first. Returns null when the grant covers the
 * use, else the code that refuses it. The caller marks a one-shot grant used before revealing.
 */
export async function checkUse(key: CryptoKey, s: StoredGrant, use: Use): Promise<GrantUseCode | null> {
  const g = s.grant;
  if (!(await verifySignature(key, g, s.mac))) return "EGRESS_GRANT_INVALID";
  if (g.tenant !== use.tenant || g.agent_id !== `agent:${use.person}` || g.secret_ref !== use.ref) return "EGRESS_GRANT_INVALID";
  if (s.revoked_at !== null) return "EGRESS_GRANT_REVOKED";
  if (g.expires_at <= use.at) return "EGRESS_GRANT_EXPIRED";
  if (g.one_shot && s.used_at !== null) return "EGRESS_GRANT_SPENT";
  const covers = use.method === "FILL" ? g.scope.fill : g.scope.methods.includes(use.method);
  if (!g.scope.hosts.includes(use.host) || !covers) return "EGRESS_GRANT_SCOPE";
  return null;
}

/** When no grant covers a use, the code that says the most: a spent or expired grant over a missing one. */
const ORDER: GrantUseCode[] = ["EGRESS_GRANT_SPENT", "EGRESS_GRANT_EXPIRED", "EGRESS_GRANT_REVOKED", "EGRESS_GRANT_SCOPE", "EGRESS_GRANT_INVALID"];
export function mostTelling(codes: readonly GrantUseCode[]): GrantUseCode | null {
  return ORDER.find((c) => codes.includes(c)) ?? null;
}
