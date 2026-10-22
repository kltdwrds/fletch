import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

// A rule AGENTS.md used to state in prose, now enforced (a rule that must never be broken is a hook,
// not a sentence): no bypassing the git hooks.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Runs the Claude Code PreToolUse guard on a Bash command, as Claude Code would. */
function guard(command) {
  const input = JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command } });
  const r = spawnSync(process.execPath, [path.join(root, '.claude/hooks/no-hook-bypass.mjs')], { input, encoding: 'utf8' });
  return { status: r.status, stderr: r.stderr };
}

describe('the PreToolUse guard refuses every way of skipping the git hooks', () => {
  for (const command of [
    'git commit --no-verify -m x',
    'git commit -n -m x',
    'git commit -anm x',
    'git push --no-verify origin HEAD',
    'SKIP_SIMPLE_GIT_HOOKS=1 git commit -m x',
    'git -c core.hooksPath=/dev/null commit -m x',
    'cd apps && git commit --no-verify -m "x"',
    'git --git-dir .git commit --no-verify -m x',
    'git --work-tree . --namespace n commit -n -m x',
    'GIT_TRACE=1 git commit --no-verify -m x',
  ]) {
    it(`refuses: ${command}`, () => {
      const r = guard(command);
      assert.equal(r.status, 2);
      assert.match(r.stderr, /hooks/);
    });
  }

  for (const command of [
    'git commit -m "fix: add --no-verify to the list of refused flags"',
    'git push -n origin HEAD',
    'git status',
    'pnpm verify',
    'git log --oneline -n 5',
    'git log commit -n 5',
    'echo git commit --no-verify',
    'grep -rn git commit -n docs',
  ]) {
    it(`allows: ${command}`, () => assert.equal(guard(command).status, 0));
  }
});
