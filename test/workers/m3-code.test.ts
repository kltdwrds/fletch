// M3.1: Code Mode on Dynamic Workers (D2). The runner (`code/run.ts`, moved from the shared sandbox at
// M25.5) runs under the fake loader with the documented get() caching. Its network, the agent script's
// `Egress` entrypoint, is M25.5's (test/workers/m25-5-code-mode.test.ts); here the outbound refuses.
import { describe, expect, it } from "vitest";
import { RESULT_MAX, runScript, } from "../../packages/agent/src/code/run.ts";
import { FakeLoader } from "./support/fake-loader.ts";
import people from "../fixtures/people.json" with { type: "json" };

const soloSam = people.companies[0]!.id;
const ada = people.people.find((p) => p.id === "sam-solo")!.email;
const outbound = { fetch: async () => new Response("refused", { status: 403 }) } as unknown as Fetcher;
const surrogate = async () => ({ ok: false as const, code: "VAULT_CRED_UNKNOWN", reason: "none here" });

describe("[M3.1] code mode sandbox", () => {

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
