// F31: the P5 contract is checked against its own task files, as F29 holds P7 (`test/m0/f20-contract.test.ts` plants
// each of the check's guards; they are not repeated here). Fourteen clauses and fifteen tasks (B-P5-14 names P7's
// T-P7-13), each task's file under `test/evals/p5-activity/`; every clause cites evidence, every file exists, loads and
// matches its block; and every task's `version_hash` is filled and is its file's hash as the tier-2 runner computes it
// (Q14).
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkContract, type Finding, parseContract, type TaskLoader } from "../support/contract.ts";
import { staleHashes } from "../support/task-hashes.ts";
import { repoRoot } from "../support/temp-repo.ts";

const CONTRACT = "docs/plan-v2/contracts/P5-activity.md";
const P7 = "docs/plan-v2/contracts/P7-scheduling.md";
const text = () => readFileSync(join(repoRoot, CONTRACT), "utf8");
/** B-P5-14 names P7's remove task (T-P7-13), whose block is in P7's contract. */
const foreign = (id: string) => id.startsWith("T-P7-") && parseContract(readFileSync(join(repoRoot, P7), "utf8")).tasks.some((t) => t.id === id);

const disk: TaskLoader = {
  exists: (file) => existsSync(join(repoRoot, file)),
  load: async (file) => {
    const m = (await import(join(repoRoot, file))) as { default?: { id?: string; clauses?: string[]; versionHash?: () => string } };
    const d = m.default;
    return d && typeof d.id === "string" && Array.isArray(d.clauses) && typeof d.versionHash === "function" ? { id: d.id, clauses: d.clauses } : null;
  },
};

const ids = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix}-${String(i + 1).padStart(2, "0")}`);

describe("[F31] the P5 contract", () => {
  it("parses fourteen clauses and fifteen tasks, each task with its file under test/evals/p5-activity/", () => {
    const c = parseContract(text());
    expect(c.clauses.map((x) => x.id)).toEqual(ids("B-P5", 14));
    expect(c.tasks.map((x) => x.id)).toEqual(ids("T-P5", 15));
    expect(c.tasks.every((t) => t.file?.startsWith("test/evals/p5-activity/") && t.file.endsWith(".task.ts"))).toBe(true);
  });

  it("holds: every clause has evidence, every task file exists, loads and matches its block, and the Scorecard has a row", async () => {
    const findings: Finding[] = await checkContract(parseContract(text()), { ...disk, foreign });
    expect(findings.map((f) => `${f.code} ${f.id}: ${f.detail}`)).toEqual([]);
    // Planted: a clause that names a task no block defines is caught by the clause's id.
    const planted = parseContract(text().replace("tasks: T-P5-01, T-P5-15\n", "tasks: T-P5-01, T-P5-15, T-P5-99\n"));
    expect((await checkContract(planted, { ...disk, foreign })).map((f) => `${f.code} ${f.id}`)).toEqual(["CONTRACT_TASK_UNKNOWN B-P5-01"]);
  });

  it("every version_hash is filled and is its file's hash under Node's loader; an unfilled or stale one is named", () => {
    const contract = text();
    expect(contract).not.toContain("version_hash: unset");
    expect(staleHashes(contract)).toEqual([]);
    // Planted: T-P5-01's line put back to unset is caught by id.
    const t1 = /T-P5-01[\s\S]*?version_hash: (\S+)/.exec(contract)?.[1] as string;
    expect(staleHashes(contract.replace(`version_hash: ${t1}`, "version_hash: unset"))).toEqual([`T-P5-01 unset ${t1}`]);
  });
});
