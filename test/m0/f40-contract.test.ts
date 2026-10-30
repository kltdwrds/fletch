// F40: the P14 contract is checked against its own task files, as F38 holds P12 (`test/m0/f20-contract.test.ts` plants
// each of the check's guards; they are not repeated here). Twelve clauses and fourteen tasks, each task's file under
// `test/evals/p14-identity/`; every clause cites evidence, every file exists, loads and matches its block; and every
// tier-1 task F40 runs (T-P14-01 to 03 and 05 to 09) has its `version_hash` filled with its file's hash as the tier-2
// runner computes it (Q14). T-P14-04 (the Security pane) and the tier-2 tasks (T-P14-10 to 14) are hashed by F41. The
// operating block, with delta 1's identity section, stays under its cap (D-0019).
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { byteLength, OPERATING_BLOCK_MAX_BYTES, renderOperatingBlock, TABLES } from "../../packages/agent/src/chat/operating-block.ts";
import { checkContract, type Finding, parseContract, type TaskLoader } from "../support/contract.ts";
import { staleHashes } from "../support/task-hashes.ts";
import { repoRoot } from "../support/temp-repo.ts";

const CONTRACT = "docs/plan-v2/contracts/P14-identity.md";
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
// F40's tier-1 runs: every tier-1 task of the contract but the Security pane's (F41).
const TIER1 = new Set(["01", "02", "03", "05", "06", "07", "08", "09"].map((n) => `T-P14-${n}`));
const tier1Stale = (contract: string) => staleHashes(contract).filter((l) => TIER1.has(l.split(" ")[0] as string));

describe("[F40] the P14 contract", () => {
  it("parses twelve clauses and fourteen tasks, each task with its file under test/evals/p14-identity/", () => {
    const c = parseContract(text());
    expect(c.clauses.map((x) => x.id)).toEqual(ids("B-P14", 12));
    expect(c.tasks.map((x) => x.id)).toEqual(ids("T-P14", 14));
    expect(c.tasks.every((t) => t.file?.startsWith("test/evals/p14-identity/") && t.file.endsWith(".task.ts"))).toBe(true);
  });

  it("holds: every clause has evidence, every task file exists, loads and matches its block, and the Scorecard has a row", async () => {
    const findings: Finding[] = await checkContract(parseContract(text()), disk);
    expect(findings.map((f) => `${f.code} ${f.id}: ${f.detail}`)).toEqual([]);
    // Planted: a clause that names a task no block defines is caught by the clause's id.
    const planted = parseContract(text().replace("tasks: T-P14-02, T-P14-12\n", "tasks: T-P14-02, T-P14-12, T-P14-99\n"));
    expect((await checkContract(planted, disk)).map((f) => `${f.code} ${f.id}`)).toEqual(["CONTRACT_TASK_UNKNOWN B-P14-03"]);
  });

  it("every tier-1 version_hash F40 runs is filled and is its file's hash under Node's loader; an unfilled or stale one is named", () => {
    const contract = text();
    expect(tier1Stale(contract)).toEqual([]);
    // T-P14-04 waits for F41.
    expect(/T-P14-04 [\s\S]*?version_hash: (.+)/.exec(contract)?.[1]).toBe("unfilled (F41)");
    // Planted: T-P14-01's line put back to unfilled is caught by id.
    const t1 = /T-P14-01 [\s\S]*?version_hash: (\S+)/.exec(contract)?.[1] as string;
    expect(t1).toMatch(/^[0-9a-f]{12}$/);
    expect(tier1Stale(contract.replace(`version_hash: ${t1}`, "version_hash: unfilled"))).toEqual([`T-P14-01 unfilled ${t1}`]);
  });

  it("the operating block carries delta 1's identity section and stays under its 6 KiB cap (D-0019); without the section the lines are gone", () => {
    const block = renderOperatingBlock();
    expect(byteLength(block)).toBeLessThanOrEqual(OPERATING_BLOCK_MAX_BYTES);
    expect(block).toContain("Identity and sign-in");
    expect(block).toContain("never claim to be them");
    // Planted: the block rendered without the identity section has none of its lines.
    const without = renderOperatingBlock({ ...TABLES, sections: TABLES.sections.filter((s) => s.id !== "identity") });
    expect([without.includes("Identity and sign-in"), without.includes("never claim to be them")]).toEqual([false, false]);
  });
});
