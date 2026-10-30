// A task's `versionHash()` as the tier-2 runner computes it (Q14): under Node's own type stripping, as `pnpm evals`
// loads a task, in a child process. Vitest's transform rewrites a grader's source, so the same file hashes
// differently inside a test. Used by the contract checks to hold each task block's `version_hash` to its file (F22, F23).
import { execFileSync } from "node:child_process";
import { parseContract } from "./contract.ts";
import { repoRoot } from "./temp-repo.ts";

/** Each task file's id and full hash, by repo-relative path. */
export function runnerHashes(files: string[]): Map<string, { id: string; hash: string }> {
  const code = `for (const f of ${JSON.stringify(files)}) { const t = (await import(${JSON.stringify(`${repoRoot}/`)} + f)).default; console.log(JSON.stringify([f, t.id, t.versionHash()])); }`;
  const out = execFileSync(process.execPath, ["--conditions=development", "--input-type=module", "-e", code], { cwd: repoRoot, encoding: "utf8" });
  return new Map(
    out
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l) as [string, string, string])
      .map(([f, id, hash]) => [f, { id, hash }]),
  );
}

/** Each contract task block whose `version_hash` is not the first 12 characters of its file's hash, as `<id> <written> <actual>`. */
export function staleHashes(contract: string): string[] {
  const c = parseContract(contract);
  const lines = contract.split("\n");
  const files = runnerHashes(c.tasks.map((t) => t.file!));
  return c.tasks.flatMap((t) => {
    const end = lines.findIndex((l, i) => i >= t.line && l.trim() === "");
    const written = /version_hash: (\S+)/.exec(lines.slice(t.line - 1, end).join("\n"))?.[1];
    const actual = files.get(t.file!)!.hash.slice(0, 12);
    return written === actual ? [] : [`${t.id} ${written} ${actual}`];
  });
}
