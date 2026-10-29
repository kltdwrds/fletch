// `pnpm evals <cluster|task id>`: the tier-2 runner (parity framework design §3 "Tiers", §5.2; F19). Reads every
// `test/evals/**/*.task.ts`, takes the tier-2 tasks whose cluster (`P<n>`) or id (`T-P<n>-<nn>`) is named, drives
// this worktree's preview slot (`pnpm preview up`; scripts/evals/slot.ts) through the app's routes with a session
// obtained as the live exit test obtains one, runs each task three times, grades by its code graders, and tells the
// slot's failures (`infra`) from the agent's (`fail`). Results go to docs/plan-v2/evidence/results/<versionHash>.json
// (the tracked, content-free folder, D-0014) and the run is summarised as one Markdown table for the PR body.
// Exit 0 when every task passed, 1 otherwise, 2 for a bad invocation. It runs from Kyle's Mac against the worktree's
// leased slot until the CI wiring is accepted (D-0015, proposed; O9).
//
//   pnpm evals P1               every tier-2 task of cluster P1
//   pnpm evals T-P1-03          one task
//   pnpm evals P1 --results <dir>   write the results elsewhere (a dry run; the default is the tracked folder)
import { type Dirent, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { SlotWorld } from "../test/support/evals.ts";
import type { DefinedTask } from "../test/support/task.ts";
import { type RunDeps, runTasks, selectTasks, table } from "./evals/runner.ts";
import { OWNER, previewSlot } from "./evals/slot.ts";

export const root = join(dirname(fileURLToPath(import.meta.url)), "..");
export const TASKS_DIR = "test/evals";
export const RESULTS_DIR = "docs/plan-v2/evidence/results";

const USAGE = "usage: pnpm evals <P<n>|T-P<n>-<nn>> [--results <dir>]";

/** Every `*.task.ts` under `dir`, repository-relative and sorted. */
export function taskFiles(dir: string, base = root): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    let entries: Dirent[];
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".task.ts")) out.push(relative(base, p));
    }
  };
  walk(join(base, dir));
  return out.toSorted();
}

const isTask = (v: unknown): v is DefinedTask<SlotWorld> => typeof v === "object" && v !== null && typeof (v as { versionHash?: unknown }).versionHash === "function" && typeof (v as { id?: unknown }).id === "string";

/** The tasks each file exports (any export that is a `defineTask()` result). */
export async function loadTasks(files: string[], base = root): Promise<DefinedTask<SlotWorld>[]> {
  const out: DefinedTask<SlotWorld>[] = [];
  for (const file of files) {
    const mod = (await import(pathToFileURL(join(base, file)).href)) as Record<string, unknown>;
    for (const v of Object.values(mod)) if (isTask(v)) out.push(v);
  }
  return out;
}

export function parseArgs(argv: string[]): { selector: string; resultsDir: string } | null {
  let selector = "";
  let resultsDir = join(root, RESULTS_DIR);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] as string;
    if (a === "--results") {
      const v = argv[++i];
      if (!v) return null;
      resultsDir = v;
    } else if (a.startsWith("--") || selector) return null;
    else selector = a;
  }
  return /^(?:P\d+|T-P\d+-\d{2,})$/.test(selector) ? { selector, resultsDir } : null;
}

async function main(argv: string[]): Promise<number> {
  const args = parseArgs(argv);
  if (!args) {
    console.error(USAGE);
    return 2;
  }
  const log = (line: string) => console.log(line);
  const files = taskFiles(TASKS_DIR);
  const { selected, skippedTier1 } = selectTasks(await loadTasks(files), args.selector);
  if (skippedTier1.length) log(`evals: ${skippedTier1.length} tier-1 task(s) skipped (${skippedTier1.join(", ")}): tier 1 runs under vitest`);
  if (!selected.length) {
    console.error(`evals: no tier-2 task matches ${args.selector} in ${files.length} file(s) under ${TASKS_DIR}/`);
    return 2;
  }
  const slot = previewSlot(root, process.env, log);
  await slot.resolve();
  log(`evals: ${selected.length} task(s), 3 trials each, results in ${args.resultsDir.startsWith(root) ? relative(root, args.resultsDir) : args.resultsDir}`);
  const deps: RunDeps = { slot, resultsDir: args.resultsDir, now: () => new Date(), owner: OWNER, log };
  const results = await runTasks(selected, deps);
  console.log(`\n${table(results)}`);
  return results.every((r) => r.verdict === "pass") ? 0 : 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2)).catch((error: Error) => {
    console.error(error.message);
    return 1;
  });
}
