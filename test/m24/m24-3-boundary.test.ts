// M24.3 item 2, the boundary rule: the agent has one file vocabulary, so a second one (a file tool
// defined outside files/tools.ts, the Workspace outside tree/, an edit or grep in the home store)
// fails the boundary check, run as accept's harness step runs it, against this repository and against
// a temporary repository with each violation planted.
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { repoRoot, tempRepo } from "../support/temp-repo.ts";

describe("[M24.3] the boundary rule", () => {
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

  it("a second file vocabulary fails the boundary check: a file_edit tool outside files/tools.ts, a Workspace outside tree/, an edit in the home store", () => {
    const tool = check(planted({ "packages/agent/src/files/r2-edit.ts": 'export const t = { name: "file_edit", kind: "observation" };\n' }));
    expect(tool.status).toBe(1);
    expect(tool.out).toMatch(/packages\/agent\/src\/files\/r2-edit\.ts:1: file-vocabulary: name: "file_edit"/);
    const ws = check(planted({ "packages/agent/src/chat/ws.ts": 'import { Workspace } from "@cloudflare/computer";\nexport { Workspace };\n' }));
    expect(ws.status).toBe(1);
    expect(ws.out).toMatch(/packages\/agent\/src\/chat\/ws\.ts:1: file-vocabulary-workspace: @cloudflare\/computer/);
    const store = check(planted({ "packages/agent/src/files/store.ts": "export class PersonFiles {\n  async grep(pattern: string) { return pattern; }\n}\n" }));
    expect(store.status).toBe(1);
    expect(store.out).toMatch(/packages\/agent\/src\/files\/store\.ts:2: file-vocabulary-store: {3}async grep\(/);
    const ok = check(planted({ "packages/agent/src/files/tools.ts": 'export const t = { name: "file_edit" };\n', "packages/agent/src/tree/rpc.ts": 'import { Workspace } from "@cloudflare/computer";\nexport { Workspace };\n' }));
    expect(ok.status).toBe(0);
  });

  it("the real tree passes the file-vocabulary rules", () => {
    const r = check(repoRoot);
    expect(r.out).toMatch(/check-boundaries: \d+ rule\(s\), 0 violation\(s\)/);
    expect(r.status).toBe(0);
  });
});
