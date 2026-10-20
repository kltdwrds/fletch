import { describe, expect, it } from "vitest";
import { b64u, singleAccountHost } from "../src/index.ts";

const env = (over: Record<string, unknown> = {}) =>
  ({ TENANT_ID: "solo-sam", OWNER_EMAIL: "Sam@Solo-Sam.example", COMPANY: {} as DurableObjectNamespace, ...over }) as Parameters<typeof singleAccountHost>[0];

describe("[F1] singleAccountHost", () => {
  it("seeds the owner with a normalized address and sets no budget", () => {
    const host = singleAccountHost(env());
    expect(JSON.parse(host.memberSeed)).toEqual([{ email: "sam@solo-sam.example", role: "owner" }]);
    expect(host.budget).toBeNull();
    expect(host.tenant).toEqual({ id: "solo-sam", shape: "standalone", env: "self-host" });
  });

  it("reads the tenant shape from TENANT_SHAPE, defaulting to standalone, and is always self-host", () => {
    expect(singleAccountHost(env({ TENANT_SHAPE: "company", QYVR_ENV: "staging" })).tenant).toEqual({ id: "solo-sam", shape: "company", env: "self-host" });
    expect(singleAccountHost(env({ TENANT_SHAPE: "nonsense" })).tenant.shape).toBe("standalone");
  });

  it("refuses every platform feature with its code and a reason", () => {
    const host = singleAccountHost(env());
    for (const [feature, value] of [["mail", host.mail], ["workspace", host.workspace], ["provisioning", host.provisioning], ["members", host.members], ["render", host.render]] as const) {
      expect(value).toMatchObject({ ok: false, code: `HOST_${feature.toUpperCase()}_UNAVAILABLE`, reason: `${feature} is not part of the self-host build; see README` });
    }
  });

  it("refuses identity with IDENTITY_UNAVAILABLE until the passkey login lands", async () => {
    const verdict = await singleAccountHost(env()).identity.verify(new Request("https://x.example/"), async () => null);
    expect(verdict).toMatchObject({ ok: false, code: "IDENTITY_UNAVAILABLE", status: 503 });
  });

  it("wraps keys only with a master key", async () => {
    const none = await singleAccountHost(env()).keys.wrap(new Uint8Array(32));
    expect(none).toMatchObject({ ok: false, code: "KEY_SERVICE_UNAVAILABLE" });
    const keys = singleAccountHost(env({ MASTER_KEY: b64u(crypto.getRandomValues(new Uint8Array(32))) })).keys;
    const key = crypto.getRandomValues(new Uint8Array(32));
    const wrapped = await keys.wrap(key);
    expect(wrapped.ok).toBe(true);
    if (!wrapped.ok) return;
    const back = await keys.unwrap(wrapped.blob);
    expect(back.ok && Array.from(back.key)).toEqual(Array.from(key));
  });

  it("reports one JSON line per event", () => {
    const lines: string[] = [];
    const orig = console.log;
    console.log = (s: string) => void lines.push(s);
    try {
      singleAccountHost(env()).reporter.report("hello", { n: 1 });
    } finally {
      console.log = orig;
    }
    expect(JSON.parse(lines[0] ?? "")).toMatchObject({ event: "hello", n: 1 });
  });
});
