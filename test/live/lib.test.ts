import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { repoRoot } from "../support/temp-repo.ts";
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

describe("[F1] live test: nothing secret is printed", () => {
  it("knows the shapes of a recovery code and a setup token without echoing them", async () => {
    const { isRecoveryShape, isSetupTokenShape } = await import("./lib.ts");
    expect(isRecoveryShape("ABCDE-12345-fghij-KLMNO")).toBe(true);
    for (const bad of ["ABCDE12345FGHIJKLMNO", "ABCDE-12345-fghij", "ABCDE-12345-fghij-KLMN!", undefined, 7]) expect(isRecoveryShape(bad)).toBe(false);
    expect(isSetupTokenShape("a".repeat(43))).toBe(true);
    expect(isSetupTokenShape("short")).toBe(false);
    expect(isSetupTokenShape(`${"a".repeat(40)} `)).toBe(false);
  });

  it("reads the login page's state word, and masks a value only inside GitHub Actions", async () => {
    const { maskCommand, pageState } = await import("./lib.ts");
    expect(pageState('<html><body data-state="register">x</body>')).toBe("register");
    expect(pageState("<html>no state</html>")).toBeNull();
    expect(maskCommand("s3cret", { GITHUB_ACTIONS: "true" })).toBe("::add-mask::s3cret");
    expect(maskCommand("s3cret", {})).toBeNull();
    expect(maskCommand("two\nlines", { GITHUB_ACTIONS: "true" })).toBeNull();
    expect(maskCommand("", { GITHUB_ACTIONS: "true" })).toBeNull();
  });
});

describe("[F1] live test: the sweep", () => {
  const listing = {
    workers: ["fletch-ci-1", "qyvr-base", "fletch-ci-", "my-fletch-ci-2", "fletch-ci-Bad"],
    buckets: ["fletch-ci-1-agent", "fletch-ci-1", "qyvr-base-agent", "fletch-ci--agent", "other-fletch-ci-1-agent"],
    indexes: ["fletch-ci-1-memory", "qyvr-base-memory", "fletch-ci-1-agent", "fletch-ci-2-memory"],
  };

  it("plans only fletch-ci- names, each in its own kind's suffix", async () => {
    const { planSweep } = await import("./lib.ts");
    expect(planSweep(ACCOUNT, listing).map((s) => `${s.kind}:${s.name}`)).toEqual(["worker:fletch-ci-1", "bucket:fletch-ci-1-agent", "index:fletch-ci-1-memory", "index:fletch-ci-2-memory"]);
    expect(planSweep("bad", listing)).toEqual([]);
  });

  it("re-checks the guard before each DELETE: a tampered step is never sent", async () => {
    const { runSteps } = await import("./sweep.ts");
    const calls: string[] = [];
    const api = { call: async (m: string, p: string) => void calls.push(`${m} ${p}`) } as never;
    const ok = { kind: "worker", name: "fletch-ci-1", method: "DELETE", path: `/accounts/${ACCOUNT}/workers/scripts/fletch-ci-1?force=true` } as const;
    const out = await runSteps(api, [ok, { ...ok, name: "qyvr-base", path: `/accounts/${ACCOUNT}/workers/scripts/qyvr-base` }, { ...ok, path: `/accounts/${ACCOUNT}/workers/scripts/qyvr-base` }], () => {});
    expect(calls).toEqual([`DELETE ${ok.path}`]);
    expect(out.deleted).toEqual(["worker fletch-ci-1"]);
    expect(out.leaked).toHaveLength(2);
  });

  it("lists, deletes the fletch-ci- set, treats 404 as gone and reports a non-empty bucket by name", async () => {
    const { sweep } = await import("./sweep.ts");
    const calls: string[] = [];
    const fail = (status: number, message: string) => Object.assign(new Error(message), { status });
    const api = {
      call: async (method: string, path: string) => {
        calls.push(`${method} ${path.replace(`/accounts/${ACCOUNT}`, "")}`);
        if (method === "GET" && path.endsWith("/workers/scripts")) return [{ id: "fletch-ci-1" }, { id: "qyvr-base" }];
        if (method === "GET" && path.endsWith("/r2/buckets")) return { buckets: [{ name: "fletch-ci-1-agent" }, { name: "qyvr-base-agent" }] };
        if (method === "GET") return [{ name: "fletch-ci-1-memory" }, { name: "qyvr-base-memory" }];
        if (path.includes("/workers/scripts/")) throw fail(404, "gone");
        if (path.includes("/r2/buckets/")) throw fail(409, "DELETE bucket -> 409 10008: bucket is not empty tok-1");
        return null;
      },
    };
    const out = await sweep(api as never, ACCOUNT, () => {}, (t) => t.replaceAll("tok-1", "[token]"));
    expect(calls.filter((c) => c.startsWith("DELETE"))).toEqual(["DELETE /workers/scripts/fletch-ci-1?force=true", "DELETE /r2/buckets/fletch-ci-1-agent", "DELETE /vectorize/v2/indexes/fletch-ci-1-memory"]);
    expect(out.gone).toEqual(["worker fletch-ci-1"]);
    expect(out.deleted).toEqual(["index fletch-ci-1-memory"]);
    expect(out.leaked).toHaveLength(1);
    expect(out.leaked[0]).toMatch(/^bucket fletch-ci-1-agent: .*\[token\].*Dashboard, R2/);
    expect(out.leaked[0]).not.toContain("tok-1");
  });
});

describe("[F1] live test: which cleanup leak fails the run", () => {
  const NAME = "fletch-ci-42";
  const bucket = (name: string, status: number | undefined, words: string) => ({ kind: "bucket" as const, name, ...(status !== undefined ? { status } : {}), line: `bucket ${name}: ${words}` });

  it("the run's own non-empty bucket is an expected manual cleanup, warned by name, counted once though the sweep sees it again", async () => {
    const { manualCleanupWarning, triageLeaks } = await import("./lib.ts");
    const own = bucket(`${NAME}-agent`, 409, "DELETE -> 409 10008: The bucket you tried to delete is not empty");
    expect(triageLeaks([own, { ...own }], NAME)).toEqual({ expected: [own], failures: [] });
    // The words alone are enough when the API gave no status.
    expect(triageLeaks([bucket(`${NAME}-agent`, undefined, "bucket is not empty")], NAME).failures).toEqual([]);
    expect(manualCleanupWarning(`${NAME}-agent`)).toMatch(/^::warning::the bucket fletch-ci-42-agent .*delete it by hand/);
  });

  it("any other leak fails: another run's bucket, this bucket refused for another reason, a Worker, an index", async () => {
    const { triageLeaks } = await import("./lib.ts");
    const other = bucket("fletch-ci-41-agent", 409, "not empty");
    const forbidden = bucket(`${NAME}-agent`, 403, "Authentication error");
    const worker = { kind: "worker" as const, name: NAME, status: 500, line: "worker fletch-ci-42: 500" };
    const index = { kind: "index" as const, name: `${NAME}-memory`, status: 409, line: "index fletch-ci-42-memory: not empty" };
    expect(triageLeaks([other, forbidden, worker, index], NAME)).toEqual({ expected: [], failures: [other, forbidden, worker, index] });
  });

  it("the sweep's leaks carry the API's status, so the triage can read it", async () => {
    const { runSteps } = await import("./sweep.ts");
    const api = { call: async () => { throw Object.assign(new Error("not empty"), { status: 409 }); } } as never;
    const out = await runSteps(api, [{ kind: "bucket", name: `${NAME}-agent`, method: "DELETE", path: `/accounts/${ACCOUNT}/r2/buckets/${NAME}-agent` }], () => {});
    expect(out.leaks).toEqual([expect.objectContaining({ kind: "bucket", name: `${NAME}-agent`, status: 409 })]);
  });
});

describe("[F1] live test: the sweep script starts", () => {
  it("with no environment it prints its usage and exits 2, with no network call and no module error", () => {
    const res = spawnSync(process.execPath, ["--conditions=development", join(repoRoot, "scripts/live-sweep.ts")], { cwd: repoRoot, env: { PATH: process.env.PATH }, encoding: "utf8" });
    const out = `${res.stdout}${res.stderr}`;
    expect(out).not.toMatch(/ERR_MODULE_NOT_FOUND/);
    expect(out).toMatch(/live-sweep: set CF_LIVE_ACCOUNT_ID/);
    expect(res.status).toBe(2);
  });
});
