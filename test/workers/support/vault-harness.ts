// The Vault under the object harness, with @qyvr/host-cloudflare's key service as its KEYS binding
// (given the tenant its props would carry and a test master key as the secret), every storage call
// recorded, and the
// raw data keys that crossed the key entrypoint kept aside so a test can look for them in storage.
import type { KeyService } from "@qyvr/host";
import { b64u, importMaster, keyService } from "@qyvr/host-cloudflare";
import { VaultCore } from "../../../packages/agent/src/vault/core.ts";
import { ObjectHarness } from "../../support/object-harness.ts";
import type { VendorFetch } from "../../support/vendors/index.ts";

/** The writer the capture form and settings pass for a signed-in person (M13). */
export const asPerson = (person: string, via: "capture-form" | "settings" = "settings") => ({ kind: "person" as const, person, via });

/** A master key made per test run; never a literal in the repository. */
export const testMasterKey = (): string => b64u(crypto.getRandomValues(new Uint8Array(32)));

/** The dispatcher's key entrypoint as a tenant's binding sees it: the tenant fixed by props. */
export function keysFor(tenant: string, masterKey: string): KeyService {
  return keyService(() => importMaster(masterKey), tenant);
}

export interface StorageWrite {
  query: string;
  bindings: unknown[];
}

/** Wraps a KeyService and copies every raw key that crosses it, before the Vault zeroes its copy. */
export function recordingKeys(inner: KeyService, seen: Uint8Array[]): KeyService & { unwraps: number } {
  const out = {
    unwraps: 0,
    async wrap(raw: Uint8Array) {
      seen.push(new Uint8Array(raw));
      return inner.wrap(raw);
    },
    async unwrap(blob: string) {
      out.unwraps++;
      const r = await inner.unwrap(blob);
      if (r.ok) seen.push(new Uint8Array(r.key));
      return r;
    },
  };
  return out;
}

export function vaultHarness(options: { tenant: string; keys: KeyService; fetch: VendorFetch; name?: string }) {
  const writes: StorageWrite[] = [];
  const harness = new ObjectHarness(
    options.name ?? `vault-${options.tenant}`,
    (ctx) => {
      const c = ctx as { storage: { sql: { exec: (q: string, ...b: unknown[]) => unknown } } };
      const exec = c.storage.sql.exec;
      // Every statement that is not a read is a storage write.
      c.storage.sql.exec = (q: string, ...b: unknown[]) => {
        if (!/^\s*SELECT\b/i.test(q)) writes.push({ query: q, bindings: b });
        return exec(q, ...b);
      };
      return new VaultCore(ctx as never, { tenant: options.tenant, keys: options.keys, fetch: options.fetch, now: () => 1_760_000_000_000 });
    },
    {},
  );
  return { harness, writes, get vault() {
    return harness.instance;
  } };
}

const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));

/** True when `key` appears in `value` as raw bytes, hex, base64 or base64url. */
export function containsKey(value: unknown, key: Uint8Array): boolean {
  if (value instanceof Uint8Array || value instanceof ArrayBuffer) {
    const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
    outer: for (let i = 0; i + key.length <= bytes.length; i++) {
      for (let j = 0; j < key.length; j++) if (bytes[i + j] !== key[j]) continue outer;
      return true;
    }
    return false;
  }
  const text = typeof value === "string" ? value : JSON.stringify(value ?? null);
  return [hex(key), b64(key), b64(key).replace(/=+$/, ""), b64u(key)].some((form) => text.includes(form));
}
