#!/usr/bin/env node
// The pre-push hook's gate, ported from qyvr: `pnpm check` (Biome, the harness checks and scans, the typecheck, about
// 20 s), on the working tree. CI runs `pnpm verify` (check, then the tests) on every push and PR
// (.github/workflows/ci.yml), so the hook does not repeat the tests; run `pnpm verify` to run them here. git hands a pre-push hook one line per ref on stdin:
// `<local ref> <local sha> <remote ref> <remote sha>`. A push that only deletes refs runs nothing; anything else, stdin
// this cannot read included, runs `pnpm check`, never nothing.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ZERO = /^0+$/;

/** The gate a push runs: 'check', or null when every line deletes a ref. `lines` are the hook's stdin lines. */
export function classify(lines) {
  const refs = lines.map((l) => l.trim()).filter(Boolean);
  const deletes = (ref) => {
    const parts = ref.split(/\s+/);
    return parts.length === 4 && ZERO.test(parts[1]);
  };
  return refs.length > 0 && refs.every(deletes) ? null : 'check';
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let input = '';
  try {
    input = readFileSync(0, 'utf8');
  } catch {
    // Unreadable stdin: classify sees no refs and runs check.
  }
  if (classify(input.split('\n')) === null) {
    console.log('pre-push: this push only deletes refs; no gate to run');
    process.exit(0);
  }
  console.log('pre-push: running pnpm check; the tests run in CI (pnpm verify runs them here)');
  const r = spawnSync('pnpm', ['check'], { stdio: 'inherit' });
  process.exit(r.status ?? 1);
}
