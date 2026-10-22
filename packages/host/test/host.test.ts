// Holds decision D-0001: a missing capability is refused with its HOST_<FEATURE>_UNAVAILABLE code and a reason.
import { describe, expect, it } from "vitest";
import { type Host, type HostFailureCode, unavailable } from "../src/index.ts";

describe("[F1] @qyvr/host", () => {
  it("unavailable names the feature's code and carries the reason", () => {
    expect(unavailable("mail", "no mail on self-host")).toEqual({ ok: false, code: "HOST_MAIL_UNAVAILABLE", reason: "no mail on self-host" });
  });

  it("a Host with refused features and no budget type-checks", () => {
    const host = {
      tenant: { id: "solo-sam", shape: "standalone", env: "self-host" },
      keys: { wrap: async () => ({ ok: true, blob: "b" }), unwrap: async () => ({ ok: true, key: new Uint8Array(32) }) },
      budget: null,
      identity: { verify: async () => ({ ok: false, code: "SESSION_MISSING", reason: "none", status: 401 }), routes: async () => null },
      mail: unavailable("mail", "no mail on self-host"),
      workspace: unavailable("workspace", "no workspace"),
      provisioning: unavailable("provisioning", "none"),
      members: unavailable("members", "none"),
      reporter: { report: () => {} },
      render: unavailable("render", "none"),
      memberSeed: "[]",
    } satisfies Host;
    expect(host.budget).toBeNull();
    expect(host.mail.ok).toBe(false);
  });

  it("HostFailureCode rejects a code that is not <FEATURE>_UNAVAILABLE", () => {
    // @ts-expect-error HOST_MAIL_MISSING is not a HostFailureCode
    const bad: HostFailureCode = "HOST_MAIL_MISSING";
    const good: HostFailureCode = "HOST_MAIL_UNAVAILABLE";
    expect([bad, good]).toHaveLength(2);
  });
});
