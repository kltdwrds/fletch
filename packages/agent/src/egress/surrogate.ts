// Surrogate tokens (M25.1, spec P4): beside `cred://` references, the agent and the code it runs may
// hold an opaque surrogate, shaped like an API token so a stock SDK takes it as a bearer. The Vault
// mints one for a person's credential and keeps only its hash; at egress the Vault swaps it back to
// its reference, so the policy places it and the registry's hosts bound it exactly as a reference.
// A surrogate is never shown to the model or written to a log, memory or R2: every tool result, and
// every answer the egress module passes back, has surrogates replaced by a marker before it leaves.

const PREFIX = "qyvs_";
/** A surrogate as minted: the prefix and 40 hex characters (160 random bits). */
export const SURROGATE = /qyvs_[0-9a-f]{40}/g;
/** Anything that starts like a surrogate, whole or cut, so a partial one is scrubbed too. */
const SURROGATE_LIKE = /qyvs_[0-9A-Za-z]*/g;
export const SURROGATE_MARK = "[surrogate]";

const hex = (bytes: Uint8Array) => [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");

export function mintSurrogate(): string {
  return `${PREFIX}${hex(crypto.getRandomValues(new Uint8Array(20)))}`;
}

/** What the Vault keys a surrogate by: never the token itself. */
export async function surrogateHash(token: string): Promise<string> {
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`qyvr-surrogate:v1:${token}`))));
}

export function hasSurrogate(text: string): boolean {
  return text.includes(PREFIX);
}

export function scrubSurrogates(text: string): string {
  return hasSurrogate(text) ? text.replace(SURROGATE_LIKE, SURROGATE_MARK) : text;
}

/** Every string inside a JSON-like value with surrogates scrubbed: tool result details are data the model and the transcript see. */
export function scrubValue<T>(value: T): T {
  if (typeof value === "string") return scrubSurrogates(value) as T;
  if (Array.isArray(value)) return value.map(scrubValue) as T;
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [scrubSurrogates(k), scrubValue(v)])) as T;
  }
  return value;
}
