import { describe, expect, it } from "vitest";
import { CloudflareApi, ensureBucket, ensureVectorIndex, fromB64u, listSecrets, mintMasterKey, mintSetupToken, putSecret, tokenScopes, workersDevUrl } from "../src/index.ts";
import { fakeAccount, fakeCloudflare } from "./fake-cloudflare.ts";

const ACCOUNT = "0123456789abcdef0123456789abcdef";
const api = (cf: ReturnType<typeof fakeCloudflare>) => new CloudflareApi("test-token", { fetch: cf.fetch });

describe("[F1] provisioning: tokenScopes", () => {
  it("is ok when the token holds every scope", async () => {
    expect(await tokenScopes(api(fakeCloudflare()), ACCOUNT)).toEqual({ ok: true });
  });

  it("names each missing scope", async () => {
    const cf = fakeCloudflare(fakeAccount({ scopes: new Set(["Workers Scripts", "Workers AI"]) }));
    expect(await tokenScopes(api(cf), ACCOUNT)).toEqual({ ok: false, missing: ["R2", "Vectorize"] });
  });

  it("verifies an account token at the account's verify endpoint when the user endpoint refuses it", async () => {
    const cf = fakeCloudflare(fakeAccount({ kind: "account" }));
    expect(await tokenScopes(api(cf), ACCOUNT)).toEqual({ ok: true });
    expect(cf.calls.map((c) => c.path).slice(0, 2)).toEqual(["/user/tokens/verify", `/accounts/${ACCOUNT}/tokens/verify`]);
  });

  it("refuses a token neither endpoint verifies, and makes no probe", async () => {
    const cf = fakeCloudflare(fakeAccount({ kind: "invalid" }));
    const r = await tokenScopes(api(cf), ACCOUNT);
    expect(r).toMatchObject({ ok: false, invalid: true });
    expect(cf.calls).toHaveLength(2);
  });

  it("sends the token only as a bearer header", async () => {
    const seen: Headers[] = [];
    const cf = fakeCloudflare();
    const spy: typeof fetch = (input, init) => {
      seen.push(new Headers(init?.headers));
      expect(String(input)).not.toContain("test-token");
      return cf.fetch(input, init);
    };
    await tokenScopes(new CloudflareApi("test-token", { fetch: spy }), ACCOUNT);
    expect(seen.every((h) => h.get("authorization") === "Bearer test-token")).toBe(true);
  });
});

describe("[F1] provisioning: resources", () => {
  it("ensureBucket creates a missing bucket once and makes no POST for an existing one", async () => {
    const cf = fakeCloudflare();
    expect(await ensureBucket(api(cf), ACCOUNT, "sam-agent")).toBe("sam-agent");
    expect(cf.writes()).toHaveLength(1);
    expect(await ensureBucket(api(cf), ACCOUNT, "sam-agent")).toBe("sam-agent");
    expect(cf.writes()).toHaveLength(1);
  });

  it("ensureBucket passes on an error that is not a 404", async () => {
    const cf = fakeCloudflare(fakeAccount({ scopes: new Set() }));
    await expect(ensureBucket(api(cf), ACCOUNT, "sam-agent")).rejects.toMatchObject({ status: 403 });
    expect(cf.writes()).toHaveLength(0);
  });

  it("ensureVectorIndex creates a 768-dimension cosine index once", async () => {
    const cf = fakeCloudflare();
    await ensureVectorIndex(api(cf), ACCOUNT, "sam-memory");
    await ensureVectorIndex(api(cf), ACCOUNT, "sam-memory");
    expect(cf.writes()).toHaveLength(1);
    expect(cf.account.indexes.get("sam-memory")).toEqual({ dimensions: 768, metric: "cosine" });
  });

  it("ensureVectorIndex refuses an index of the name with another shape", async () => {
    const cf = fakeCloudflare(fakeAccount({ indexes: new Map([["sam-memory", { dimensions: 384, metric: "cosine" }]]) }));
    await expect(ensureVectorIndex(api(cf), ACCOUNT, "sam-memory")).rejects.toThrow(/MEMORY_INDEX_SHAPE/);
  });

  it("putSecret and listSecrets name a script's secrets, never their values", async () => {
    const cf = fakeCloudflare(fakeAccount({ scripts: new Map([["sam", new Map()]]) }));
    await putSecret(api(cf), ACCOUNT, "sam", "MASTER_KEY", "value-1");
    expect(await listSecrets(api(cf), ACCOUNT, "sam")).toEqual(["MASTER_KEY"]);
    expect(cf.writes()[0]).toMatchObject({ method: "PUT", body: { name: "MASTER_KEY", text: "value-1", type: "secret_text" } });
  });

  it("listSecrets of a script that does not exist yet is empty", async () => {
    expect(await listSecrets(api(fakeCloudflare()), ACCOUNT, "sam")).toEqual([]);
  });

  it("workersDevUrl is the script on the account's workers.dev subdomain", async () => {
    expect(await workersDevUrl(api(fakeCloudflare()), ACCOUNT, "sam")).toBe("https://sam.sam-example.workers.dev");
    expect(await workersDevUrl(api(fakeCloudflare(fakeAccount({ subdomain: null }))), ACCOUNT, "sam")).toBeNull();
  });

  it("retries a 429 through the injected sleep, not the clock", async () => {
    const cf = fakeCloudflare();
    let first = true;
    const slept: number[] = [];
    const busy: typeof fetch = (input, init) => {
      if (first) {
        first = false;
        return Promise.resolve(new Response("{}", { status: 429 }));
      }
      return cf.fetch(input, init);
    };
    const client = new CloudflareApi("test-token", { fetch: busy, sleep: async (ms) => void slept.push(ms) });
    expect(await tokenScopes(client, ACCOUNT)).toEqual({ ok: true });
    expect(slept).toEqual([2000]);
  });
});

describe("[F1] provisioning: minted secrets", () => {
  it("mintMasterKey and mintSetupToken are 32 random bytes, base64url, different each call", () => {
    for (const mint of [mintMasterKey, mintSetupToken]) {
      const a = mint();
      expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(fromB64u(a)?.byteLength).toBe(32);
      expect(mint()).not.toBe(a);
    }
  });
});
