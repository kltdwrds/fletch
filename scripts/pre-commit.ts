// The pre-commit hook (harness-conventions.md; installed by simple-git-hooks from package.json):
// applies Biome's safe fixes to the staged files, then runs the secret scan and the privacy scan
// (acceptance-checks.md steps 5 and 6) over the index, so a leak is refused before it is committed.
// When a design input or a generated file (`tokens.ts`, `icons.ts`) is staged (M26.1, M27.1), it compiles the
// staged design files with scripts/ds-tokens.ts and refuses a staged output that differs from that fresh run.
//
// A file staged whole is fixed and re-staged. A file with unstaged changes as well is linted without
// fixing, because re-staging it would commit hunks the author left out. Findings name a file, a line
// and a rule, never the matched text.
import { spawnSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { compileDesign, DS_INPUTS, DS_OUTPUTS, staleOutputs } from "./ds-tokens.ts";
import { privacyScan, secretScan, stagedIndex } from "./scans.ts";

function git(args: string[], cwd: string): string {
  const res = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (res.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${res.stderr}`);
  return res.stdout;
}

const list = (out: string) => out.split("\0").filter(Boolean);

function biome(root: string, args: string[], files: string[]): { ok: boolean; out: string } {
  const bin = join(root, "node_modules/.bin/biome");
  const res = spawnSync(bin, ["lint", ...args, "--no-errors-on-unmatched", "--files-ignore-unknown=true", "--", ...files], { cwd: root, encoding: "utf8" });
  return { ok: res.status === 0, out: `${res.stdout ?? ""}${res.stderr ?? ""}`.trim() };
}

/** Whether the staged generated files are what the compiler makes of the staged design files. */
function stagedTokens(root: string): { ok: true } | { ok: false; reason: string } {
  const read = (path: string) => {
    const res = spawnSync("git", ["show", `:${path}`], { cwd: root });
    if (res.status !== 0) throw new Error(`${path} is not in the index`);
    return res.stdout;
  };
  try {
    const stale = staleOutputs(compileDesign(read), (p) => {
      try {
        return read(p).toString("utf8");
      } catch {
        return null;
      }
    });
    if (!stale.length) return { ok: true };
    return { ok: false, reason: `${stale.join(" and ")} differs from a fresh run of scripts/ds-tokens.ts over the staged design files; it is generated, so run pnpm ds and stage it` };
  } catch (e) {
    return { ok: false, reason: `the design files could not be compiled: ${String((e as Error).message ?? e).slice(0, 200)}` };
  }
}

export function preCommit(root: string): { ok: boolean; refused?: string; lines: string[] } {
  const lines: string[] = [];
  const staged = list(git(["diff", "--cached", "--name-only", "-z", "--diff-filter=ACMR"], root)).filter(
    (f) => existsSync(join(root, f)) && statSync(join(root, f)).isFile(),
  );
  const unstaged = new Set(list(git(["diff", "--name-only", "-z"], root)));
  const whole = staged.filter((f) => !unstaged.has(f));
  const partial = staged.filter((f) => unstaged.has(f));

  if (whole.length) {
    const fix = biome(root, ["--write"], whole);
    git(["add", "--", ...whole], root);
    if (!fix.ok) return { ok: false, refused: "lint", lines: [...lines, fix.out] };
  }
  if (partial.length) {
    const check = biome(root, [], partial);
    if (!check.ok) return { ok: false, refused: "lint", lines: [...lines, check.out] };
  }
  lines.push(`pre-commit: biome safe fixes over ${whole.length} staged file(s), ${partial.length} partly staged file(s) linted`);

  if (staged.some((f) => DS_OUTPUTS.includes(f) || DS_INPUTS.includes(f))) {
    const tokens = stagedTokens(root);
    lines.push(`pre-commit: tokens: ${tokens.ok ? `${DS_OUTPUTS.join(" and ")} are a fresh run of scripts/ds-tokens.ts` : tokens.reason}`);
    if (!tokens.ok) return { ok: false, refused: "tokens", lines };
  }

  const index = stagedIndex(root);
  const secret = secretScan(root, join(root, ".dev.vars"), index);
  for (const f of secret.findings) lines.push(`  ${f.file}:${f.line} ${f.rule}`);
  lines.push(`pre-commit: secret scan: ${secret.files} staged files, ${secret.findings.length} findings`);
  if (secret.findings.length) return { ok: false, refused: "secret scan", lines };

  const privacy = privacyScan(root, index);
  for (const f of privacy.findings) lines.push(`  ${f.file}:${f.line} ${f.rule}`);
  lines.push(`pre-commit: privacy scan: ${privacy.files} staged files, ${privacy.findings.length} findings`);
  if (privacy.findings.length) return { ok: false, refused: "privacy scan", lines };
  return { ok: true, lines };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const root = git(["rev-parse", "--show-toplevel"], process.cwd()).trim();
  const result = preCommit(root);
  for (const line of result.lines) console.log(line);
  if (!result.ok) {
    console.log(`pre-commit: REFUSED (${result.refused}). Fix what it reports; never bypass the hook.`);
    process.exitCode = 1;
  }
}
