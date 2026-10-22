#!/usr/bin/env node
// Claude Code hook (.claude/settings.json) that carries a long session across compaction and /clear. The agent
// keeps one note per branch, .claude/handoff/<branch>.md (git-ignored), with the handoff skill
// (skills/handoff/SKILL.md).
// - PostToolUse: once the context passes 90% of the point where auto-compaction runs, tells the agent, once, to
//   write the note when the current phase finishes; the compaction then follows on its own.
// - SessionStart: after a compaction or a /clear, prints the note into the fresh context, headed by how old it is
//   and what git did since, so the session resumes from a file rather than from a summary. A new session gets one
//   line saying a note exists.
// Tested by scripts/handoff-hook.test.mjs.
import { execFileSync } from 'node:child_process';
import { closeSync, existsSync, fstatSync, openSync, readFileSync, readSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

/** SessionStart's additionalContext limit is 10,000 characters; past it Claude Code shows only a preview. */
const MAX_CHARS = 9000;
/** The share of the way to auto-compaction at which the next phase finish becomes a handoff. */
const HANDOFF_SHARE = 0.9;
/** How much of the transcript's end is read to find the last turn's usage. */
const TAIL_BYTES = 512 * 1024;

const input = JSON.parse(readFileSync(0, 'utf8') || '{}');
const source = String(input.source ?? '');
const dir = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();

/**
 * Where auto-compaction runs, in tokens: the window (CLAUDE_CODE_AUTO_COMPACT_WINDOW, else the project's
 * autoCompactWindow in .claude/settings.json) times CLAUDE_AUTOCOMPACT_PCT_OVERRIDE, which can only lower it.
 * 0 when no window is set, so there is no nudge. A window saved with /autocompact or --autocompact is not seen.
 */
function compactAt() {
  let window = Number(process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW) || 0;
  if (!window) {
    try {
      window = Number(JSON.parse(readFileSync(path.join(dir, '.claude/settings.json'), 'utf8')).autoCompactWindow) || 0;
    } catch {
      return 0;
    }
  }
  const pct = Math.min(100, Math.max(1, Number(process.env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE) || 100));
  return (window * pct) / 100;
}

/** The main thread's context size at its last reply, from the usage the transcript records, or 0 when unknown. */
function contextTokens(transcript) {
  let text;
  try {
    const fd = openSync(transcript, 'r');
    const { size } = fstatSync(fd);
    const buf = Buffer.alloc(Math.min(size, TAIL_BYTES));
    readSync(fd, buf, 0, buf.length, size - buf.length);
    closeSync(fd);
    text = buf.toString('utf8');
  } catch {
    return 0;
  }
  for (const line of text.split('\n').reverse()) {
    if (!line.includes('"usage"')) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue; // the first line of the tail may be cut
    }
    const usage = entry?.message?.usage;
    if (entry.type !== 'assistant' || entry.isSidechain || !usage) continue;
    return (usage.input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0);
  }
  return 0;
}

if (input.hook_event_name === 'PostToolUse') {
  if (input.agent_id || !input.transcript_path) process.exit(0); // a subagent's context is its own
  const handoffAt = Math.round(compactAt() * HANDOFF_SHARE);
  if (!handoffAt) process.exit(0);
  const tokens = contextTokens(String(input.transcript_path));
  const marker = path.join(tmpdir(), `fletch-handoff-nudged-${String(input.session_id).replace(/[^\w-]/g, '')}`);
  if (tokens < handoffAt) {
    rmSync(marker, { force: true }); // below again, after a compaction: the next crossing nudges again
    process.exit(0);
  }
  if (existsSync(marker)) process.exit(0);
  writeFileSync(marker, '');
  const k = Math.round(tokens / 1000);
  const additionalContext = [
    `The context is at ${k}k tokens, past the handoff point (${Math.round(handoffAt / 1000)}k); auto-compaction runs near ${Math.round(compactAt() / 1000)}k.`,
    'Finish the current phase; do not stop mid-task. Then write the handoff note with the handoff skill and carry on:',
    'the compaction follows on its own, and the hook prints the note back after it.',
  ].join(' ');
  console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext } }));
  process.exit(0);
}

const git = (...args) => {
  try {
    return execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trimEnd();
  } catch {
    return '';
  }
};

const branch = git('symbolic-ref', '--short', '-q', 'HEAD');
if (!branch) process.exit(0); // a detached HEAD has no note
const file = path.join(dir, '.claude/handoff', `${branch.replace(/[^\w.-]/g, '-')}.md`);
let note;
let written;
try {
  note = readFileSync(file, 'utf8');
  written = statSync(file).mtime;
} catch {
  process.exit(0);
}
const rel = path.relative(dir, file);
const age = (() => {
  const minutes = Math.round((Date.now() - written.getTime()) / 60000);
  return minutes < 90 ? `${minutes} min` : `${Math.round(minutes / 60)} h`;
})();

if (source === 'startup') {
  console.log(`A handoff note for ${branch} exists (${rel}, written ${age} ago). If this session continues that work, read it first; if not, ignore it.`);
  process.exit(0);
}
if (source !== 'compact' && source !== 'clear') process.exit(0);

/** At most `n` lines of git's output, so a large tree cannot crowd the note out of the context. */
const head = (text, n = 30) => {
  const lines = text.split('\n');
  return lines.length > n ? [...lines.slice(0, n), `… and ${lines.length - n} more`].join('\n') : text;
};
const since = head(git('log', '--oneline', `--since=${written.toISOString()}`));
const dirty = head(git('status', '--short'));
const body = note.length > MAX_CHARS ? `${note.slice(0, MAX_CHARS)}\n\n[cut at ${MAX_CHARS} characters: read ${rel} for the rest]` : note;
console.log(
  [
    `# Resuming from the handoff note (${rel}, written ${age} ago)`,
    '',
    'The context was just compacted or cleared. This note, git and the files are the source of truth; a compaction summary is not.',
    since ? `Commits since the note:\n${since}` : 'No commits since the note.',
    dirty ? `Uncommitted changes:\n${dirty}` : 'The working tree is clean.',
    'Reconcile the note with these, refresh it with the handoff skill if it is behind, then continue from its Next step.',
    '',
    body,
  ].join('\n'),
);
