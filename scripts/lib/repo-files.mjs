// The files a harness check reads: what git would commit from the working tree, tracked files plus
// untracked files that are not ignored, never a nested Claude Code worktree and never a directory
// (the upstream submodule's gitlink is one).
import { execFileSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';

/** git with the hook variables (GIT_DIR, GIT_INDEX_FILE, ...) stripped, so it targets `cwd` alone. */
export function git(args, cwd) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')));
  return execFileSync('git', args, { cwd, env, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
}

/** The repository root containing `cwd`. */
export const repoRoot = (cwd = process.cwd()) => git(['rev-parse', '--show-toplevel'], cwd).trim();

/** Repository-relative paths of every file git would commit from the working tree, sorted. */
export function repoFiles(cwd) {
  const out = git(['ls-files', '-z', '--cached', '--others', '--exclude-standard'], cwd);
  return [...new Set(out.split('\0'))]
    .filter((f) => f !== '' && !f.startsWith('.claude/worktrees/'))
    .filter((f) => existsSync(path.join(cwd, f)) && statSync(path.join(cwd, f)).isFile())
    .sort();
}
