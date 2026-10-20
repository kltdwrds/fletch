import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, symlinkSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { check, shellFiles } from './check-shell.mjs';

const script = fileURLToPath(new URL('./check-shell.mjs', import.meta.url));
const dirs = [];
after(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
const scratch = (p) => {
  const d = mkdtempSync(path.join(tmpdir(), p));
  dirs.push(d);
  return d;
};

function repo(tree) {
  const dir = scratch('shell-');
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')));
  execFileSync('git', ['init', '-q'], { cwd: dir, env });
  for (const [f, text] of Object.entries(tree)) {
    mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    writeFileSync(path.join(dir, f), text);
  }
  return dir;
}

/** A PATH holding only a fake `shellcheck` that exits with `status`, so the real one never answers. */
function fakeBin(status) {
  const bin = scratch('bin-');
  const f = path.join(bin, 'shellcheck');
  writeFileSync(f, `#!/bin/sh\necho "SC0000 planted finding" >&2\nexit ${status}\n`);
  chmodSync(f, 0o755);
  return bin;
}

describe('check-shell', () => {
  it('finds *.sh and shebang files, not scripts in other languages', () => {
    const dir = repo({ 'a.sh': 'echo\n', 'bin/run': '#!/usr/bin/env bash\necho\n', 'x.mjs': '#!/usr/bin/env node\n', 'notes.txt': 'plain\n' });
    assert.deepEqual(shellFiles(dir), ['a.sh', 'bin/run']);
  });

  it('passes with no shell files, even with no shellcheck on PATH', () => {
    const dir = repo({ 'x.mjs': '1\n' });
    assert.equal(check(dir, { PATH: '' }).code, 'none');
  });

  it('FAILS, stated, when there are shell files and shellcheck is not installed', () => {
    const dir = repo({ 'a.sh': 'echo\n' });
    const empty = scratch('empty-');
    assert.equal(check(dir, { PATH: empty }).code, 'shellcheck-missing');
    const gitDir = path.dirname(execFileSync('which', ['git'], { encoding: 'utf8' }).trim());
    const onlyGit = scratch('git-');
    symlinkSync(path.join(gitDir, 'git'), path.join(onlyGit, 'git'));
    const r = spawnSync(process.execPath, [script], { cwd: dir, encoding: 'utf8', env: { PATH: onlyGit } });
    assert.equal(r.status, 1);
    assert.match(r.stdout, /shellcheck-missing/);
  });

  it('fails on a finding and passes on a clean run', () => {
    const dir = repo({ 'a.sh': 'echo\n' });
    const bad = check(dir, { PATH: fakeBin(1) });
    assert.equal(bad.code, 'shellcheck-findings');
    assert.match(bad.output, /planted finding/);
    assert.equal(check(dir, { PATH: fakeBin(0) }).code, 'ok');
  });
});
