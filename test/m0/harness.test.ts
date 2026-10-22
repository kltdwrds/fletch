// M0.2's acceptance claims, each on the production path: the harness check scripts run as accept runs
// them, against a temporary repository with the violation planted; the network probe runs under the
// hermetic config in a child vitest; the pre-commit hook is installed by simple-git-hooks from
// package.json into a temporary clone and refuses a real `git commit`.
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { hermeticEnv } from "../../scripts/accept.ts";
import { hermeticNetwork } from "../support/hermetic-network.ts";
import { GIT_ENV, git, repoRoot, tempRepo } from "../support/temp-repo.ts";

const cleanups: (() => void)[] = [];
afterAll(() => {
  for (const c of cleanups) c();
});

/** Runs a harness check script from this repository against `cwd`, as accept's step 9 does. */
function check(script: string, cwd: string, env: NodeJS.ProcessEnv = process.env) {
  const res = spawnSync(process.execPath, [join(repoRoot, "scripts", script)], { cwd, env, encoding: "utf8" });
  return { status: res.status, out: `${res.stdout}${res.stderr}` };
}

function planted(files: Record<string, string>) {
  const repo = tempRepo();
  cleanups.push(repo.cleanup);
  for (const [path, content] of Object.entries(files)) repo.track(path, content);
  return repo.dir;
}

const lines = (n: number) => `${Array.from({ length: n }, (_, i) => `export const v${i} = ${i};`).join("\n")}\n`;

describe("[M0.2] harness checks", () => {
  it("pass on this repository", () => {
    for (const script of ["check-boundaries.mjs", "check-file-sizes.mjs", "check-test-hygiene.mjs"]) {
      const r = check(script, repoRoot);
      expect(r.out).toMatch(/0 violation\(s\)/);
      expect(r.status).toBe(0);
    }
  });

  it("boundary check fails on a planted import of the agent under packages/host/src", () => {
    const dir = planted({ "packages/host/src/index.ts": 'import { serve } from "fletch-agent";\nexport { serve };\n' });
    const r = check("check-boundaries.mjs", dir);
    expect(r.status).toBe(1);
    expect(r.out).toMatch(/packages\/host\/src\/index\.ts:1: no-fletch: fletch-agent/);
  });

  it("test-hygiene check fails on a planted .only", () => {
    const dir = planted({ "test/m1/chat.test.ts": 'import { describe, it } from "vitest";\ndescribe("[M1] chat", () => {\n  it.only("replies", () => {});\n});\n' });
    const r = check("check-test-hygiene.mjs", dir);
    expect(r.status).toBe(1);
    expect(r.out).toMatch(/test\/m1\/chat\.test\.ts:3: focused-test/);
  });

  it("file-size ratchet fails on a planted 601-line file under packages/, against the base commit", () => {
    const repo = tempRepo();
    cleanups.push(repo.cleanup);
    git(repo.dir, ["commit", "--quiet", "-m", "base"]);
    repo.track("packages/agent/src/big.ts", lines(601));
    repo.track("packages/agent/src/ok.ts", lines(600));
    const r = check("check-file-sizes.mjs", repo.dir, { ...process.env, CHECK_FILE_SIZES_BASE: "HEAD" });
    expect(r.status).toBe(1);
    expect(r.out).toMatch(/packages\/agent\/src\/big\.ts: 601 lines; the cap is 600/);
    expect(r.out).not.toMatch(/ok\.ts/);
  });
});

/** Runs one test of the network probe in a child vitest under the hermetic config. */
function networkProbe(test: string) {
  const res = spawnSync(join(repoRoot, "node_modules/.bin/vitest"), ["run", "--config", "test/support/probes/vitest.probe.config.ts", "network.probe", "-t", test], {
    cwd: repoRoot,
    env: hermeticEnv(),
    encoding: "utf8",
  });
  return { status: res.status, out: `${res.stdout}${res.stderr}` };
}

describe("[M0.2] network interceptor", () => {
  it("an unmatched outbound fetch fails the test through the network interceptor", () => {
    const control = networkProbe("makes no request");
    expect(control.status).toBe(0);

    const awaited = networkProbe("awaits an unmatched fetch");
    expect(awaited.status).not.toBe(0);
    expect(awaited.out).toMatch(/Unmocked outbound request: GET https:\/\/unmatched\.example\/awaited/);

    // Swallowing the error does not help: the afterAll escape assertion fails the file.
    const swallowed = networkProbe("swallows an unmatched fetch");
    expect(swallowed.status).not.toBe(0);
    expect(swallowed.out).toMatch(/HERMETIC_NETWORK_ESCAPE: 1 unmatched outbound request\(s\): GET https:\/\/unmatched\.example\/swallowed/);
  }, 60_000);

  it("is the fetch this process sees, with loopback denied too", async () => {
    await expect(fetch("http://127.0.0.1:9/")).rejects.toThrow(/^Unmocked outbound request: GET http:\/\/127\.0\.0\.1:9\//);
    expect(hermeticNetwork.takeUnmockedCalls("127.0.0.1:9")).toEqual(["GET http://127.0.0.1:9/"]);
  });
});

/** The files the hook needs, copied from this working tree so an uncommitted change is what runs. */
const HOOK_FILES = ["package.json", "biome.json", ".gitignore", "scripts/pre-commit.ts", "scripts/ds-tokens.ts", "scripts/scans.ts", "scripts/lib/secret-patterns.ts", "scripts/privacy-denylist.txt", "test/fixtures/people.json"];

function cloneWithHooks(): string {
  const dir = mkdtempSync(join(tmpdir(), "qyvr-precommit-"));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  git(tmpdir(), ["clone", "--quiet", "--depth", "1", `file://${repoRoot}`, dir]);
  for (const f of HOOK_FILES) {
    mkdirSync(dirname(join(dir, f)), { recursive: true });
    copyFileSync(join(repoRoot, f), join(dir, f));
  }
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "--quiet", "--allow-empty", "-m", "test: the working tree's hook files"]);
  writeFileSync(join(dir, ".git/info/exclude"), "/node_modules\n");
  symlinkSync(join(repoRoot, "node_modules"), join(dir, "node_modules"));
  // simple-git-hooks installs the hook from package.json, exactly as `pnpm install`'s prepare does.
  const install = spawnSync(process.execPath, [join(dir, "node_modules/simple-git-hooks/cli.js")], { cwd: dir, encoding: "utf8", env: GIT_ENV });
  expect(install.stdout).toMatch(/Successfully set the pre-commit with command: node scripts\/pre-commit\.ts/);
  return dir;
}

function commit(dir: string, message: string) {
  const res = spawnSync("git", ["commit", "-m", message], { cwd: dir, encoding: "utf8", env: GIT_ENV });
  return { status: res.status, out: `${res.stdout}${res.stderr}` };
}

const fakeKey = () => readFileSync(join(repoRoot, "test/fixtures/fake-secrets/planted.txt"), "utf8").split("\n").find((l) => l.startsWith("github: ")) as string;

describe("[M0.2] pre-commit hook", () => {
  it("pre-commit hook refuses a commit with a planted fake key in a temporary clone", () => {
    const dir = cloneWithHooks();
    const head = git(dir, ["rev-parse", "HEAD"]);

    writeFileSync(join(dir, "notes.md"), `${fakeKey()}\n`);
    git(dir, ["add", "notes.md"]);
    const refused = commit(dir, "docs: notes");
    expect(refused.status).not.toBe(0);
    expect(refused.out).toMatch(/notes\.md:1 github-token/);
    expect(refused.out).toMatch(/pre-commit: REFUSED \(secret scan\)/);
    expect(refused.out).not.toContain(fakeKey().slice("github: ".length));
    expect(git(dir, ["rev-parse", "HEAD"])).toBe(head);

    // The index is what is scanned: cleaning the working tree but not the stage is still refused.
    writeFileSync(join(dir, "notes.md"), "clean now\n");
    const stillStaged = commit(dir, "docs: notes");
    expect(stillStaged.status).not.toBe(0);
    expect(stillStaged.out).toMatch(/notes\.md:1 github-token/);
    expect(git(dir, ["rev-parse", "HEAD"])).toBe(head);
  }, 120_000);

  it("pre-commit hook applies Biome's safe fixes to staged files and lets a clean commit through", () => {
    const dir = cloneWithHooks();
    mkdirSync(join(dir, "packages/agent/src"), { recursive: true });
    writeFileSync(join(dir, "packages/agent/src/fixable.ts"), "let total = 1;\nexport const doubled = total * 2;\n");
    git(dir, ["add", "packages/agent/src/fixable.ts"]);
    const ok = commit(dir, "feat: fixable");
    expect(ok.out).toMatch(/pre-commit: secret scan: \d+ staged files, 0 findings/);
    expect(ok.out).toMatch(/pre-commit: privacy scan: \d+ staged files, 0 findings/);
    expect(ok.status).toBe(0);
    expect(git(dir, ["show", "HEAD:packages/agent/src/fixable.ts"])).toBe("const total = 1;\nexport const doubled = total * 2;");
    expect(git(dir, ["status", "--porcelain"])).toBe("");
  }, 120_000);
});
