// M3.1: Code Mode on Dynamic Workers (D2). The runner (`code/run.ts`, moved from the shared sandbox at
// M25.5) runs under the fake loader with the documented get() caching. Its network, the agent script's
// `Egress` entrypoint, is M25.5's (test/workers/m25-5-code-mode.test.ts); here the outbound refuses.
import { describe, expect, it } from "vitest";
import { RESULT_MAX, runScript, workerId, wrapScript } from "../../packages/agent/src/code/run.ts";
import { FakeLoader } from "./support/fake-loader.ts";
import people from "../fixtures/people.json" with { type: "json" };

const soloSam = people.companies[0]!.id;
const otherTenant = "other-tenant";
const ada = people.people.find((p) => p.id === "sam-solo")!.email;
const outbound = { fetch: async () => new Response("refused", { status: 403 }) } as unknown as Fetcher;
const surrogate = async () => ({ ok: false as const, code: "VAULT_CRED_UNKNOWN", reason: "none here" });

describe("[M3.1] code mode sandbox", () => {
  it("the same script executed twice loads one Dynamic Worker; another script or tenant loads another", async () => {
    const loader = new FakeLoader();
    const deps = { loader, tenant: soloSam, person: ada, outbound, surrogate };
    const first = await runScript(deps, { script: "return input.n * 2;", input: { n: 21 } });
    const second = await runScript(deps, { script: "return input.n * 2;", input: { n: 5 } });
    expect(first).toMatchObject({ ok: true, result: 42, loaded: true });
    expect(second).toMatchObject({ ok: true, result: 10, loaded: false });
    expect(first.ok && second.ok && first.workerId === second.workerId).toBe(true);
    expect(loader.loads).toHaveLength(1);

    const other = await runScript(deps, { script: "return input.n * 3;", input: { n: 2 } });
    const elsewhere = await runScript({ ...deps, tenant: otherTenant }, { script: "return input.n * 2;", input: { n: 1 } });
    expect(other).toMatchObject({ ok: true, result: 6, loaded: true });
    expect(elsewhere).toMatchObject({ ok: true, result: 2, loaded: true });
    expect(loader.loads).toHaveLength(3);
    expect(new Set(loader.loads).size).toBe(3);
    expect(loader.loads[0]!.startsWith(`${soloSam}:`)).toBe(true);
    expect(loader.loads[2]!.startsWith(`${otherTenant}:`)).toBe(true);
    // The id is a hash of the person, the whole module and its config, with the tenant in front.
    expect(await workerId(soloSam, ada, wrapScript("return input.n * 2;"))).toBe(first.ok ? first.workerId : "");
  });

  it("captures console output, and reports a throw, a syntax error, a non-JSON result and an oversized result by code", async () => {
    const loader = new FakeLoader();
    const deps = { loader, tenant: soloSam, person: ada, outbound, surrogate };
    expect(await runScript(deps, { script: 'console.log("step", { a: 1 }); return "ok";' })).toMatchObject({ ok: true, result: "ok", logs: ['step {"a":1}'] });
    expect(await runScript(deps, { script: 'console.log("before"); throw new Error("boom");' })).toMatchObject({ ok: false, code: "CODE_SCRIPT_THREW", reason: "boom", logs: ["before"] });
    expect(await runScript(deps, { script: "return (;" })).toMatchObject({ ok: false, code: "CODE_LOAD_FAILED" });
    expect(await runScript(deps, { script: "return 1n;" })).toMatchObject({ ok: false, code: "CODE_RESULT_NOT_JSON" });
    expect(await runScript(deps, { script: `return "x".repeat(${RESULT_MAX});` })).toMatchObject({ ok: false, code: "CODE_RESULT_TOO_LARGE" });
    expect(await runScript(deps, { script: "   " })).toMatchObject({ ok: false, code: "CODE_SCRIPT_EMPTY" });
  });
});
