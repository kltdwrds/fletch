#!/usr/bin/env node
// Claude Code PreToolUse guard (.claude/settings.json): refuses a Bash command that would skip the
// git hooks (`--no-verify`, `git commit -n`, the simple-git-hooks skip variable, or pointing
// core.hooksPath elsewhere). AGENTS.md says to fix what a hook reports; this makes that a gate.
import { readFileSync } from 'node:fs';

const input = JSON.parse(readFileSync(0, 'utf8') || '{}');
const command = String(input?.tool_input?.command ?? '');
// Quoted text is data (a commit message may mention --no-verify), so it is not inspected.
const bare = command.replace(/'[^']*'|"(?:\\.|[^"\\])*"/g, "''");

/** git's global options that take their value as the next word (`git --git-dir .git commit`). */
const GLOBAL_WITH_VALUE = new Set(['-c', '-C', '--git-dir', '--work-tree', '--namespace', '--super-prefix', '--config-env']);

/**
 * The git subcommand of one shell segment, and its arguments, or null when the segment does not run
 * git: git must be the segment's command word, after any `NAME=value` assignments, so `echo git commit
 * -n` is not a git call.
 */
function gitCall(segment) {
  const tokens = segment.trim().split(/\s+/).filter(Boolean);
  let i = 0;
  while (i < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[i])) i += 1;
  const command = tokens[i] ?? '';
  if (command !== 'git' && !command.endsWith('/git')) return null;
  i += 1;
  while (i < tokens.length && tokens[i].startsWith('-')) i += GLOBAL_WITH_VALUE.has(tokens[i]) ? 2 : 1;
  return { sub: tokens[i] ?? '', args: tokens.slice(i + 1) };
}

function refusal() {
  if (/\bSKIP_SIMPLE_GIT_HOOKS\b/.test(bare)) return 'setting SKIP_SIMPLE_GIT_HOOKS';
  if (/core\.hooksPath/.test(bare)) return 'pointing core.hooksPath elsewhere';
  for (const segment of bare.split(/&&|\|\||;|\||\n/)) {
    const call = gitCall(segment);
    if (!call || (call.sub !== 'commit' && call.sub !== 'push')) continue;
    if (call.args.includes('--no-verify')) return `git ${call.sub} --no-verify`;
    // For commit, -n is --no-verify, also inside a group such as -anm; for push, -n is --dry-run.
    if (call.sub === 'commit' && call.args.some((a) => /^-[a-zA-Z]*n[a-zA-Z]*$/.test(a))) return 'git commit -n';
  }
  return null;
}

const why = refusal();
if (why) {
  process.stderr.write(`Blocked: ${why} skips the git hooks. Fix what the hook reports instead (AGENTS.md: never bypass a hook).\n`);
  process.exit(2);
}
