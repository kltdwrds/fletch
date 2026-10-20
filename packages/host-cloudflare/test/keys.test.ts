import { describe, expect, it } from "vitest";
import { b64u, DATA_KEY_BYTES, secretKeyService } from "../src/keys.ts";

const master = b64u(crypto.getRandomValues(new Uint8Array(32)));
const otherMaster = b64u(crypto.getRandomValues(new Uint8Array(32)));
const raw = () => crypto.getRandomValues(new Uint8Array(DATA_KEY_BYTES));

describe("[F1] secretKeyService", () => {
  it("wraps then unwraps a 32-byte key", async () => {
    const keys = secretKeyService(master, "solo-sam");
    const key = raw();
    const wrapped = await keys.wrap(key);
    expect(wrapped.ok).toBe(true);
    if (!wrapped.ok) return;
    expect(wrapped.blob.startsWith("qk1.solo-sam.")).toBe(true);
    const opened = await keys.unwrap(wrapped.blob);
    expect(opened).toMatchObject({ ok: true });
    if (opened.ok) expect(Array.from(opened.key)).toEqual(Array.from(key));
  });

  it("refuses a blob relabelled for another tenant with KEY_TENANT_MISMATCH", async () => {
    const a = secretKeyService(master, "solo-sam");
    const b = secretKeyService(master, "other-tenant");
    const wrapped = await a.wrap(raw());
    if (!wrapped.ok) throw new Error("wrap failed");
    expect(await b.unwrap(wrapped.blob)).toMatchObject({ ok: false, code: "KEY_TENANT_MISMATCH" });
    expect(await b.unwrap(wrapped.blob.replace(".solo-sam.", ".other-tenant."))).toMatchObject({ ok: false, code: "KEY_UNWRAP_FAILED" });
  });

  it("fails every call with KEY_SERVICE_UNAVAILABLE when the secret is undefined", async () => {
    const keys = secretKeyService(undefined, "solo-sam");
    expect(await keys.wrap(raw())).toEqual({ ok: false, code: "KEY_SERVICE_UNAVAILABLE", reason: "MASTER_KEY is not set; rerun create-fletch" });
    expect(await keys.unwrap("qk1.solo-sam.aa.bb")).toMatchObject({ ok: false, code: "KEY_SERVICE_UNAVAILABLE" });
  });

  it("refuses a 31-byte key with KEY_INVALID", async () => {
    const keys = secretKeyService(master, "solo-sam");
    expect(await keys.wrap(new Uint8Array(31))).toMatchObject({ ok: false, code: "KEY_INVALID" });
  });

  it("does not open a blob under a different master secret", async () => {
    const wrapped = await secretKeyService(master, "solo-sam").wrap(raw());
    if (!wrapped.ok) throw new Error("wrap failed");
    expect(await secretKeyService(otherMaster, "solo-sam").unwrap(wrapped.blob)).toMatchObject({ ok: false, code: "KEY_UNWRAP_FAILED" });
  });

  it("refuses a malformed blob and a malformed master secret", async () => {
    expect(await secretKeyService(master, "solo-sam").unwrap("nonsense")).toMatchObject({ ok: false, code: "KEY_BLOB_MALFORMED" });
    expect(await secretKeyService("short", "solo-sam").wrap(raw())).toMatchObject({ ok: false, code: "KEY_SERVICE_UNAVAILABLE" });
  });
});
