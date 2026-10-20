#!/usr/bin/env node
// The test-hygiene check (harness-conventions.md, in the monorepo's style). Under test/, and in the
// vitest config, it rejects:
//   - a focused test (`.only` on describe, it, test, suite or bench), which silently drops the rest;
//   - a retry (`retry:` or `retry(`), because a test that passes on retry is a bug (KICKOFF.md);
//   - a sleep-style wait (setTimeout, setInterval, a sleep() helper, timers/promises, Atomics.wait,
//     scheduler.wait, vi.waitFor, vi.waitUntil), because tests own the store, not the clock.
// Code is read with comments and the contents of strings blanked, so a test may name these in a title
// or plant them in a fixture string; only code that would run counts. Flat for now: every occurrence
// fails, there is no base to compare with.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { blankComments, blankCommentsAndLiterals, lineAt } from './lib/blank.mjs';
import { repoFiles, repoRoot } from './lib/repo-files.mjs';

export const SCOPE = /^test\/|^vitest(?:\.[\w-]+)?\.config\.[cm]?[jt]s$/;
const CODE = /\.(?:[cm]?[jt]sx?)$/;

/** Each rule: a stable code, why, and the pattern over code with comments and literals blanked (or, for `imports`, comments only). */
export const RULES = [
  { code: 'focused-test', why: '`.only` runs one test and silently skips the rest', re: /\b(?:describe|it|test|suite|bench)(?:\s*\.\s*[\w$]+)*?\s*\.\s*only\b/g },
  { code: 'test-retry', why: 'a test that passes on retry is a bug; fix the cause', re: /\bretry\s*[:(]/g },
  { code: 'sleep-wait', why: 'tests own the store, not the clock: wait on a state change, never on time', re: /\b(?:set(?:Timeout|Interval)|sleep|Atomics\s*\.\s*wait(?:Async)?|scheduler\s*\.\s*wait|vi\s*\.\s*wait(?:For|Until))\s*\(/g },
  { code: 'sleep-wait', why: 'tests own the store, not the clock: wait on a state change, never on time', re: /\b(?:from\s*|import\s*\(\s*|require\s*\(\s*)['"](?:node:)?timers\/promises['"]/g, imports: true },
];

/** Every violation in `text` as `{code, line, why}`, in line order. */
export function violationsIn(text) {
  const code = blankCommentsAndLiterals(text);
  const commentsBlanked = blankComments(text);
  const out = [];
  for (const rule of RULES) {
    for (const m of (rule.imports ? commentsBlanked : code).matchAll(rule.re)) out.push({ code: rule.code, line: lineAt(text, m.index), why: rule.why });
  }
  return out.sort((a, b) => a.line - b.line);
}

/** Every violation in every file in scope, as `{file, code, line, why}`. */
export function findViolations(cwd) {
  const violations = [];
  for (const file of repoFiles(cwd)) {
    if (!SCOPE.test(file) || !CODE.test(file)) continue;
    for (const v of violationsIn(readFileSync(path.join(cwd, file), 'utf8'))) violations.push({ file, ...v });
  }
  return violations;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const violations = findViolations(repoRoot());
  for (const v of violations) console.error(`${v.file}:${v.line}: ${v.code}: ${v.why}`);
  console.log(`check-test-hygiene: ${violations.length} violation(s)`);
  if (violations.length > 0) process.exit(1);
}
