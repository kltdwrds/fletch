// A minimal Cloudflare API client for provisioning one account, copied from qyvr-co's scripts/platform/cf.ts.
// Changed: the token is a constructor argument (never read from the environment), and `fetch` and the 429
// back-off `sleep` are injected, so a test answers every call and no test waits on the clock.

export const CLOUDFLARE_API = "https://api.cloudflare.com/client/v4";

export interface CloudflareApiDeps {
  fetch?: typeof globalThis.fetch;
  sleep?: (ms: number) => Promise<void>;
}

/** A failed call: the HTTP status and Cloudflare's error codes; the message never carries the token. */
export type CloudflareError = Error & { status?: number; codes?: number[] };

export class CloudflareApi {
  readonly #token: string;
  readonly #fetch: typeof globalThis.fetch;
  readonly #sleep: (ms: number) => Promise<void>;

  constructor(token: string, deps: CloudflareApiDeps = {}) {
    if (!token) throw new Error("a Cloudflare API token is required");
    this.#token = token;
    this.#fetch = deps.fetch ?? ((input, init) => globalThis.fetch(input, init));
    this.#sleep = deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  async call<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const res = await this.#fetch(`${CLOUDFLARE_API}${path}`, {
        method,
        headers: { authorization: `Bearer ${this.#token}`, ...(body !== undefined ? { "content-type": "application/json" } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (res.status === 429 && attempt < 4) {
        await this.#sleep(2000 * (attempt + 1));
        continue;
      }
      const text = await res.text();
      let json: { success?: boolean; result?: unknown; errors?: { code: number; message: string }[] };
      try {
        json = JSON.parse(text);
      } catch {
        json = { success: res.ok, result: text };
      }
      if (!res.ok || json.success === false) {
        const errors = (json.errors ?? []).map((e) => `${e.code}: ${e.message}`).join("; ");
        const err = new Error(`${method} ${path} -> ${res.status} ${errors || text.slice(0, 200)}`) as CloudflareError;
        err.status = res.status;
        err.codes = (json.errors ?? []).map((e) => e.code);
        throw err;
      }
      return json.result as T;
    }
  }
}

/** The status of a failed call, or undefined for anything that is not a Cloudflare API error. */
export const statusOf = (error: unknown): number | undefined => (error as CloudflareError | null)?.status;
