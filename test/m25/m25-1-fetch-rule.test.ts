// M25.1 item 5, the audit rule: the agent script's only `fetch` callers are the egress module and named
// bindings. The boundary check's `agent-fetch` rule, run as accept's harness step runs it, against this
// repository (clean) and against a temporary repository with each violation planted: a connector that
// fetches on its own, an alias of the global, and the platform channels as they stood before M25.1.
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { repoRoot, tempRepo } from "../support/temp-repo.ts";

describe("[M25.1] the agent-fetch rule", () => {
  const cleanups: Array<() => void> = [];
  afterAll(() => {
    for (const c of cleanups) c();
  });
  const check = (cwd: string) => {
    const res = spawnSync(process.execPath, [join(repoRoot, "scripts", "check-boundaries.mjs")], { cwd, encoding: "utf8" });
    return { status: res.status, out: `${res.stdout}${res.stderr}` };
  };
  const planted = (files: Record<string, string>) => {
    const repo = tempRepo();
    cleanups.push(repo.cleanup);
    for (const [path, content] of Object.entries(files)) repo.track(path, content);
    return repo.dir;
  };

  it("a fetch outside the egress module and named bindings fails the boundary check with its file and line", () => {
    const connector = check(planted({ "packages/agent/src/connectors/weather.ts": "export const read = async (city: string) => (await fetch(\"https://weather.example/\" + city)).json();\n" }));
    expect(connector.status).toBe(1);
    expect(connector.out).toMatch(/packages\/agent\/src\/connectors\/weather\.ts:1: agent-fetch: fetch\(/);
    const alias = check(planted({ "packages/agent/src/code/tool.ts": "const net = globalThis.fetch;\nexport const go = (u: string) => net(u);\n" }));
    expect(alias.status).toBe(1);
    expect(alias.out).toMatch(/packages\/agent\/src\/code\/tool\.ts:1: agent-fetch: globalThis\.fetch/);
    const vault = check(planted({ "packages/agent/src/objects/vault.ts": "const deps = {\n  fetch: (url, init) => fetch(url, init),\n};\n" }));
    expect(vault.status).toBe(1);
    expect(vault.out).toMatch(/packages\/agent\/src\/objects\/vault\.ts:2: agent-fetch: fetch\(/);
  });

  it("the egress module's outbound file and a binding's own fetch pass", () => {
    const ok = check(
      planted({
        "packages/agent/src/egress/outbound.ts": "export const egressNetwork = (url: string, init: RequestInit) => fetch(url, init);\n",
        "packages/agent/src/code/tool.ts": 'export const run = (env: Env) => env.SANDBOX.fetch("https://sandbox.internal/run", { method: "POST" });\n',
      }),
    );
    expect(ok).toEqual({ status: 0, out: "check-boundaries: 7 rule(s), 0 violation(s)\n" });
  });

  it("the real agent script passes: every global fetch stands in egress/outbound.ts", () => {
    expect(check(repoRoot)).toEqual({ status: 0, out: "check-boundaries: 7 rule(s), 0 violation(s)\n" });
  });
});
