// F27: the P6 contract is checked against its own task files, as F25 holds P15 (`test/m0/f20-contract.test.ts`
// plants each of the check's guards; they are not repeated here). Fifteen clauses and fourteen tasks, each task's
// file under `test/evals/p6-memory/`; every clause cites evidence, every file exists, loads and matches its block; and
// every task's `version_hash` is filled and is its file's hash as the tier-2 runner computes it (Q14).
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkContract, type Finding, parseContract, type TaskLoader } from "../support/contract.ts";
import { staleHashes } from "../support/task-hashes.ts";
import { repoRoot } from "../support/temp-repo.ts";

const CONTRACT = "docs/plan-v2/contracts/P6-memory.md";
const text = () => readFileSync(join(repoRoot, CONTRACT), "utf8");

const disk: TaskLoader = {
  exists: (file) => existsSync(join(repoRoot, file)),
  load: async (file) => {
    const m = (await import(join(repoRoot, file))) as { default?: { id?: string; clauses?: string[]; versionHash?: () => string } };
    const d = m.default;
    return d && typeof d.id === "string" && Array.isArray(d.clauses) && typeof d.versionHash === "function" ? { id: d.id, clauses: d.clauses } : null;
  },
};

/** B-P6-12 is graded under P15 (T-P15-08, T-P15-12): a task of another cluster is known when its contract has its block. */
const P15 = "docs/plan-v2/contracts/P15-approvals.md";
const foreign = (id: string) => id.startsWith("T-P15-") && parseContract(readFileSync(join(repoRoot, P15), "utf8")).tasks.some((t) => t.id === id);

const ids = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix}-${String(i + 1).padStart(2, "0")}`);

describe("[F27] the P6 contract", () => {
  it("parses fifteen clauses and fourteen tasks, each task with its file under test/evals/p6-memory/", () => {
    const c = parseContract(text());
    expect(c.clauses.map((x) => x.id)).toEqual(ids("B-P6", 15));
    expect(c.tasks.map((x) => x.id)).toEqual(ids("T-P6", 14));
    expect(c.tasks.every((t) => t.file?.startsWith("test/evals/p6-memory/") && t.file.endsWith(".task.ts"))).toBe(true);
  });

  it("holds: every clause has evidence, every task file exists, loads and matches its block, and the Scorecard has a row", async () => {
    const findings: Finding[] = await checkContract(parseContract(text()), { ...disk, foreign });
    expect(findings.map((f) => `${f.code} ${f.id}: ${f.detail}`)).toEqual([]);
    // Planted: a P15 task P15 does not define is still unknown, and without the P15 lookup both of B-P6-12's are.
    const planted = parseContract(text().replace("tasks: T-P15-08, T-P15-12", "tasks: T-P15-08, T-P15-99"));
    expect((await checkContract(planted, { ...disk, foreign })).map((f) => `${f.code} ${f.id}`)).toEqual(["CONTRACT_TASK_UNKNOWN B-P6-12"]);
    expect((await checkContract(parseContract(text()), disk)).map((f) => `${f.code} ${f.id}`)).toEqual(["CONTRACT_TASK_UNKNOWN B-P6-12", "CONTRACT_TASK_UNKNOWN B-P6-12"]);
  });

  it("every version_hash is filled and is its file's hash under Node's loader; an unfilled or stale one is named", () => {
    const contract = text();
    expect(contract).not.toContain("version_hash: (F27)");
    expect(contract).not.toContain("version_hash: (F28)");
    expect(staleHashes(contract)).toEqual([]);
    // Planted: T-P6-01's line put back to (F27) is caught by id.
    const t1 = /T-P6-01[\s\S]*?version_hash: (\S+)/.exec(contract)?.[1] as string;
    expect(staleHashes(contract.replace(`version_hash: ${t1}`, "version_hash: (F27)"))).toEqual([`T-P6-01 (F27) ${t1}`]);
  });
});
