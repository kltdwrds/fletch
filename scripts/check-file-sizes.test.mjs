import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { countLines, findViolations, POLICY } from './check-file-sizes.mjs';

const script = fileURLToPath(new URL('./check-file-sizes.mjs', import.meta.url));
const policy = { ...POLICY, maxLines: 5 };
const lines = (n) => `${Array.from({ length: n }, (_, i) => `line ${i}`).join('\n')}\n`;
const dirs = [];
after(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function repo(files, ignore = '') {
  const dir = mkdtempSync(path.join(tmpdir(), 'file-sizes-'));
  dirs.push(dir);
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')));
  execFileSync('git', ['init', '-q'], { cwd: dir, env });
  for (const [f, text] of Object.entries({ '.gitignore': ignore, ...files })) {
    mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    writeFileSync(path.join(dir, f), text);
  }
  return dir;
}

describe('check-file-sizes', () => {
  it('pins the production policy: a flat 600-line cap over packages/', () => {
    assert.deepEqual(POLICY, { roots: ['packages/'], extensions: ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'], maxLines: 600 });
  });

  it('counts lines with or without a final newline', () => {
    assert.equal(countLines(''), 0);
    assert.equal(countLines('a'), 1);
    assert.equal(countLines('a\n'), 1);
    assert.equal(countLines('a\nb'), 2);
  });

  it('passes a file at the cap and fails one over it, tracked or untracked', () => {
    const dir = repo({ 'packages/p/src/ok.ts': lines(5), 'packages/p/src/big.mjs': lines(6), 'packages/q/x.tsx': lines(7) });
    assert.deepEqual(findViolations(dir, policy), [
      { file: 'packages/p/src/big.mjs', lines: 6, limit: 5 },
      { file: 'packages/q/x.tsx', lines: 7, limit: 5 },
    ]);
  });

  it('ignores files outside packages/, other extensions, and ignored files such as generated types', () => {
    const dir = repo({ 'scripts/long.ts': lines(50), 'packages/p/notes.md': lines(50), 'packages/p/worker-configuration.d.ts': lines(50) }, 'worker-configuration.d.ts\n');
    assert.deepEqual(findViolations(dir, policy), []);
  });

  it('fails a planted 601-line file under packages/ when run as a script, and passes 600 lines', () => {
    const bad = repo({ 'packages/agent/src/big.ts': lines(601) });
    const r = spawnSync(process.execPath, [script], { cwd: bad, encoding: 'utf8' });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /packages\/agent\/src\/big\.ts: 601 lines; the cap is 600/);
    const good = repo({ 'packages/agent/src/big.ts': lines(600) });
    assert.equal(spawnSync(process.execPath, [script], { cwd: good, encoding: 'utf8' }).status, 0);
  });
});
