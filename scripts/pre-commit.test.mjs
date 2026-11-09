import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { conflictMarkers, preCommit } from './pre-commit.ts';
import { PEOPLE_FILE, stagedIndex } from './scans.ts';

// The pre-commit hook's own plant (Q61): a staged git conflict marker is refused by name, on the hook's production
// path (preCommit over a real index), and a Markdown setext underline is not.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dirs = [];
after(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

// Marker lines are joined here, never written at the start of a source line, so this file passes the hook itself.
const START = '<<<<<<< HEAD';
const SEPARATOR = '=======';
const END = '>>>>>>> other';
const BASE = '||||||| base';
const conflicted = ['# Ledger', '', START, 'ours', SEPARATOR, 'theirs', END, ''].join('\n');
const setext = ['Title', SEPARATOR, '', 'A heading with a setext underline, not a conflict.', ''].join('\n');

/** A fresh repository with `tree` staged, Biome reachable and the people file the privacy scan needs. */
function staged(tree) {
  const dir = mkdtempSync(path.join(tmpdir(), 'pre-commit-'));
  dirs.push(dir);
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')));
  const git = (...args) => execFileSync('git', args, { cwd: dir, env, encoding: 'utf8' });
  git('init', '-q');
  writeFileSync(path.join(dir, '.git/info/exclude'), '/node_modules\n');
  symlinkSync(path.join(root, 'node_modules'), path.join(dir, 'node_modules'));
  mkdirSync(path.dirname(path.join(dir, PEOPLE_FILE)), { recursive: true });
  copyFileSync(path.join(root, PEOPLE_FILE), path.join(dir, PEOPLE_FILE));
  for (const [f, text] of Object.entries(tree)) {
    mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    writeFileSync(path.join(dir, f), text);
  }
  git('add', '-A');
  return dir;
}

describe('pre-commit: conflict markers', () => {
  it('names every marker line of a staged Markdown file, by file and line, never by text', () => {
    const dir = staged({ 'docs/SCORECARD.md': conflicted });
    assert.deepEqual(conflictMarkers(stagedIndex(dir)), [
      { file: 'docs/SCORECARD.md', line: 3, rule: 'conflict-marker' },
      { file: 'docs/SCORECARD.md', line: 5, rule: 'conflict-marker' },
      { file: 'docs/SCORECARD.md', line: 7, rule: 'conflict-marker' },
    ]);
  });

  it('a lone ======= (a setext heading underline) is not a marker; one after a <<<<<<< is', () => {
    const dir = staged({ 'docs/notes.md': setext, 'docs/log.md': [setext, START, SEPARATOR, END, ''].join('\n') });
    assert.deepEqual(
      conflictMarkers(stagedIndex(dir)).map((f) => `${f.file}:${f.line}`),
      ['docs/log.md:6', 'docs/log.md:7', 'docs/log.md:8'],
    );
  });

  it('a lone end or base marker is refused too, in any text file; a binary blob is skipped', () => {
    const dir = staged({ 'a.txt': `${END}\n`, 'b.ts': `x\n${BASE}\n`, 'c.bin': `\0${START}\n` });
    assert.deepEqual(conflictMarkers(stagedIndex(dir)).map((f) => `${f.file}:${f.line}`), ['a.txt:1', 'b.ts:2']);
  });

  it('the hook refuses the commit with the code `conflict markers` and the lines, before the scans', () => {
    const dir = staged({ 'docs/decisions/log.md': conflicted });
    const r = preCommit(dir);
    assert.equal(r.ok, false);
    assert.equal(r.refused, 'conflict markers');
    for (const line of [3, 5, 7]) assert.ok(r.lines.includes(`  docs/decisions/log.md:${line} conflict-marker`), r.lines.join('\n'));
    assert.ok(r.lines.some((l) => /^pre-commit: conflict markers: \d+ staged files, 3 findings$/.test(l)), r.lines.join('\n'));
    assert.ok(!r.lines.some((l) => l.includes('ours') || l.includes('theirs')), 'a finding names the text');
    assert.ok(!r.lines.some((l) => l.startsWith('pre-commit: secret scan')), 'the scans ran after the refusal');
  });

  it('the hook lets a clean commit through, a setext underline included, and says the step ran', () => {
    const dir = staged({ 'docs/notes.md': setext });
    const r = preCommit(dir);
    assert.equal(r.ok, true, r.lines.join('\n'));
    assert.ok(r.lines.some((l) => /^pre-commit: conflict markers: \d+ staged files, 0 findings$/.test(l)), r.lines.join('\n'));
    assert.ok(r.lines.some((l) => /^pre-commit: privacy scan: \d+ staged files, 0 findings$/.test(l)), r.lines.join('\n'));
  });
});
