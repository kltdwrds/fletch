// F20: the P1 contract is checked against its own task files. Every clause cites evidence or is attested; every
// task block names a file that exists, loads, carries the block's id and the clauses whose `tasks:` lines name it;
// no id points at a block that is not there; the Scorecard has a row. Each guard is planted on an in-memory contract.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkContract, type Finding, parseContract, type TaskLoader } from "../support/contract.ts";
import { repoRoot } from "../support/temp-repo.ts";

const CONTRACT = "docs/plan-v2/contracts/P1-reactions.md";

/** The task files as they are on disk: a module's default export is its `defineTask` result. */
const disk: TaskLoader = {
  exists: (file) => existsSync(join(repoRoot, file)),
  load: async (file) => {
    const m = (await import(join(repoRoot, file))) as { default?: { id?: string; clauses?: string[]; versionHash?: () => string } };
    const d = m.default;
    return d && typeof d.id === "string" && Array.isArray(d.clauses) && typeof d.versionHash === "function" ? { id: d.id, clauses: d.clauses } : null;
  },
};

const byCode = (f: Finding[]) => f.map((x) => `${x.code} ${x.id}`);

describe("[F20] the P1 contract", () => {
  it("parses eleven clauses and eleven tasks, each task with its file", () => {
    const c = parseContract(readFileSync(join(repoRoot, CONTRACT), "utf8"));
    expect(c.clauses.map((x) => x.id)).toEqual(Array.from({ length: 11 }, (_, i) => `B-P1-${String(i + 1).padStart(2, "0")}`));
    expect(c.tasks.map((x) => x.id)).toEqual(Array.from({ length: 11 }, (_, i) => `T-P1-${String(i + 1).padStart(2, "0")}`));
    expect(c.tasks.every((t) => t.file?.startsWith("test/evals/p1-reactions/"))).toBe(true);
  });

  it("holds: every clause has evidence or is attested, every task file exists, loads and matches its block, and the Scorecard has a row", async () => {
    const findings = await checkContract(parseContract(readFileSync(join(repoRoot, CONTRACT), "utf8")), disk);
    expect(byCode(findings)).toEqual([]);
  });
});

const BASE = `# P9 test — contract

## Clauses

B-P9-01: A clause.
  over-cautious: x     over-bold: y
  evidence: \`answers/step-1.md\` 2a       tags: [instrumented]
  tasks: T-P9-01

## Tasks

T-P9-01  must-have  tier 1
  setup: seed 1
  graders: code   version_hash: (Build)
  file: test/evals/p9/one.task.ts

## Scorecard

level | must-have tasks passing | evidence | last verified
0 | — | none | 2026-10-29
`;

/** A loader over one file, `test/evals/p9/one.task.ts`, defining what the test says. */
const memory = (def: { id: string; clauses: string[] } | null, exists = true): TaskLoader => ({ exists: () => exists, load: async () => def });
const ONE = { id: "T-P9-01", clauses: ["B-P9-01"] };
const check = (text: string, loader: TaskLoader = memory(ONE)) => checkContract(parseContract(text), loader).then(byCode);

describe("[F20] the contract check, planted", () => {
  it("the base contract passes", async () => {
    expect(await check(BASE)).toEqual([]);
  });

  it("a clause with no evidence id or row fails, unless it is attested", async () => {
    const bare = BASE.replace("evidence: `answers/step-1.md` 2a", "evidence: the dump");
    expect(await check(bare)).toEqual(["CONTRACT_CLAUSE_NO_EVIDENCE B-P9-01"]);
    expect(await check(bare.replace("tags: [instrumented]", "tags: [attested]"))).toEqual([]);
    // A row counts as evidence too.
    expect(await check(BASE.replace("`answers/step-1.md` 2a", "`runtime.message_reactions:de8e3334-8b53`"))).toEqual([]);
  });

  it("a task block with no file line, a missing file or an unloadable one fails", async () => {
    expect(await check(BASE.replace(/^\s*file: .*\n/m, ""))).toEqual(["CONTRACT_TASK_NO_FILE T-P9-01"]);
    expect(await check(BASE, memory(ONE, false))).toEqual(["CONTRACT_TASK_FILE_MISSING T-P9-01"]);
    expect(await check(BASE, memory(null))).toEqual(["CONTRACT_TASK_UNLOADABLE T-P9-01"]);
  });

  it("a file whose id or clauses are not the block's fails, and a clause with no block is named", async () => {
    expect(await check(BASE, memory({ id: "T-P9-02", clauses: ["B-P9-01"] }))).toEqual(["CONTRACT_TASK_ID_MISMATCH T-P9-01"]);
    expect(await check(BASE, memory({ id: "T-P9-01", clauses: ["B-P9-02"] }))).toEqual(["CONTRACT_TASK_CLAUSES_MISMATCH T-P9-01", "CONTRACT_CLAUSE_UNKNOWN T-P9-01"]);
    // The order the file lists its clauses in does not matter; a clause naming the task that the file leaves out does.
    const two = `${BASE.replace("## Tasks", "B-P9-02: Another.\n  evidence: `trace.json`\n  tasks: T-P9-01\n\n## Tasks")}`;
    expect(await check(two, memory({ id: "T-P9-01", clauses: ["B-P9-02", "B-P9-01"] }))).toEqual([]);
    expect(await check(two)).toEqual(["CONTRACT_TASK_CLAUSES_MISMATCH T-P9-01"]);
  });

  it("a clause naming a task with no block fails", async () => {
    expect(await check(BASE.replace("tasks: T-P9-01", "tasks: T-P9-01, T-P9-07 (the zero case)"))).toEqual(["CONTRACT_TASK_UNKNOWN B-P9-01"]);
  });

  it("a Scorecard with the header alone fails", async () => {
    expect(await check(BASE.replace(/^0 \| .*\n/m, ""))).toEqual(["CONTRACT_SCORECARD_EMPTY Scorecard"]);
  });

  it("blocks outside their sections are not read: a clause id in prose is no clause", () => {
    const c = parseContract(`${BASE}\n## Notes\n\nB-P9-09: not a clause.\n  tasks: T-P9-09\n\nT-P9-09  must-have  tier 1\n  file: x\n`);
    expect([c.clauses.length, c.tasks.length]).toEqual([1, 1]);
  });
});
