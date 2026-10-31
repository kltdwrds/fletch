// The evidence mirror: copies what is new, never overwrites or deletes what is there, and never fails the caller.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { mirror } from './evidence-mirror.mjs';

const script = fileURLToPath(new URL('./evidence-mirror.mjs', import.meta.url));
const dirs = [];
after(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
const tmp = (name) => {
  const d = mkdtempSync(path.join(tmpdir(), `${name}-`));
  dirs.push(d);
  return d;
};
const run = (...args) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });

describe('evidence-mirror', () => {
  it('copies new files, keeps the destination copy of a changed one, and deletes nothing', () => {
    const from = tmp('from');
    const to = tmp('to');
    mkdirSync(path.join(from, 'p1-reactions/answers'), { recursive: true });
    writeFileSync(path.join(from, 'p1-reactions/answers/step-1.md'), 'one');
    writeFileSync(path.join(from, 'p1-reactions/step-1.png'), Buffer.from([1, 2, 3]));
    assert.deepEqual(mirror(from, to), { copied: 2, kept: 0 });
    writeFileSync(path.join(from, 'p1-reactions/answers/step-1.md'), 'changed at the source');
    writeFileSync(path.join(to, 'only-at-the-mirror.md'), 'kept');
    rmSync(path.join(from, 'p1-reactions/step-1.png'));
    assert.deepEqual(mirror(from, to), { copied: 0, kept: 1 });
    assert.equal(readFileSync(path.join(to, 'p1-reactions/answers/step-1.md'), 'utf8'), 'one');
    assert.ok(existsSync(path.join(to, 'p1-reactions/step-1.png')));
    assert.ok(existsSync(path.join(to, 'only-at-the-mirror.md')));
  });

  it('as a command, reports its counts and exits 0', () => {
    const from = tmp('from');
    const to = tmp('to');
    writeFileSync(path.join(from, 'a.json'), '{}');
    const res = run('--from', from, '--to', to);
    assert.equal(res.status, 0);
    assert.match(res.stdout, /copied 1, kept 0/);
    assert.ok(existsSync(path.join(to, 'a.json')));
  });

  it('exits 0 and says so when the source is missing or the destination cannot be written', () => {
    const missing = run('--from', path.join(tmp('none'), 'absent'), '--to', tmp('to'));
    assert.equal(missing.status, 0);
    assert.match(missing.stderr, /skipped \(no evidence folder/);
    const from = tmp('from');
    writeFileSync(path.join(from, 'a.json'), '{}');
    const blocked = tmp('blocked');
    writeFileSync(path.join(blocked, 'file'), 'a file where a folder should be');
    const res = run('--from', from, '--to', path.join(blocked, 'file'));
    assert.equal(res.status, 0);
    assert.match(res.stderr, /skipped/);
  });
});
