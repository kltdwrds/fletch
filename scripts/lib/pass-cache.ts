// The pass cache in front of accept's gate (harness-conventions.md, M15.5). It is opt-in
// (`ACCEPT_PASS_CACHE=1`) so a plain `pnpm accept <id>` is always a full run; it only speeds interim
// runs. A hit needs the same tree hash (every tracked and unignored file's content), step, target id
// and runtime versions, so any change to the tree, the step list or the toolchain misses. Only a
// passing step is ever stored, and only steps whose result is a function of the tree alone are
// eligible (CACHEABLE_STEPS): not hermetic tests (step 3 feeds the claims step), the audit, the live
// lane or the claims.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Steps by number: typecheck, lint, dry-run bundle, secret scan, privacy scan, harness, contract. */
export const CACHEABLE_STEPS = new Set([1, 2, 4, 5, 6, 9, 10]);

export interface PassInput {
  tree: string;
  step: number;
  id: string;
  versions: Record<string, string>;
}

export const enabled = (env: NodeJS.ProcessEnv = process.env): boolean => env.ACCEPT_PASS_CACHE === "1";

/** The cache key: a hash over everything a step's result may depend on. */
export function cacheKey({ tree, step, id, versions }: PassInput): string {
  return createHash("sha256").update(JSON.stringify([tree, step, id, versions])).digest("hex");
}

const fileFor = (dir: string) => join(dir, "passes.json");

function load(dir: string): Record<string, { count?: unknown }> {
  try {
    const parsed = JSON.parse(readFileSync(fileFor(dir), "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

/** The recorded count of a prior pass for this key, or null. Never returns a hit for an ineligible step. */
export function lookup(dir: string, input: PassInput): string | null {
  if (!CACHEABLE_STEPS.has(input.step)) return null;
  const entry = load(dir)[cacheKey(input)];
  return entry && typeof entry.count === "string" ? entry.count : null;
}

/** Stores a pass. A failure is never stored, and an ineligible step is ignored. */
export function record(dir: string, input: PassInput, count: string): void {
  if (!CACHEABLE_STEPS.has(input.step)) return;
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const all = load(dir);
  all[cacheKey(input)] = { count };
  writeFileSync(fileFor(dir), `${JSON.stringify(all)}\n`);
}

/** The runtime versions in the key; the tree already holds the lockfile and the scripts. */
export const toolVersions = (): Record<string, string> => ({ node: process.version });
