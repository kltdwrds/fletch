#!/usr/bin/env node
// The file-size cap (harness-conventions.md), adapted from the monorepo's scripts/check-file-sizes.mjs
// in its flat form: every source file under packages/ that git would commit has at most `maxLines`
// lines. No allowlist and no base: split the file. The ratchet form returns at the merge (D16).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { repoFiles, repoRoot } from './lib/repo-files.mjs';

/** Which files the cap governs. Changing this is a policy change: update the test beside this file with it. */
export const POLICY = { roots: ['packages/'], extensions: ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'], maxLines: 600 };

export function countLines(text) {
  if (text === '') return 0;
  const lines = text.split('\n').length;
  return text.endsWith('\n') ? lines - 1 : lines;
}

export const governed = (file, policy = POLICY) => policy.roots.some((r) => file.startsWith(r)) && policy.extensions.some((e) => file.endsWith(e));

/** Every governed file over the cap, as `{file, lines, limit}`. */
export function findViolations(cwd, policy = POLICY) {
  const violations = [];
  for (const file of repoFiles(cwd).filter((f) => governed(f, policy))) {
    const lines = countLines(readFileSync(path.join(cwd, file), 'utf8'));
    if (lines > policy.maxLines) violations.push({ file, lines, limit: policy.maxLines });
  }
  return violations;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const violations = findViolations(repoRoot());
  for (const v of violations) console.error(`${v.file}: ${v.lines} lines; the cap is ${v.limit}. Split the file.`);
  console.log(`check-file-sizes: cap ${POLICY.maxLines} over ${POLICY.roots.join(', ')}, ${violations.length} violation(s)`);
  if (violations.length > 0) process.exit(1);
}
