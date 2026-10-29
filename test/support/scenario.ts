// Scenario tooling (testing-and-evals.md section 4, from M5.1): `defineScenario` declares one graded
// scenario: its clauses, a seed for the mulberry32 generator, the setup from the fictional
// fixtures, the turns, the end state, the minefields (things that must not have happened) and the
// declared change. The collateral check snapshots journal, vault and R2 keys before and after the
// turns and requires the difference to equal the declared change exactly. Files under
// test/scenarios/ run twice in accept, so a scenario that passes only on retry fails.
//
// Each run emits one trace (design Appendix B, test/support/trace.ts) to `$QYVR_TRACE_DIR/<id>.json` when that
// variable is set and nothing otherwise (F18): one step whose state_delta is the keys the turns added, its failure
// the minefield, collateral or end-state failure by code. A trace that does not validate is a bug in the runner
// and throws TRACE_INVALID instead of being written.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Seeded } from "./seeded.ts";
import { type Trace, type TraceStep, validateTrace } from "./trace.ts";

/** Keys per area; a journal key names a run, an outbox row or a Ledger row. */
export interface Snapshot {
  journal: string[];
  vault: string[];
  r2: string[];
}

export interface ScenarioWorld {
  snapshot(): Promise<Snapshot> | Snapshot;
}

export interface Scenario<W extends ScenarioWorld> {
  /** `S-<clause>-<slug>`. */
  id: `S-${string}`;
  /** The cluster whose contract the scenario serves (`P<n>`); `none` in the trace when unset. */
  cluster?: string;
  clauses: string[];
  seed: number;
  setup: (rng: Seeded) => Promise<W> | W;
  turns: (world: W, rng: Seeded) => Promise<void>;
  endState: (world: W) => Promise<void> | void;
  minefields: Array<{ name: string; happened: (world: W) => Promise<boolean> | boolean }>;
  /** Keys the turns are declared to add, per area; anything else added, or anything removed, is collateral. */
  declared: (world: W) => Promise<Partial<Snapshot>> | Partial<Snapshot>;
}

export interface RunOptions {
  /** Where `QYVR_TRACE_DIR` is read from; the process's environment by default. */
  env?: NodeJS.ProcessEnv;
}

const sorted = (xs: string[]) => [...xs].sort();

/** The collateral check: the change between two snapshots must equal the declared one. */
export function collateral(before: Snapshot, after: Snapshot, declared: Partial<Snapshot>): { area: keyof Snapshot; added: string[]; removed: string[]; expected: string[] }[] {
  const areas: Array<keyof Snapshot> = ["journal", "vault", "r2"];
  return areas
    .map((area) => {
      const was = new Set(before[area]);
      const now = new Set(after[area]);
      const added = sorted([...now].filter((k) => !was.has(k)));
      const removed = sorted([...was].filter((k) => !now.has(k)));
      return { area, added, removed, expected: sorted(declared[area] ?? []) };
    })
    .filter((d) => d.removed.length > 0 || JSON.stringify(d.added) !== JSON.stringify(d.expected));
}

/** The directory a run writes its trace to, or null when `QYVR_TRACE_DIR` is unset or empty. */
export const traceDir = (env: NodeJS.ProcessEnv): string | null => env.QYVR_TRACE_DIR || null;

const added = (before: string[], after: string[]) => {
  const was = new Set(before);
  return sorted(after.filter((k) => !was.has(k)));
};

/** The run's one step: what the turns added, and how the run failed, if it did. */
function stepOf(before: Snapshot, after: Snapshot, failure: TraceStep["failure"]): TraceStep {
  return {
    action: { kind: "turns", input_class: "scripted", actor: "user" },
    observed: { surface: "none", cards: [], text_class: "none", notification: "none" },
    state_delta: { records: added(before.journal, after.journal), files: added(before.r2, after.r2), jobs: [], reactions: [], other: added(before.vault, after.vault) },
    failure,
    approval: null,
    timing: "immediate",
    tags: ["instrumented"],
  };
}

function writeTrace(dir: string, trace: Trace): void {
  const verdict = validateTrace(trace);
  if (!verdict.ok) throw new Error(`TRACE_INVALID: ${verdict.reasons.map((r) => `${r.code} at ${r.path}`).join(", ")}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${trace.scenario_id}.json`), `${JSON.stringify(trace, null, 2)}\n`);
}

/**
 * One graded run: setup, turns, end state, minefields, collateral; the trace written first when a directory is
 * set, so a failing run leaves its trace too. Rejects with the first failure, as `it` would report it.
 */
export async function execute<W extends ScenarioWorld>(s: Scenario<W>, options: RunOptions = {}): Promise<void> {
  const rng = new Seeded(s.seed);
  const world = await s.setup(rng);
  const before = await world.snapshot();
  await s.turns(world, rng);
  let failure: TraceStep["failure"] = null;
  let endStateError: unknown = null;
  try {
    await s.endState(world);
  } catch (error) {
    endStateError = error;
    failure = { code: "SCENARIO_END_STATE", user_words: (error as Error).message };
  }
  const stepped: string[] = [];
  for (const m of s.minefields) if (await m.happened(world)) stepped.push(m.name);
  const after = await world.snapshot();
  const extra = collateral(before, after, await s.declared(world));
  if (!failure && stepped.length) failure = { code: "SCENARIO_MINEFIELD", user_words: stepped.join("; ") };
  if (!failure && extra.length) failure = { code: "SCENARIO_COLLATERAL", user_words: JSON.stringify(extra) };
  const dir = traceDir(options.env ?? process.env);
  if (dir) {
    writeTrace(dir, {
      scenario_id: s.id,
      cluster: s.cluster ?? "none",
      arm: "fletch",
      run_at: new Date().toISOString(),
      source: { dump_version: "none" },
      steps: [stepOf(before, after, failure)],
      examples: [],
    });
  }
  if (endStateError) throw endStateError;
  expect(stepped, "minefields stepped on").toEqual([]);
  expect(extra, "collateral change").toEqual([]);
}

/** Called inside the family's own tagged `describe("[M<n>.<p>] <family>", ...)`, which accept reads. */
export function defineScenario<W extends ScenarioWorld>(s: Scenario<W>, options: RunOptions = {}): void {
  if (!/^S-[A-Z]\d+-[a-z0-9-]+$/.test(s.id)) throw new Error(`SCENARIO_BAD_ID: ${s.id}`);
  describe(`scenario ${s.id}`, () => {
    it(`grades ${s.clauses.join(", ")} with no collateral change and no minefield`, () => execute(s, options));
  });
}
