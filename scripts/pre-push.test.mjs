import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { classify } from './pre-push.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const Z = '0'.repeat(40);

describe('classify: which gate a push runs', () => {
  const line = (local, remote) => `refs/heads/x ${local} refs/heads/x ${remote}`;
  const A = 'a'.repeat(40);
  const B = 'b'.repeat(40);

  it('any push that updates a ref runs check: docs, source, a new branch alike', () => {
    assert.equal(classify([line(A, B)]), 'check');
    assert.equal(classify([line(A, Z)]), 'check');
  });

  it('a push that only deletes refs runs nothing', () => {
    assert.equal(classify([line(Z, B)]), null);
    assert.equal(classify([line(Z, B), line(Z, A)]), null);
  });

  it('a deletion beside an update runs check', () => {
    assert.equal(classify([line(Z, B), line(A, B)]), 'check');
  });


  it('no refs, a blank line or a malformed line runs check, never nothing', () => {
    assert.equal(classify([]), 'check');
    assert.equal(classify(['']), 'check');
    assert.equal(classify([`${line(Z, B)} extra`]), 'check');
  });
});

// The script itself, as the hook runs it: real git in a scratch repository, with a stand-in pnpm on
// PATH that records which gate it was asked for and exits with a chosen status.
describe('pre-push.mjs, run as the hook runs it', () => {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')));
  const dirs = [];
  after(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
  });
  const git = (cwd, ...args) => execFileSync('git', args, { cwd, env, encoding: 'utf8' }).trim();

  function scratch() {
    const dir = mkdtempSync(path.join(tmpdir(), 'pre-push-'));
    dirs.push(dir);
    git(dir, 'init', '-q', '-b', 'main');
    git(dir, 'config', 'user.email', 'sam@solo-sam.example');
    git(dir, 'config', 'user.name', 'Sam Solo');
    const commit = (files) => {
      for (const [f, text] of Object.entries(files)) {
        mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
        writeFileSync(path.join(dir, f), text);
      }
      git(dir, 'add', '-A');
      git(dir, 'commit', '-q', '-m', 'c');
      return git(dir, 'rev-parse', 'HEAD');
    };
    const base = commit({ 'src/a.ts': 'a\n', 'docs/a.md': 'a\n' });
    git(dir, 'update-ref', 'refs/remotes/origin/main', base);
    // Outside the repository, so no commit picks them up.
    const bin = mkdtempSync(path.join(tmpdir(), 'pre-push-bin-'));
    dirs.push(bin);
    writeFileSync(path.join(bin, 'pnpm'), '#!/bin/sh\necho "$@" > "$PNPM_LOG"\nexit "$PNPM_EXIT"\n', { mode: 0o755 });
    return { dir, base, commit, bin };
  }

  /** Runs the script, or with `shell` the hook command package.json installs, in the scratch repository. */
  function hook({ dir, bin }, stdin, exit = 0, shell = false) {
    const log = path.join(bin, 'pnpm-log');
    rmSync(log, { force: true });
    const command = shell ? ['sh', ['-c', JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))['simple-git-hooks']['pre-push']]] : [process.execPath, [path.join(root, 'scripts/pre-push.mjs')]];
    const r = spawnSync(...command, {
      cwd: dir,
      input: stdin,
      env: { ...env, PATH: `${bin}${path.delimiter}${env.PATH}`, PNPM_LOG: log, PNPM_EXIT: String(exit) },
      encoding: 'utf8',
    });
    let ran = null;
    try {
      ran = readFileSync(log, 'utf8').trim();
    } catch {}
    return { status: r.status, out: r.stdout + r.stderr, ran };
  }

  it('a new branch changing only docs/ runs pnpm check, says so, and exits with its status', () => {
    const s = scratch();
    const head = s.commit({ 'docs/b.md': 'b\n' });
    const r = hook(s, `refs/heads/f ${head} refs/heads/f ${Z}\n`);
    assert.equal(r.ran, 'check');
    assert.equal(r.status, 0);
    assert.match(r.out, /the tests run in CI/);
    assert.equal(hook(s, `refs/heads/f ${head} refs/heads/f ${Z}\n`, 3).status, 3);
  });

  it('an update that changes source runs pnpm check and exits with its status', () => {
    const s = scratch();
    const head = s.commit({ 'docs/b.md': 'b\n', 'src/b.ts': 'b\n' });
    const r = hook(s, `refs/heads/f ${head} refs/heads/f ${s.base}\n`);
    assert.equal(r.ran, 'check');
    assert.equal(r.status, 0);
    assert.equal(hook(s, `refs/heads/f ${head} refs/heads/f ${s.base}\n`, 1).status, 1);
  });

  it('a push that moves a file into docs/ still runs pnpm check', () => {
    const s = scratch();
    git(s.dir, 'mv', 'src/a.ts', 'docs/a.ts');
    git(s.dir, 'commit', '-q', '-m', 'move');
    const head = git(s.dir, 'rev-parse', 'HEAD');
    assert.equal(hook(s, `refs/heads/f ${head} refs/heads/f ${s.base}\n`).ran, 'check');
  });

  it('a push naming a remote sha this clone does not have still runs pnpm check', () => {
    const s = scratch();
    const head = s.commit({ 'docs/b.md': 'b\n' });
    assert.equal(hook(s, `refs/heads/f ${head} refs/heads/f ${'d'.repeat(40)}\n`).ran, 'check');
  });

  it('a deleted ref runs nothing and exits 0', () => {
    const s = scratch();
    const r = hook(s, `(delete) ${Z} refs/heads/f ${s.base}\n`);
    assert.equal(r.ran, null);
    assert.equal(r.status, 0);
  });

  it("package.json's hook runs scripts/pre-push.mjs, and on a branch without it the whole gate", () => {
    const s = scratch();
    const head = s.commit({ 'docs/b.md': 'b\n' });
    const stdin = `refs/heads/f ${head} refs/heads/f ${s.base}\n`;
    assert.equal(hook(s, stdin, 0, true).ran, 'run --if-present check');
    assert.equal(hook(s, stdin, 4, true).status, 4);
    mkdirSync(path.join(s.dir, 'scripts'));
    copyFileSync(path.join(root, 'scripts/pre-push.mjs'), path.join(s.dir, 'scripts/pre-push.mjs'));
    assert.equal(hook(s, stdin, 0, true).ran, 'check');
  });
});
