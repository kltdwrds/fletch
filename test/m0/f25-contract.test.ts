// F25: the P15 contract is checked against its own task files, as F23 holds P2 (`test/m0/f20-contract.test.ts`
// plants each of the check's guards; they are not repeated here). Fifteen clauses and sixteen tasks, each task's
// file under `test/evals/p15-approvals/`; every clause cites evidence, every file exists, loads and matches its block; and
// every task's `version_hash` is filled and is its file's hash as the tier-2 runner computes it (Q14).
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkContract, type Finding, parseContract, type TaskLoader } from "../support/contract.ts";
import { staleHashes } from "../support/task-hashes.ts";
import { repoRoot } from "../support/temp-repo.ts";

const CONTRACT = "docs/plan-v2/contracts/P15-approvals.md";
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

describe("[F25] the P15 contract", () => {
  it("parses fifteen clauses and sixteen tasks, each task with its file under test/evals/p15-approvals/", () => {
    const c = parseContract(text());
    expect(c.clauses.map((x) => x.id)).toEqual(ids("B-P15", 15));
    expect(c.tasks.map((x) => x.id)).toEqual(ids("T-P15", 16));
    expect(c.tasks.every((t) => t.file?.startsWith("test/evals/p15-approvals/") && t.file.endsWith(".task.ts"))).toBe(true);
  });

  it("holds: every clause has evidence, every task file exists, loads and matches its block, and the Scorecard has a row", async () => {
    const findings: Finding[] = await checkContract(parseContract(text()), disk);
    expect(findings.map((f) => `${f.code} ${f.id}: ${f.detail}`)).toEqual([]);
  });

  it("every version_hash is filled and is its file's hash under Node's loader; an unfilled or stale one is named", () => {
    const contract = text();
    expect(contract).not.toContain("version_hash: (F25)");
    expect(staleHashes(contract)).toEqual([]);
    // Planted: T-P15-01's line put back to (F25) is caught by id.
    const t1 = /T-P15-01[\s\S]*?version_hash: (\S+)/.exec(contract)?.[1] as string;
    expect(staleHashes(contract.replace(`version_hash: ${t1}`, "version_hash: (F25)"))).toEqual([`T-P15-01 (F25) ${t1}`]);
  });
});
