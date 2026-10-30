// F35: the P9 contract is checked against its own task files, as F33 holds P3 (`test/m0/f20-contract.test.ts` plants
// each of the check's guards; they are not repeated here). Fourteen clauses and eighteen tasks, each task's file under
// `test/evals/p9-connectors/`; every clause cites evidence, every file exists, loads and matches its block; and every
// tier-1 task (F35's T-P9-01, 03 to 07, 11, 12 and 18, and F36's T-P9-02, 08, 09 and 10) has its `version_hash`
// filled with its file's hash as the tier-2 runner computes it (Q14). The tier-2 tasks (T-P9-13 to 17) are hashed when
// they are first graded on a slot (F37).
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkContract, type Finding, parseContract, type TaskLoader } from "../support/contract.ts";
import { staleHashes } from "../support/task-hashes.ts";
import { repoRoot } from "../support/temp-repo.ts";

const CONTRACT = "docs/plan-v2/contracts/P9-connectors.md";
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
// F35's tier-1 runs and F36's four (T-P9-02, 08, 09, 10): every tier-1 task of the contract.
const TIER1 = new Set(["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12", "18"].map((n) => `T-P9-${n}`));
const tier1Stale = (contract: string) => staleHashes(contract).filter((l) => TIER1.has(l.split(" ")[0] as string));

describe("[F35] the P9 contract", () => {
  it("parses fourteen clauses and eighteen tasks, each task with its file under test/evals/p9-connectors/", () => {
    const c = parseContract(text());
    expect(c.clauses.map((x) => x.id)).toEqual(ids("B-P9", 14));
    expect(c.tasks.map((x) => x.id)).toEqual(ids("T-P9", 18));
    expect(c.tasks.every((t) => t.file?.startsWith("test/evals/p9-connectors/") && t.file.endsWith(".task.ts"))).toBe(true);
  });

  it("holds: every clause has evidence, every task file exists, loads and matches its block, and the Scorecard has a row", async () => {
    const findings: Finding[] = await checkContract(parseContract(text()), disk);
    expect(findings.map((f) => `${f.code} ${f.id}: ${f.detail}`)).toEqual([]);
    // Planted: a clause that names a task no block defines is caught by the clause's id.
    const planted = parseContract(text().replace("tasks: T-P9-01, T-P9-13\n", "tasks: T-P9-01, T-P9-13, T-P9-99\n"));
    expect((await checkContract(planted, disk)).map((f) => `${f.code} ${f.id}`)).toEqual(["CONTRACT_TASK_UNKNOWN B-P9-01"]);
  });

  it("every tier-1 version_hash is filled and is its file's hash under Node's loader; an unfilled or stale one is named", () => {
    const contract = text();
    expect(tier1Stale(contract)).toEqual([]);
    // Planted: T-P9-01's line put back to unset is caught by id.
    const t1 = /T-P9-01 [\s\S]*?version_hash: (\S+)/.exec(contract)?.[1] as string;
    expect(t1).toMatch(/^[0-9a-f]{12}$/);
    expect(tier1Stale(contract.replace(`version_hash: ${t1}`, "version_hash: unset"))).toEqual([`T-P9-01 unset ${t1}`]);
  });
});
