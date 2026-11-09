// F100: the P11 contract is checked against its own task files, as F40 holds P14 (`test/m0/f20-contract.test.ts`
// plants each of the check's guards; they are not repeated here). Seventeen clauses and eighteen tasks, each task's file
// under `test/evals/p11-files/`; every clause cites evidence, every file exists, loads and matches its block; and every
// task's `version_hash` is filled with its file's hash as the tier-2 runner computes it (Q14). F100 runs the tier-1 tasks
// T-P11-01 to 04, 06, 08 to 10, 13 and 14; the other tasks' files are hashed here too, and their parts (F101 to F103)
// re-hash any file they change.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkContract, type Finding, parseContract, type TaskLoader } from "../support/contract.ts";
import { staleHashes } from "../support/task-hashes.ts";
import { repoRoot } from "../support/temp-repo.ts";

const CONTRACT = "docs/plan-v2/contracts/P11-files-documents.md";
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
/** F100's tier-1 runs. */
const TIER1 = new Set(["01", "02", "03", "04", "06", "08", "09", "10", "13", "14"].map((n) => `T-P11-${n}`));

describe("[F100] the P11 contract", () => {
  it("parses seventeen clauses and eighteen tasks, each task with its file under test/evals/p11-files/", () => {
    const c = parseContract(text());
    expect(c.clauses.map((x) => x.id)).toEqual(ids("B-P11", 17));
    expect(c.tasks.map((x) => x.id)).toEqual(ids("T-P11", 18));
    expect(c.tasks.every((t) => t.file?.startsWith("test/evals/p11-files/") && t.file.endsWith(".task.ts"))).toBe(true);
  });

  it("holds: every clause has evidence, every task file exists, loads and matches its block, and the Scorecard has a row", async () => {
    const findings: Finding[] = await checkContract(parseContract(text()), disk);
    expect(findings.map((f) => `${f.code} ${f.id}: ${f.detail}`)).toEqual([]);
    // Planted: a clause that names a task no block defines is caught by the clause's id.
    const planted = parseContract(text().replace("tasks: T-P11-02\n", "tasks: T-P11-02, T-P11-99\n"));
    expect((await checkContract(planted, disk)).map((f) => `${f.code} ${f.id}`)).toEqual(["CONTRACT_TASK_UNKNOWN B-P11-02"]);
  });

  it("every version_hash is filled and is its file's hash under Node's loader; an unfilled or stale one is named", () => {
    const contract = text();
    expect(staleHashes(contract)).toEqual([]);
    // Planted: T-P11-01's line put back to "filled by F100" is caught by id.
    const t1 = /T-P11-01 [\s\S]*?version_hash: (\S+)/.exec(contract)?.[1] as string;
    expect(t1).toMatch(/^[0-9a-f]{12}$/);
    expect(staleHashes(contract.replace(`version_hash: ${t1}`, "version_hash: filled by F100"))).toEqual([`T-P11-01 filled ${t1}`]);
    // Every tier-1 task F100 runs is tagged tier 1 in its block.
    expect(parseContract(contract).tasks.filter((t) => TIER1.has(t.id)).length).toBe(10);
  });
});
