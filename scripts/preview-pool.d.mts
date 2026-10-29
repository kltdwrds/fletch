// Types for what the tier-2 runner (scripts/evals/slot.ts) reads from scripts/preview-pool.mjs; the code is the .mjs.
export function knownSubdomain(ctx: { dir: string; env?: NodeJS.ProcessEnv }): string | null;
export function readJson(file: string): unknown;
