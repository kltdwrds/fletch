// A fake Cloudflare API for the provisioning tests: one account held in memory, answered through an injected
// `fetch`. It never touches the network. Each scope the token lacks answers its probes with 403, as the real
// API does; every request is recorded so a test can count creates and secret puts.

export type Scope = "Workers Scripts" | "R2" | "Vectorize" | "Workers AI";
export const ALL_SCOPES: readonly Scope[] = ["Workers Scripts", "R2", "Vectorize", "Workers AI"];

export interface FakeAccount {
  accountId: string;
  /** Whether the token is a user token (verified at /user/tokens/verify) or an account token. */
  kind: "user" | "account" | "invalid";
  scopes: Set<Scope>;
  buckets: Set<string>;
  indexes: Map<string, { dimensions: number; metric: string }>;
  /** Deployed scripts and the names of their secrets. */
  scripts: Map<string, Map<string, string>>;
  subdomain: string | null;
}

export interface Recorded {
  method: string;
  path: string;
  body: unknown;
}

const BASE = "https://api.cloudflare.com/client/v4";

const ok = (result: unknown) => Response.json({ success: true, errors: [], result });
const fail = (status: number, code: number, message: string) => Response.json({ success: false, errors: [{ code, message }], result: null }, { status });
const denied = () => fail(403, 10000, "Authentication error");

export function fakeAccount(over: Partial<FakeAccount> = {}): FakeAccount {
  return {
    accountId: "0123456789abcdef0123456789abcdef",
    kind: "user",
    scopes: new Set(ALL_SCOPES),
    buckets: new Set(),
    indexes: new Map(),
    scripts: new Map(),
    subdomain: "sam-example",
    ...over,
  };
}

export function fakeCloudflare(account: FakeAccount = fakeAccount()) {
  const calls: Recorded[] = [];
  const fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input));
    const method = (init?.method ?? "GET").toUpperCase();
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    if (!url.href.startsWith(BASE)) throw new Error(`fake cloudflare: unexpected host ${url.host}`);
    const path = url.pathname.slice(new URL(BASE).pathname.length);
    calls.push({ method, path, body });
    const has = (s: Scope) => account.scopes.has(s);
    const acct = `/accounts/${account.accountId}`;

    if (method === "GET" && path === "/user/tokens/verify") return account.kind === "user" ? ok({ id: "t", status: "active" }) : fail(401, 1000, "Invalid API Token");
    if (method === "GET" && path === `${acct}/tokens/verify`) return account.kind === "account" ? ok({ id: "t", status: "active" }) : fail(401, 1000, "Invalid API Token");
    if (!path.startsWith(acct)) return fail(403, 10000, "Authentication error");
    const rest = path.slice(acct.length);

    if (rest === "/workers/scripts" && method === "GET") return has("Workers Scripts") ? ok([...account.scripts.keys()].map((id) => ({ id }))) : denied();
    if (rest === "/workers/subdomain" && method === "GET") {
      if (!has("Workers Scripts")) return denied();
      return account.subdomain ? ok({ subdomain: account.subdomain }) : fail(404, 10007, "workers.dev subdomain not found");
    }
    const secrets = rest.match(/^\/workers\/scripts\/([^/]+)\/secrets$/);
    if (secrets) {
      if (!has("Workers Scripts")) return denied();
      const script = account.scripts.get(secrets[1] as string);
      if (!script) return fail(404, 10007, "workers.api.error.script_not_found");
      if (method === "GET") return ok([...script.keys()].map((name) => ({ name, type: "secret_text" })));
      if (method === "PUT") {
        const b = body as { name: string; text: string; type: string };
        script.set(b.name, b.text);
        return ok({ name: b.name, type: b.type });
      }
    }
    if (rest === "/r2/buckets" && method === "GET") return has("R2") ? ok({ buckets: [...account.buckets].map((name) => ({ name })) }) : denied();
    if (rest === "/r2/buckets" && method === "POST") {
      if (!has("R2")) return denied();
      account.buckets.add((body as { name: string }).name);
      return ok({ name: (body as { name: string }).name });
    }
    const bucket = rest.match(/^\/r2\/buckets\/([^/]+)$/);
    if (bucket && method === "GET") {
      if (!has("R2")) return denied();
      return account.buckets.has(bucket[1] as string) ? ok({ name: bucket[1] }) : fail(404, 10006, "The specified bucket does not exist.");
    }
    if (rest === "/vectorize/v2/indexes" && method === "GET") return has("Vectorize") ? ok([...account.indexes].map(([name, config]) => ({ name, config }))) : denied();
    if (rest === "/vectorize/v2/indexes" && method === "POST") {
      if (!has("Vectorize")) return denied();
      const b = body as { name: string; config: { dimensions: number; metric: string } };
      account.indexes.set(b.name, b.config);
      return ok({ name: b.name, config: b.config });
    }
    if (rest === "/ai/models/search" && method === "GET") return has("Workers AI") ? ok([]) : denied();
    return fail(500, 0, `fake cloudflare: no route for ${method} ${path}`);
  };
  /** Requests that create or change something: every non-GET. */
  const writes = () => calls.filter((c) => c.method !== "GET");
  return { fetch: fetch as typeof globalThis.fetch, calls, writes, account };
}
