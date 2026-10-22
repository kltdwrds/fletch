import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

// The hook that carries a session across compaction and /clear. On SessionStart it prints the branch's handoff note
// after either, says a note exists on a new session, and stays silent otherwise. On PostToolUse it tells the agent,
// once per crossing, that the context has passed the handoff point.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const hook = path.join(root, '.claude/hooks/handoff.mjs');
const dirs = [];
after(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

/** A git repository on `branch` with one commit two hours old, and its handoff note `note` written an hour ago, when given. */
function repo({ branch = 'feat/x', note } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'handoff-'));
  dirs.push(dir);
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')));
  const git = (args, extra = {}) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: dir, env: { ...env, ...extra } });
  git(['init', '-q', '-b', branch]);
  writeFileSync(path.join(dir, '.gitignore'), '.claude/handoff/\n'); // as the repository's own .gitignore does
  writeFileSync(path.join(dir, 'tracked.txt'), 'a\n');
  git(['add', '.gitignore', 'tracked.txt']);
  const twoHoursAgo = new Date(Date.now() - 7200_000).toISOString();
  git(['commit', '-q', '-m', 'before the note'], { GIT_COMMITTER_DATE: twoHoursAgo, GIT_AUTHOR_DATE: twoHoursAgo });
  if (note !== undefined) {
    mkdirSync(path.join(dir, '.claude/handoff'), { recursive: true });
    const file = path.join(dir, '.claude/handoff', `${branch.replace(/[^\w.-]/g, '-')}.md`);
    writeFileSync(file, note);
    const hourAgo = new Date(Date.now() - 3600_000);
    utimesSync(file, hourAgo, hourAgo);
  }
  return { dir, git };
}

/** Runs the hook as Claude Code does on a SessionStart from `source`. */
function run(dir, source) {
  const input = JSON.stringify({ hook_event_name: 'SessionStart', source, cwd: dir });
  // An outer GIT_DIR (a git hook running this suite sets one) would point the hook's git at the wrong repository.
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')));
  const r = spawnSync(process.execPath, [hook], { input, env: { ...env, CLAUDE_PROJECT_DIR: dir }, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout;
}

describe('the handoff hook', () => {
  for (const source of ['compact', 'clear']) {
    it(`prints the note after a ${source}, with what git did since`, () => {
      const { dir, git } = repo({ note: '# feat/x: the goal\n\n## Next\nrun the tests\n' });
      git(['commit', '-q', '--allow-empty', '-m', 'after the note']);
      writeFileSync(path.join(dir, 'tracked.txt'), 'b\n');
      writeFileSync(path.join(dir, 'new.txt'), 'x');
      const out = run(dir, source);
      assert.match(out, /handoff note \(\.claude\/handoff\/feat-x\.md, written 60 min ago\)/);
      assert.match(out, /## Next\nrun the tests/);
      assert.match(out, /Commits since the note:\n\w+ after the note/);
      assert.doesNotMatch(out, /before the note/);
      assert.match(out, /Uncommitted changes:\n M tracked\.txt\n\?\? new\.txt/);
    });
  }

  it('says only that a note exists on a new session', () => {
    const out = run(repo({ note: 'the secret plan' }).dir, 'startup');
    assert.match(out, /A handoff note for feat\/x exists \(\.claude\/handoff\/feat-x\.md/);
    assert.doesNotMatch(out, /secret plan/);
  });

  it('names the note with only filename-safe characters', () => {
    const out = run(repo({ branch: 'feat/a"b|c', note: 'n' }).dir, 'startup');
    assert.match(out, /\.claude\/handoff\/feat-a-b-c\.md/);
  });

  it('is silent on a resume, which keeps its conversation', () => {
    assert.equal(run(repo({ note: 'n' }).dir, 'resume'), '');
  });

  it('is silent with no note, and on a detached HEAD', () => {
    assert.equal(run(repo().dir, 'compact'), '');
    const { dir, git } = repo({ note: 'n' });
    git(['checkout', '-q', '--detach']);
    assert.equal(run(dir, 'compact'), '');
  });

  it('cuts a long note under the context limit and points at the file', () => {
    const out = run(repo({ note: 'x'.repeat(20_000) }).dir, 'compact');
    assert.ok(out.length < 10_000, `printed ${out.length} characters`);
    assert.match(out, /cut at 9000 characters: read \.claude\/handoff\/feat-x\.md for the rest/);
  });
});

describe('the handoff nudge', () => {
  let n = 0;
  /** A transcript whose entries are `[tokens, sidechain]` turns, oldest first, and a session id of its own. */
  function transcript(turns) {
    const dir = mkdtempSync(path.join(tmpdir(), 'handoff-transcript-'));
    dirs.push(dir);
    const file = path.join(dir, 't.jsonl');
    const usage = (tokens) => ({ input_tokens: 2, cache_creation_input_tokens: 1000, cache_read_input_tokens: tokens - 1002, output_tokens: 50 });
    const lines = turns.map(([tokens, isSidechain = false]) => JSON.stringify({ type: 'assistant', isSidechain, message: { usage: usage(tokens) } }));
    writeFileSync(file, `${lines.join('\n')}\n`);
    n += 1;
    return { file, session: `test-${process.pid}-${n}` };
  }
  after(() => {
    for (let i = 1; i <= n; i += 1) rmSync(path.join(tmpdir(), `fletch-handoff-nudged-test-${process.pid}-${i}`), { force: true });
  });

  /**
   * Runs the hook after a tool call, as Claude Code does, in this repository (so its .claude/settings.json sets the
   * window), with the compaction variables only as `env` gives them, and returns the context it adds, or ''.
   */
  function tool(file, session, extra = {}, env = {}) {
    const input = JSON.stringify({ hook_event_name: 'PostToolUse', session_id: session, transcript_path: file, tool_name: 'Bash', ...extra });
    const base = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^CLAUDE_(AUTOCOMPACT_PCT_OVERRIDE|CODE_AUTO_COMPACT_WINDOW)$/.test(k)));
    const r = spawnSync(process.execPath, [hook], { input, env: { ...base, CLAUDE_PROJECT_DIR: root, ...env }, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout ? JSON.parse(r.stdout).hookSpecificOutput.additionalContext : '';
  }

  it('is silent below the handoff point', () => {
    const { file, session } = transcript([[100_000], [449_000]]);
    assert.equal(tool(file, session), '');
  });

  it('nudges once past it, and again only after the context has dropped below', () => {
    const t = transcript([[460_000]]);
    assert.match(tool(t.file, t.session), /context is at 460k tokens, past the handoff point \(450k\); auto-compaction runs near 500k\. Finish the current phase/);
    assert.equal(tool(t.file, t.session), '');
    writeFileSync(t.file, `${JSON.stringify({ type: 'assistant', message: { usage: { cache_read_input_tokens: 60_000 } } })}\n`);
    assert.equal(tool(t.file, t.session), '');
    writeFileSync(t.file, `${JSON.stringify({ type: 'assistant', message: { usage: { cache_read_input_tokens: 470_000 } } })}\n`);
    assert.match(tool(t.file, t.session), /at 470k tokens/);
  });

  it('nudges at 90% of where compaction really runs: the percentage override, then a window from the environment', () => {
    const t = transcript([[359_000]]);
    assert.equal(tool(t.file, t.session, {}, { CLAUDE_AUTOCOMPACT_PCT_OVERRIDE: '80' }), '');
    const u = transcript([[361_000]]);
    assert.match(tool(u.file, u.session, {}, { CLAUDE_AUTOCOMPACT_PCT_OVERRIDE: '80' }), /past the handoff point \(360k\); auto-compaction runs near 400k/);
    const v = transcript([[181_000]]);
    assert.match(tool(v.file, v.session, {}, { CLAUDE_CODE_AUTO_COMPACT_WINDOW: '200000' }), /handoff point \(180k\)/);
  });

  it('counts the main thread only, and never nudges a subagent', () => {
    const side = transcript([[100_000], [900_000, true]]);
    assert.equal(tool(side.file, side.session), '');
    const big = transcript([[500_000]]);
    assert.equal(tool(big.file, big.session, { agent_id: 'a1' }), '');
  });

  it('reads only the transcript\'s end, past a cut line', () => {
    const filler = JSON.stringify({ type: 'user', message: { content: 'x'.repeat(600 * 1024) } });
    const t = transcript([[500_000]]);
    writeFileSync(t.file, `${filler}\n${readFileSync(t.file, 'utf8')}`);
    assert.match(tool(t.file, t.session), /at 500k tokens/);
  });
});
