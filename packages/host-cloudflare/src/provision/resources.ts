// Provisioning for one account (F1): the token's scopes, the bucket, the memory index, the Worker's secrets and
// its workers.dev URL. Every write is guarded by a read, so a second run with the same inputs writes nothing.
import { b64u } from "../keys.ts";
import { type CloudflareApi, statusOf } from "./api.ts";

/** The scopes a token-driven setup of fletch needs, each with the cheapest read that proves the token holds it. */
export const NEEDED_SCOPES: readonly { scope: string; probe: (accountId: string) => string }[] = [
  { scope: "Workers Scripts", probe: (a) => `/accounts/${a}/workers/scripts` },
  { scope: "R2", probe: (a) => `/accounts/${a}/r2/buckets` },
  { scope: "Vectorize", probe: (a) => `/accounts/${a}/vectorize/v2/indexes` },
  { scope: "Workers AI", probe: (a) => `/accounts/${a}/ai/models/search?per_page=1` },
];

export type ScopeCheck = { ok: true } | { ok: false; missing: string[]; invalid?: true };

/**
 * Whether the token is live and holds every needed scope. A user token verifies at /user/tokens/verify, an
 * account token at /accounts/{id}/tokens/verify. A probe refused with 401 or 403 names its scope missing; any
 * other failure is thrown, because it says nothing about the token.
 */
export async function tokenScopes(cf: CloudflareApi, accountId: string): Promise<ScopeCheck> {
  const active = async (path: string) => {
    try {
      return (await cf.call<{ status?: string }>("GET", path)).status === "active";
    } catch (error) {
      const status = statusOf(error);
      if (status === 400 || status === 401 || status === 403 || status === 404) return false;
      throw error;
    }
  };
  if (!(await active("/user/tokens/verify")) && !(await active(`/accounts/${accountId}/tokens/verify`))) {
    return { ok: false, missing: NEEDED_SCOPES.map((s) => s.scope), invalid: true };
  }
  const missing: string[] = [];
  for (const { scope, probe } of NEEDED_SCOPES) {
    try {
      await cf.call("GET", probe(accountId));
    } catch (error) {
      const status = statusOf(error);
      if (status !== 401 && status !== 403) throw error;
      missing.push(scope);
    }
  }
  return missing.length ? { ok: false, missing } : { ok: true };
}

export async function ensureBucket(cf: CloudflareApi, accountId: string, name: string): Promise<string> {
  try {
    await cf.call("GET", `/accounts/${accountId}/r2/buckets/${name}`);
  } catch (error) {
    if (statusOf(error) !== 404) throw error;
    await cf.call("POST", `/accounts/${accountId}/r2/buckets`, { name });
  }
  return name;
}

/** A tenant's semantic memory index (M12.2): bge-base's dimensions under cosine similarity. */
export const MEMORY_INDEX_CONFIG = { dimensions: 768, metric: "cosine" } as const;

/**
 * The tenant's Vectorize index, created when missing. An index of the name with another shape is
 * refused rather than used: its vectors would not compare with the agent's embeddings.
 */
export async function ensureVectorIndex(cf: CloudflareApi, accountId: string, name: string): Promise<string> {
  const path = `/accounts/${accountId}/vectorize/v2/indexes`;
  const found = (await cf.call<Array<{ name: string; config?: { dimensions?: number; metric?: string } }>>("GET", path)).find((i) => i.name === name);
  if (found) {
    const { dimensions, metric } = found.config ?? {};
    if (dimensions !== MEMORY_INDEX_CONFIG.dimensions || metric !== MEMORY_INDEX_CONFIG.metric) {
      throw new Error(`MEMORY_INDEX_SHAPE: index ${name} is ${dimensions} dimensions by ${metric}, not ${MEMORY_INDEX_CONFIG.dimensions} by ${MEMORY_INDEX_CONFIG.metric}`);
    }
    return name;
  }
  await cf.call("POST", path, { name, description: "fletch semantic memory", config: MEMORY_INDEX_CONFIG });
  return name;
}

/** The names of a Worker's secrets (never their values); empty when the script does not exist yet. */
export async function listSecrets(cf: CloudflareApi, accountId: string, script: string): Promise<string[]> {
  try {
    return (await cf.call<{ name: string }[]>("GET", `/accounts/${accountId}/workers/scripts/${script}/secrets`)).map((s) => s.name);
  } catch (error) {
    if (statusOf(error) === 404) return [];
    throw error;
  }
}

/** Sets one Worker secret. The script must already be deployed. */
export async function putSecret(cf: CloudflareApi, accountId: string, script: string, name: string, value: string): Promise<void> {
  await cf.call("PUT", `/accounts/${accountId}/workers/scripts/${script}/secrets`, { name, text: value, type: "secret_text" });
}

/** The script's URL on the account's workers.dev subdomain, or null when the account has none registered. */
export async function workersDevUrl(cf: CloudflareApi, accountId: string, script: string): Promise<string | null> {
  try {
    const { subdomain } = await cf.call<{ subdomain?: string }>("GET", `/accounts/${accountId}/workers/subdomain`);
    return subdomain ? `https://${script}.${subdomain}.workers.dev` : null;
  } catch (error) {
    if (statusOf(error) === 404) return null;
    throw error;
  }
}

const random32 = () => b64u(crypto.getRandomValues(new Uint8Array(32)));

/** The MASTER_KEY secret: 32 random bytes, base64url, as `importMaster` reads it. */
export const mintMasterKey = (): string => random32();

/** The SETUP_TOKEN secret: 32 random bytes, base64url, the token in the first `/login?setup=` link. */
export const mintSetupToken = (): string => random32();
