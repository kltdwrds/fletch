// F70: the P13 contract is checked against its own task files, as F35 holds P9 (`test/m0/f20-contract.test.ts` plants
// each of the check's guards; they are not repeated here). Fifteen clauses and sixteen tasks, each task's file under
// `test/evals/p13-voice-audio/`; every clause cites evidence, every file exists, loads and matches its block; and every
// task's `version_hash` (the contract: "Every version_hash is filled by F70 when it writes the file") is its file's hash
// as the tier-2 runner computes it (Q14), the tier-2 task's and the later parts' included: a part that changes a task
// file before its first run refills its line. This is the contract check D-0026 names as its confirmation to come.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkContract, type Finding, parseContract, type TaskLoader } from "../support/contract.ts";
import { staleHashes } from "../support/task-hashes.ts";
import { repoRoot } from "../support/temp-repo.ts";

const CONTRACT = "docs/plan-v2/contracts/P13-voice-audio.md";
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

describe("[F70] the P13 contract", () => {
  it("parses fifteen clauses and sixteen tasks, each task with its file under test/evals/p13-voice-audio/", () => {
    const c = parseContract(text());
    expect(c.clauses.map((x) => x.id)).toEqual(ids("B-P13", 15));
    expect(c.tasks.map((x) => x.id)).toEqual(ids("T-P13", 16));
    expect(c.tasks.every((t) => t.file?.startsWith("test/evals/p13-voice-audio/") && t.file.endsWith(".task.ts"))).toBe(true);
  });

  it("holds: every clause has evidence, every task file exists, loads and matches its block, and the Scorecard has a row", async () => {
    const findings: Finding[] = await checkContract(parseContract(text()), disk);
    expect(findings.map((f) => `${f.code} ${f.id}: ${f.detail}`)).toEqual([]);
    // Planted: a clause that names a task no block defines is caught by the clause's id.
    const planted = parseContract(text().replace("  tasks: T-P13-01\n", "  tasks: T-P13-01, T-P13-99\n"));
    expect((await checkContract(planted, disk)).map((f) => `${f.code} ${f.id}`)).toEqual(["CONTRACT_TASK_UNKNOWN B-P13-01"]);
  });

  it("every version_hash is filled and is its file's hash under Node's loader; an unfilled or stale one is named", () => {
    const contract = text();
    expect(contract).not.toContain("filled by F70\n");
    expect(staleHashes(contract)).toEqual([]);
    // Planted: T-P13-13's line put back to unfilled is caught by id.
    const t13 = /T-P13-13 [\s\S]*?version_hash: (\S+)/.exec(contract)?.[1] as string;
    expect(t13).toMatch(/^[0-9a-f]{12}$/);
    expect(staleHashes(contract.replace(`version_hash: ${t13}`, "version_hash: unfilled"))).toEqual([`T-P13-13 unfilled ${t13}`]);
  });
});
