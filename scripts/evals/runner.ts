// The tier-2 runner's core (parity framework design §3 "Tiers", §5.2; F19): tasks from `test/evals/` against a slot,
// three trials each, graded by the task's own code graders, with the slot's failures kept apart from the agent's.
// Pure over a `Slot`: `pnpm evals` (scripts/evals.ts) hands it the worktree's preview slot (scripts/evals/slot.ts),
// the test a scripted one.
//
//   trial     one chat on the slot, the task's prompts and events (SLOT_EVENTS) in order, then the graders: `pass`; `fail` with a code
//             (GRADER_FAILED, MINEFIELD, GRADER_THREW, or the TurnError's code) and the grader's name; `infra` with the
//             InfraError's code (SLOT_MISSING, LEASE_LAPSED, SLOT_5XX, SLOT_UNREACHABLE, SESSION_UNAVAILABLE).
//   verdict   `pass` when every one of TRIALS trials passed; `fail` when any trial failed; else `infra`. An infra trial
//             ends the task's trials (the slot is not there to try again) and is never counted as fail.
//   baseline  the results file for the task's versionHash, docs/plan-v2/evidence/results/<versionHash>.json: its last
//             run with a pass or fail verdict. A pass after a fail is `improved`, a fail after a pass `regressed`; an
//             infra run neither moves the baseline nor earns a note. A changed grader is a new hash and no baseline.
//   results   the file holds the task id, cluster, hash and every run (time, slot, trials with status, code, the
//             grader's name as `rule` and times; the run's status; its state against the baseline): never a line the
//             agent or the person said (D-0014), and every key on the redaction gate's allowlist
//             (scripts/redact-capture.mjs), so `pnpm redact` over a results file changes nothing.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { InfraError, type SlotWorld, TurnError } from "../../test/support/evals.ts";
import type { DefinedTask } from "../../test/support/task.ts";

export const TRIALS = 3;

export type Outcome = "pass" | "fail" | "infra";
export type Note = "regressed" | "improved";

export interface Trial {
  /** 1 to TRIALS. */
  trial_id: number;
  status: Outcome;
  /** `fail`: GRADER_FAILED, MINEFIELD, GRADER_THREW or the turn's code; `infra`: the slot's code. */
  code?: string;
  /** The grader that failed or the minefield stepped on, by its name in the task. */
  rule?: string;
  started_at: string;
  finished_at: string;
}

export interface Run {
  run_at: string;
  preview_slot: string;
  trials: Trial[];
  /** The verdict. */
  status: Outcome;
  /** Against the baseline: `regressed` or `improved`; absent when neither. */
  state?: Note;
}

export interface ResultsFile {
  task_id: string;
  cluster: string;
  version_hash: string;
  runs: Run[];
}

export interface TaskResult extends Run {
  task_id: string;
  cluster: string;
  version_hash: string;
}

/** A slot the runner can open chats on; the worktree's preview slot, or a scripted one in a test. */
export interface Slot {
  /** `fletch-pv-<n>`, or `none` when no slot could be resolved (then `open` rejects with the InfraError that says why). */
  name: string;
  /** A world for one trial of `task`: the slot's chat, and for a memory task (P6, F28) Sam's memory reset and seeded. */
  open(task?: Pick<DefinedTask<SlotWorld>, "id" | "cluster">): Promise<SlotWorld>;
}

export interface RunDeps {
  slot: Slot;
  /** Where `<versionHash>.json` is read and written. */
  resultsDir: string;
  now: () => Date;
  /** The slot's owner: the only person a prompt can be sent as. */
  owner: string;
  log?: (line: string) => void;
}

/**
 * The events a slot world plays (F26, F30, F32, F34): a decision on a card, through the page's own route; a job's tick,
 * its next alarm fired by the test host; a reload, the world read again; an open (P5), Sam opening the tab or a row
 * again; a prompt (payload `wait`: its sub-agents left running).
 */
export const SLOT_EVENTS: readonly string[] = ["decide", "tick", "reload", "open", "prompt"];

/** The events only one cluster's slot world plays (F34): for P3 a steer or Stop while a child runs, and the children waited out. */
export const CLUSTER_EVENTS: Readonly<Record<string, readonly string[]>> = { P3: ["midchild", "children"] };

/** Why the runner cannot drive `task` on a slot owned by `owner`, or null: a prompt by someone else, an event the slot cannot play, a schedule. */
export function driveable(task: DefinedTask<SlotWorld>, owner: string): string | null {
  const events = [...SLOT_EVENTS, ...(CLUSTER_EVENTS[task.cluster] ?? [])];
  for (const [i, turn] of task.turns.entries()) {
    if (turn.kind === "event" && events.includes(turn.name)) continue;
    if (turn.kind !== "prompt") return `EVALS_TASK_UNDRIVABLE: turn ${i + 1} of ${task.id} is ${turn.kind === "event" ? `the event ${turn.name}` : "a schedule"}; the runner drives prompts and ${events.join(", ")} events only`;
    if (turn.by !== owner) return `EVALS_TASK_UNDRIVABLE: turn ${i + 1} of ${task.id} is by ${turn.by}, not the slot's owner ${owner}`;
  }
  return null;
}

/** One trial: a chat, the prompts, the graders. Never throws for a slot's or the agent's failure; a grader that throws is the task's `fail`. */
export async function trial(task: DefinedTask<SlotWorld>, slot: Slot, n: number, now: () => Date): Promise<Trial> {
  const started_at = now().toISOString();
  const done = (t: Omit<Trial, "trial_id" | "started_at" | "finished_at">): Trial => ({ trial_id: n, ...t, started_at, finished_at: now().toISOString() });
  try {
    const world = await slot.open(task);
    for (const turn of task.turns) {
      if (turn.kind === "prompt") await world.send(turn.text, turn.chat);
      else if (turn.kind === "event") await world.event(turn.name, turn.payload ?? {});
    }
    for (const g of task.graders) {
      let answer: boolean;
      try {
        answer = await g.check(world);
      } catch {
        return done({ status: "fail", code: "GRADER_THREW", rule: g.name });
      }
      if (g.kind === "minefield" ? answer : !answer) return done({ status: "fail", code: g.kind === "minefield" ? "MINEFIELD" : "GRADER_FAILED", rule: g.name });
    }
    return done({ status: "pass" });
  } catch (error) {
    if (error instanceof InfraError) return done({ status: "infra", code: error.code });
    if (error instanceof TurnError) return done({ status: "fail", code: error.code });
    throw error;
  }
}

/** `pass` only when every one of TRIALS trials passed; any `fail` is `fail`; anything else (an infra trial, trials cut short) is `infra`. */
export function verdictOf(trials: Pick<Trial, "status">[]): Outcome {
  if (trials.some((t) => t.status === "fail")) return "fail";
  return trials.length === TRIALS && trials.every((t) => t.status === "pass") ? "pass" : "infra";
}

/** The note against a baseline: a change between pass and fail; an infra verdict, or no baseline, earns none. */
export function noteOf(baseline: Outcome | undefined, verdict: Outcome): Note | undefined {
  if (baseline === "pass" && verdict === "fail") return "regressed";
  if (baseline === "fail" && verdict === "pass") return "improved";
  return undefined;
}

export const resultsPath = (dir: string, versionHash: string) => join(dir, `${versionHash}.json`);

export function readResults(file: string): ResultsFile | null {
  return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as ResultsFile) : null;
}

/** The last run that reached a verdict on the agent: pass or fail, never infra. */
export function baselineOf(results: ResultsFile | null): Outcome | undefined {
  return results?.runs.findLast((r) => r.status !== "infra")?.status;
}

export function writeResults(file: string, results: ResultsFile): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(results, null, 2)}\n`);
}

/** The task's trials on the slot, its verdict and note, the run appended to its results file. Throws EVALS_TASK_UNDRIVABLE before any trial. */
export async function runTask(task: DefinedTask<SlotWorld>, deps: RunDeps): Promise<TaskResult> {
  const why = driveable(task, deps.owner);
  if (why) throw new Error(why);
  const log = deps.log ?? (() => {});
  const run_at = deps.now().toISOString();
  const trials: Trial[] = [];
  for (let n = 1; n <= TRIALS; n++) {
    const t = await trial(task, deps.slot, n, deps.now);
    trials.push(t);
    log(`evals: ${task.id} trial ${n}: ${t.status}${t.code ? ` (${t.code}${t.rule ? `: ${t.rule}` : ""})` : ""}`);
    if (t.status === "infra") break;
  }
  const version_hash = task.versionHash();
  const file = resultsPath(deps.resultsDir, version_hash);
  const previous = readResults(file) ?? { task_id: task.id, cluster: task.cluster, version_hash, runs: [] };
  const status = verdictOf(trials);
  const state = noteOf(baselineOf(previous), status);
  const run: Run = { run_at, preview_slot: deps.slot.name, trials, status, ...(state ? { state } : {}) };
  writeResults(file, { ...previous, runs: [...previous.runs, run] });
  return { task_id: task.id, cluster: task.cluster, version_hash, ...run };
}

/** Every task in order, each to its own results file. */
export async function runTasks(tasks: DefinedTask<SlotWorld>[], deps: RunDeps): Promise<TaskResult[]> {
  const out: TaskResult[] = [];
  for (const task of tasks) out.push(await runTask(task, deps));
  return out;
}

const isTask = (v: unknown): v is DefinedTask<SlotWorld> => typeof v === "object" && v !== null && typeof (v as { versionHash?: unknown }).versionHash === "function" && typeof (v as { id?: unknown }).id === "string";

/** The tasks a loaded module exports: every `defineTask()` value, once each (a task exported as `task` and `default` is one task). */
export function tasksOf(mod: Record<string, unknown>): DefinedTask<SlotWorld>[] {
  return [...new Set(Object.values(mod))].filter(isTask);
}

/** The tier-2 tasks whose cluster or id is `selector`; tier-1 matches are named, not run. */
export function selectTasks(tasks: DefinedTask<SlotWorld>[], selector: string): { selected: DefinedTask<SlotWorld>[]; skippedTier1: string[] } {
  const matching = tasks.filter((t) => t.id === selector || t.cluster === selector);
  return { selected: matching.filter((t) => t.tier === 2), skippedTier1: matching.filter((t) => t.tier !== 2).map((t) => t.id) };
}

const cell = (t: Trial | undefined) => (t ? (t.code ? `${t.status} (${t.code})` : t.status) : "not run");

/** One Markdown table for the PR body: task, version (the hash's first 12), each trial, the verdict in bold, the note. */
export function table(results: TaskResult[]): string {
  const head = ["| Task | Version | Trial 1 | Trial 2 | Trial 3 | Verdict | Note |", "|---|---|---|---|---|---|---|"];
  const rows = results.map((r) => `| ${r.task_id} | \`${r.version_hash.slice(0, 12)}\` | ${[0, 1, 2].map((i) => cell(r.trials[i])).join(" | ")} | **${r.status}** | ${r.state ?? ""} |`);
  return `${[...head, ...rows].join("\n")}\n`;
}
