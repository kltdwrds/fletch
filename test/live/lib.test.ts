import { describe, expect, it } from "vitest";
import { CI_PREFIX, isCiName, parseSetupLink, planCleanup, runIdFrom, workerNameFor } from "./lib.ts";

const ACCOUNT = "0123456789abcdef0123456789abcdef";

describe("[F1] live test: the name guard", () => {
  it("accepts only fletch-ci- names with something after the prefix", () => {
    expect(isCiName("fletch-ci-123456")).toBe(true);
    for (const bad of ["fletch-ci-", "fletch-ci", "my-fletch", "xfletch-ci-1", "Fletch-ci-1", "fletch-ci-A", "fletch-ci-1_2", "fletch-ci-1/../x", "", `${CI_PREFIX}${"1".repeat(30)}`, null, undefined, 7]) {
      expect(isCiName(bad), String(bad)).toBe(false);
    }
  });

  it("derives a valid Worker name from a run id, trimmed to the tenant limit", () => {
    expect(workerNameFor("9876543210")).toBe("fletch-ci-9876543210");
    expect(workerNameFor("Run #42!")).toBe("fletch-ci-run-42");
    expect(workerNameFor("")).toBe("fletch-ci-local");
    const long = workerNameFor("1234567890123456789012345678901234567890");
    expect(long.length).toBeLessThanOrEqual(31);
    expect(isCiName(long)).toBe(true);
    expect(long.endsWith("7890")).toBe(true);
  });

  it("takes the run id from GITHUB_RUN_ID, else the clock", () => {
    expect(runIdFrom({ GITHUB_RUN_ID: " 555 " }, 1)).toBe("555");
    expect(runIdFrom({}, 36)).toBe("10");
  });
});

describe("[F1] live test: cleanup planning", () => {
  it("plans the Worker, then the bucket and the index, each named from the Worker", () => {
    expect(planCleanup(ACCOUNT, "fletch-ci-42")).toEqual({
      ok: true,
      steps: [
        { kind: "worker", name: "fletch-ci-42", method: "DELETE", path: `/accounts/${ACCOUNT}/workers/scripts/fletch-ci-42?force=true` },
        { kind: "bucket", name: "fletch-ci-42-agent", method: "DELETE", path: `/accounts/${ACCOUNT}/r2/buckets/fletch-ci-42-agent` },
        { kind: "index", name: "fletch-ci-42-memory", method: "DELETE", path: `/accounts/${ACCOUNT}/vectorize/v2/indexes/fletch-ci-42-memory` },
      ],
    });
  });

  it("plans nothing for a name outside the namespace, and nothing for a bad account id", () => {
    for (const name of ["solo-sam", "production", "fletch-ci-", "fletchci-1"]) {
      const plan = planCleanup(ACCOUNT, name);
      expect(plan.ok, name).toBe(false);
      if (!plan.ok) expect(plan.reason).toMatch(/fletch-ci-/);
    }
    expect(planCleanup("not-an-account", "fletch-ci-42")).toMatchObject({ ok: false });
  });
});

describe("[F1] live test: the setup link", () => {
  it("is read from init's output", () => {
    const out = "fletch is deployed:\nhttps://fletch-ci-42.solo-sam.workers.dev\n\nOpen this link:\nhttps://fletch-ci-42.solo-sam.workers.dev/login?setup=abc_DEF-123\n";
    expect(parseSetupLink(out)).toEqual({ url: "https://fletch-ci-42.solo-sam.workers.dev", token: "abc_DEF-123", link: "https://fletch-ci-42.solo-sam.workers.dev/login?setup=abc_DEF-123" });
  });

  it("is null when init printed no link, as on a second run", () => {
    expect(parseSetupLink("fletch is deployed:\nhttps://fletch-ci-42.solo-sam.workers.dev\nSetup was already done")).toBeNull();
  });
});
