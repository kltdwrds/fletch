#!/usr/bin/env node
// The file-size ratchet, ported from qyvr's scripts/check-file-sizes.mjs (the ratchet form fletch's flat cap
// deferred). A new or changed source file under packages/ may have at most `maxLines` lines; a file that was already
// over the cap at the base may shrink or hold, never grow. There is no allowlist: split the file. The base is
// CHECK_FILE_SIZES_BASE, else the merge base with origin/main, and must resolve, or the check fails; it never passes
// blind (AGENTS.md, gotcha 2).
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Which files the ratchet governs. Changing this is a policy change: update the test and AGENTS.md with it. */
export const POLICY = { roots: ['packages/'], extensions: ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'], maxLines: 600 };

function git(args, cwd) {
  // Hooks export GIT_DIR and friends; a child git that targets `cwd` must not inherit them.
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')));
  return execFileSync('git', args, { cwd, env, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
}

export function countLines(text) {
  if (text === '') return 0;
  const lines = text.split('\n').length;
  return text.endsWith('\n') ? lines - 1 : lines;
}

export const governed = (file, policy = POLICY) =>
  policy.roots.some((r) => file.startsWith(r)) && policy.extensions.some((e) => file.endsWith(e));

/** The ref to compare against: CHECK_FILE_SIZES_BASE, else the merge base with origin/main. */
export function resolveBase(cwd, env = process.env) {
  if (env.CHECK_FILE_SIZES_BASE) return env.CHECK_FILE_SIZES_BASE;
  try {
    return git(['merge-base', 'origin/main', 'HEAD'], cwd).trim();
  } catch {
    throw new Error('check-file-sizes: no merge base with origin/main; fetch it or set CHECK_FILE_SIZES_BASE');
  }
}

/**
 * The files changed since `base` in the working tree, each with the path it had at the base (null for a
 * new file). NUL-separated, so a non-ASCII name is not quoted; a rename keeps its old path, so moving a
 * file already over the cap does not count as creating one.
 */
function changedFiles(cwd, base) {
  const fields = git(['diff', '-z', '--name-status', '--find-renames', '--diff-filter=AMR', base], cwd).split('\0');
  const out = new Map();
  for (let i = 0; i + 1 < fields.length; ) {
    const status = fields[i];
    if (status.startsWith('R')) {
      out.set(fields[i + 2], fields[i + 1]);
      i += 3;
    } else {
      out.set(fields[i + 1], fields[i + 1]);
      i += 2;
    }
  }
  for (const f of git(['ls-files', '-z', '--others', '--exclude-standard'], cwd).split('\0')) if (f !== '' && !out.has(f)) out.set(f, null);
  return out;
}

/** Every governed file whose line count breaks the ratchet, comparing the working tree with `base`. */
export function findViolations(cwd, base, policy = POLICY) {
  try {
    git(['cat-file', '-e', `${base}^{commit}`], cwd);
  } catch {
    throw new Error(`check-file-sizes: base "${base}" is not a commit here; the check cannot run (fetch origin/main, or set CHECK_FILE_SIZES_BASE to a commit this clone has)`);
  }
  const changed = changedFiles(cwd, base);
  const files = [...changed.keys()].filter((f) => governed(f, policy)).sort();
  const violations = [];
  for (const file of files) {
    const lines = countLines(readFileSync(path.join(cwd, file), 'utf8'));
    const was = changed.get(file) ?? null;
    let baseLines = null;
    try {
      if (was !== null) baseLines = countLines(git(['show', `${base}:${was}`], cwd));
    } catch {
      // Not in the base: a new file.
    }
    const limit = baseLines !== null && baseLines > policy.maxLines ? baseLines : policy.maxLines;
    if (lines > limit) violations.push({ file, lines, limit, baseLines });
  }
  return violations;
}

function main() {
  const cwd = git(['rev-parse', '--show-toplevel'], process.cwd()).trim();
  const base = resolveBase(cwd);
  const violations = findViolations(cwd, base);
  for (const v of violations) {
    const why = v.baseLines === null || v.baseLines <= POLICY.maxLines ? `the cap is ${POLICY.maxLines}` : `it was ${v.baseLines} at the base and may not grow`;
    console.error(`${v.file}: ${v.lines} lines; ${why}. Split the file.`);
  }
  console.log(`check-file-sizes: cap ${POLICY.maxLines} over ${POLICY.roots.join(', ')} against ${base.slice(0, 12)}, ${violations.length} violation(s)`);
  if (violations.length > 0) process.exit(1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}
