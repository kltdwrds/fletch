import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { countLines, findViolations, POLICY, resolveBase } from './check-file-sizes.mjs';

const script = fileURLToPath(new URL('./check-file-sizes.mjs', import.meta.url));

const policy = { ...POLICY, maxLines: 5 };
const lines = (n) => `${Array.from({ length: n }, (_, i) => `line ${i}`).join('\n')}\n`;
const dirs = [];
after(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function repo(files) {
  const dir = mkdtempSync(path.join(tmpdir(), 'ratchet-'));
  dirs.push(dir);
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')));
  const git = (...args) => execFileSync('git', args, { cwd: dir, env, stdio: 'pipe' });
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'sam@solo-sam.example');
  git('config', 'user.name', 'Sam Solo');
  const write = (fs) => {
    for (const [f, text] of Object.entries(fs)) {
      mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
      writeFileSync(path.join(dir, f), text);
    }
  };
  write({ 'README.md': 'x\n', ...files });
  git('add', '-A');
  git('commit', '-q', '-m', 'base');
  return { dir, write, git };
}

describe('check-file-sizes', () => {
  it('pins the production policy', () => {
    assert.deepEqual(POLICY, { roots: ['packages/'], extensions: ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'], maxLines: 600 });
  });

  it('counts lines with or without a final newline', () => {
    assert.equal(countLines(''), 0);
    assert.equal(countLines('a'), 1);
    assert.equal(countLines('a\n'), 1);
    assert.equal(countLines('a\nb'), 2);
  });

  it('passes a new file at the cap and fails one over it', () => {
    const r = repo({});
    r.write({ 'packages/p/src/ok.ts': lines(5), 'packages/p/src/big.ts': lines(6) });
    assert.deepEqual(
      findViolations(r.dir, 'HEAD', policy).map((v) => v.file),
      ['packages/p/src/big.ts'],
    );
  });

  it('lets a file already over the cap hold or shrink, never grow', () => {
    const r = repo({ 'packages/p/src/a.ts': lines(8), 'packages/p/src/b.ts': lines(8) });
    r.write({ 'packages/p/src/a.ts': lines(7), 'packages/p/src/b.ts': lines(9) });
    assert.deepEqual(findViolations(r.dir, 'HEAD', policy), [{ file: 'packages/p/src/b.ts', lines: 9, limit: 8, baseLines: 8 }]);
  });

  it('holds a file that grows past the cap from under it to the cap', () => {
    const r = repo({ 'packages/x/src/a.mjs': lines(3) });
    r.write({ 'packages/x/src/a.mjs': lines(6) });
    assert.equal(findViolations(r.dir, 'HEAD', policy).length, 1);
  });

  it('catches a file whose name git would quote', () => {
    const r = repo({});
    r.write({ 'packages/p/src/\u00e9.ts': lines(6), 'packages/p/src/a b.cts': lines(6) });
    assert.deepEqual(
      findViolations(r.dir, 'HEAD', policy).map((v) => v.file),
      ['packages/p/src/a b.cts', 'packages/p/src/\u00e9.ts'],
    );
  });

  it('lets a file already over the cap move without growing', () => {
    const r = repo({ 'packages/p/src/old.ts': lines(8) });
    r.git('mv', 'packages/p/src/old.ts', 'packages/p/src/new.ts');
    assert.deepEqual(findViolations(r.dir, 'HEAD', policy), []);
    r.write({ 'packages/p/src/new.ts': lines(9) });
    assert.deepEqual(findViolations(r.dir, 'HEAD', policy), [{ file: 'packages/p/src/new.ts', lines: 9, limit: 8, baseLines: 8 }]);
  });

  it('ignores files outside its roots and extensions', () => {
    const r = repo({});
    r.write({ 'scripts/long.ts': lines(50), 'packages/p/notes.md': lines(50), 'packages/p/data.json': lines(50) });
    assert.deepEqual(findViolations(r.dir, 'HEAD', policy), []);
  });

  it('fails, never passes, when the base is not a commit', () => {
    const r = repo({});
    assert.throws(() => findViolations(r.dir, 'no-such-ref', policy), /is not a commit here/);
  });

  it('fails when there is no origin/main to find a merge base with', () => {
    const r = repo({});
    assert.throws(() => resolveBase(r.dir, {}), /no merge base with origin\/main/);
  });

  it('takes an explicit base', () => {
    assert.equal(resolveBase('.', { CHECK_FILE_SIZES_BASE: 'abc' }), 'abc');
  });

  it('as a script, fails a planted 601-line file against the base, passes 600, and fails with no base', () => {
    const r = repo({});
    r.write({ 'packages/agent/src/big.ts': lines(601), 'packages/agent/src/ok.ts': lines(600) });
    const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_') && k !== 'CHECK_FILE_SIZES_BASE'));
    const run = (extra) => spawnSync(process.execPath, [script], { cwd: r.dir, env: { ...env, ...extra }, encoding: 'utf8' });
    const bad = run({ CHECK_FILE_SIZES_BASE: 'HEAD' });
    assert.equal(bad.status, 1);
    assert.match(bad.stderr, /packages\/agent\/src\/big\.ts: 601 lines; the cap is 600/);
    assert.doesNotMatch(bad.stderr, /ok\.ts/);
    const blind = run({});
    assert.equal(blind.status, 1);
    assert.match(blind.stderr, /no merge base with origin\/main/);
  });
});
