// Tasks as code (parity framework design, Appendix A; F18). A task is the unit a contract's clauses are graded by:
// its setup, turns, end state, required facts, minefields, collateral, code graders and reference, all in one
// object so a tier-1 run under vitest and the tier-2 runner (F19, on a preview slot) read the same file.
//
//   test/evals/<cluster>/<task>.task.ts   exports `defineTask({...})`: the definition, pure, importable by node
//   test/evals/<cluster>/<task>.test.ts   calls `runTask(task, harness)` under a `[F<n>]` describe
//
// `versionHash()` covers every field, a grader by its name, kind and source with comments and whitespace
// normalised, so a scorer change is a new tier-2 baseline and a comment is not. `defineTask` refuses a malformed
// task by code; `runTask` grades it as `defineScenario` grades a scenario (same core, same collateral check, same
// trace), and `executeTask` is that run as a promise for a test of the runner itself.
import { createHash } from "node:crypto";
import { describe, it } from "vitest";
import { execute, type RunOptions, type ScenarioWorld, type Snapshot } from "./scenario.ts";
import type { Seeded } from "./seeded.ts";

export type Turn = { kind: "prompt"; by: string; text: string } | { kind: "event"; name: string; payload?: Record<string, string> } | { kind: "schedule"; fire: string };

export type GraderKind = "end_state" | "required_fact" | "minefield";

/** Code first (design §A). An `end_state` or `required_fact` grader must answer true; a `minefield` grader answers whether it happened and must answer false. */
export interface Grader<W> {
  name: string;
  kind: GraderKind;
  check: (world: W) => boolean | Promise<boolean>;
}

export interface Task<W extends ScenarioWorld = ScenarioWorld> {
  /** `T-P<n>-<nn>`. */
  id: string;
  /** `P<n>`. */
  cluster: string;
  /** `B-P<n>-<nn>`, the clauses this task grades. */
  clauses: string[];
  priority: "must-have" | "nice-to-have";
  tier: 1 | 2;
  /** Seeded records, files and jobs by id or kind; the seed drives the fixtures' generator. */
  setup: { seed: number; records: string[]; files: string[]; jobs: string[] };
  turns: Turn[];
  /** What must be true at the end, in words; each graded by an `end_state` grader. */
  end_state: string[];
  /** Facts the answer must carry, in words; each graded by a `required_fact` grader. */
  required_facts: string[];
  /** Things that must not have happened; each names a `minefield` grader exactly. */
  minefields: string[];
  /** The keys the turns are declared to add, per area; anything else is collateral. */
  collateral: Partial<Snapshot>;
  graders: Grader<W>[];
  /** What Muse did, or what the contract requires. */
  reference: string;
}

export interface DefinedTask<W extends ScenarioWorld = ScenarioWorld> extends Task<W> {
  versionHash(): string;
}

/** How a tier-1 run builds the world and plays a turn through it (the fake model, the test host). */
export interface TaskHarness<W extends ScenarioWorld> {
  setup: (rng: Seeded, task: Task<W>) => W | Promise<W>;
  play: (world: W, turn: Turn, rng: Seeded) => Promise<void>;
}

const TASK_ID = /^T-P\d+-\d{2,}$/;
const CLAUSE_ID = /^B-P\d+-\d{2,}$/;

/** Source with comments removed (outside strings) and whitespace collapsed, so a comment never moves the hash. */
export function normaliseSource(src: string): string {
  let out = "";
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const next = src[i + 1];
    if (c === '"' || c === "'" || c === "`") {
      let j = i + 1;
      while (j < src.length && src[j] !== c) j += src[j] === "\\" ? 2 : 1;
      out += src.slice(i, j + 1);
      i = j + 1;
    } else if (c === "/" && next === "/") {
      while (i < src.length && src[i] !== "\n") i++;
    } else if (c === "/" && next === "*") {
      const end = src.indexOf("*/", i + 2);
      i = end === -1 ? src.length : end + 2;
    } else {
      out += c;
      i++;
    }
  }
  return out.replace(/\s+/g, " ").trim();
}

function hashOf<W extends ScenarioWorld>(t: Task<W>): string {
  const graders = t.graders.map((g) => [g.name, g.kind, normaliseSource(g.check.toString())]);
  const body = JSON.stringify([t.id, t.cluster, t.clauses, t.priority, t.tier, t.setup, t.turns, t.end_state, t.required_facts, t.minefields, t.collateral, graders, t.reference]);
  return createHash("sha256").update(body).digest("hex");
}

/** The task with its `versionHash`, or a throw by code: TASK_BAD_ID, TASK_BAD_CLAUSE, TASK_NO_GRADER, TASK_MINEFIELD_UNGRADED, TASK_GRADER_UNLISTED. */
export function defineTask<W extends ScenarioWorld>(t: Task<W>): DefinedTask<W> {
  if (!TASK_ID.test(t.id)) throw new Error(`TASK_BAD_ID: ${t.id}`);
  for (const c of t.clauses) if (!CLAUSE_ID.test(c)) throw new Error(`TASK_BAD_CLAUSE: ${c}`);
  if (t.graders.length === 0) throw new Error(`TASK_NO_GRADER: ${t.id}`);
  const mines = new Set(t.graders.filter((g) => g.kind === "minefield").map((g) => g.name));
  for (const m of t.minefields) if (!mines.has(m)) throw new Error(`TASK_MINEFIELD_UNGRADED: ${m}`);
  for (const m of mines) if (!t.minefields.includes(m)) throw new Error(`TASK_GRADER_UNLISTED: ${m}`);
  return { ...t, versionHash: () => hashOf(t) };
}

/** One graded run of a task through a harness, as a promise: rejects with the first failing grader, minefield or collateral. */
export function executeTask<W extends ScenarioWorld>(task: DefinedTask<W>, harness: TaskHarness<W>, options: RunOptions = {}): Promise<void> {
  return execute<W>(
    {
      id: `S-${task.id.slice(2)}` as `S-${string}`,
      cluster: task.cluster,
      clauses: task.clauses,
      seed: task.setup.seed,
      setup: (rng) => harness.setup(rng, task),
      turns: async (world, rng) => {
        for (const turn of task.turns) await harness.play(world, turn, rng);
      },
      endState: async (world) => {
        for (const g of task.graders) {
          if (g.kind === "minefield") continue;
          if (!(await g.check(world))) throw new Error(`TASK_GRADER_FAILED: ${g.kind} "${g.name}" of ${task.id}`);
        }
      },
      minefields: task.graders.filter((g) => g.kind === "minefield").map((g) => ({ name: g.name, happened: g.check })),
      declared: () => task.collateral,
    },
    options,
  );
}

/** Registers the task under vitest, inside the caller's own tagged `describe`, as `defineScenario` registers a scenario. */
export function runTask<W extends ScenarioWorld>(task: DefinedTask<W>, harness: TaskHarness<W>, options: RunOptions = {}): void {
  describe(`task ${task.id} (${task.priority}, tier ${task.tier})`, () => {
    it(`grades ${task.clauses.join(", ")} by its graders with no minefield and no collateral change`, () => executeTask(task, harness, options));
  });
}
