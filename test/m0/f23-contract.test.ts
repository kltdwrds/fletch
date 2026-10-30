// F23: the P2 contract is checked against its own task files, as F20's check holds P1 (`test/m0/f20-contract.test.ts`
// plants each of the check's guards; they are not repeated here). Thirteen clauses and fifteen tasks, each task's
// file under `test/evals/p2-loop/`; every clause cites evidence, every file exists, loads and matches its block; and
// every task's `version_hash` is filled and is its file's hash as the tier-2 runner computes it (Q14).
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkContract, type Finding, parseContract, type TaskLoader } from "../support/contract.ts";
import { staleHashes } from "../support/task-hashes.ts";
import { repoRoot } from "../support/temp-repo.ts";

const CONTRACT = "docs/plan-v2/contracts/P2-loop.md";
const text = () => readFileSync(join(repoRoot, CONTRACT), "utf8");

const disk: TaskLoader = {
  exists: (file) => existsSync(join(repoRoot, file)),
  load: async (file) => {
    const m = (await import(join(repoRoot, file))) as { default?: { id?: string; clauses?: string[]; versionHash?: () => string } };
    const d = m.default;
    return d && typeof d.id === "string" && Array.isArray(d.clauses) && typeof d.versionHash === "function" ? { id: d.id, clauses: d.clauses } : null;
  },
};

const ids = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix}-${String(i + 1).padStart(2, "0")}`);

describe("[F23] the P2 contract", () => {
  it("parses thirteen clauses and fifteen tasks, each task with its file under test/evals/p2-loop/", () => {
    const c = parseContract(text());
    expect(c.clauses.map((x) => x.id)).toEqual(ids("B-P2", 13));
    expect(c.tasks.map((x) => x.id)).toEqual(ids("T-P2", 15));
    expect(c.tasks.every((t) => t.file?.startsWith("test/evals/p2-loop/") && t.file.endsWith(".task.ts"))).toBe(true);
  });

  it("holds: every clause has evidence, every task file exists, loads and matches its block, and the Scorecard has a row", async () => {
    const findings: Finding[] = await checkContract(parseContract(text()), disk);
    expect(findings.map((f) => `${f.code} ${f.id}: ${f.detail}`)).toEqual([]);
  });

  it("every version_hash is filled and is its file's hash under Node's loader; an unfilled or stale one is named", () => {
    const contract = text();
    expect(contract).not.toContain("version_hash: (Build)");
    expect(staleHashes(contract)).toEqual([]);
    // Planted: T-P2-01's line put back to (Build) is caught by id.
    const t1 = /T-P2-01[\s\S]*?version_hash: (\S+)/.exec(contract)?.[1] as string;
    expect(staleHashes(contract.replace(`version_hash: ${t1}`, "version_hash: (Build)"))).toEqual([`T-P2-01 (Build) ${t1}`]);
  });
});
