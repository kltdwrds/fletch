import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

// ci.yml's "Classify the diff" step, run as CI runs it: its own bash, real git in a scratch repository, a pull
// request's base and head, and $GITHUB_OUTPUT read back. A diff judged anything but code skips the suite, so every
// way a code change could pass for docs is planted here.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ci = readFileSync(path.join(root, '.github/workflows/ci.yml'), 'utf8').split('\n');

// A step's `run: |` block, dedented.
const stepScript = (name) => {
  const at = ci.findIndex((l) => l.trimStart() === `- name: ${name}`);
  assert.ok(at >= 0, `ci.yml has no ${name} step`);
  const run = ci.findIndex((l, i) => i > at && /^\s+run: \|$/.test(l));
  const indent = ci[run + 1].match(/^ */)[0].length;
  const body = [];
  for (const l of ci.slice(run + 1)) {
    if (l.trim() && l.match(/^ */)[0].length < indent) break;
    body.push(l.slice(indent));
  }
  return body.join('\n');
};
const script = stepScript('Classify the diff');

const scratch = mkdtempSync(path.join(tmpdir(), 'ci-classify-'));
after(() => rmSync(scratch, { recursive: true, force: true }));

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

let n = 0;
// A repository with a base commit, then one commit applying `change` (path → content, or null to delete).
const pr = (change, base = {}, baseSha) => {
  const dir = path.join(scratch, `r${n++}`);
  mkdirSync(dir);
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 'sam@solo-sam.example');
  git(dir, 'config', 'user.name', 'Sam Solo');
  const write = (files) => {
    for (const [f, c] of Object.entries(files)) {
      if (c === null) rmSync(path.join(dir, f));
      else {
        mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
        writeFileSync(path.join(dir, f), c);
      }
    }
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '--allow-empty', '-m', 'c');
    return git(dir, 'rev-parse', 'HEAD');
  };
  const PR_BASE = write({ 'README.md': 'r\n', 'docs/a.md': 'a\n', 'src/x.ts': 'x\n', ...base });
  const PR_HEAD = write(change);
  const out = path.join(dir, '.out');
  writeFileSync(out, '');
  const log = execFileSync('bash', ['-c', script], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, PR_BASE: baseSha ?? PR_BASE, PR_HEAD, GITHUB_OUTPUT: out } });
  const o = Object.fromEntries(readFileSync(out, 'utf8').trim().split('\n').map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
  return { ...o, named: (o.named ?? '').trim().split(/\s+/).filter(Boolean), log };
};

const C = 'docs/plan-v2/contracts/P9-x.md';
const named = { [C]: 'c\n', 'test/p9.test.ts': `const C = "${C}";\n`, 'test/other.test.ts': 'nothing\n' };

describe('ci.yml classifies a pull request diff', () => {
  it('docs only: under docs/, a root Markdown file or LICENSE', () => {
    assert.equal(pr({ 'docs/a.md': 'b\n', 'README.md': 's\n', LICENSE: 'l\n' }).class, 'docs');
  });

  it('code: anything else, including Markdown outside docs/ and a dotfile at the root', () => {
    assert.equal(pr({ 'src/x.ts': 'y\n' }).class, 'code');
    assert.equal(pr({ 'packages/p/README.md': 'p\n' }).class, 'code');
    assert.equal(pr({ '.gitignore': 'g\n' }).class, 'code');
    assert.equal(pr({ 'docs/a.md': 'b\n', 'src/x.ts': 'y\n' }).class, 'code');
  });

  it('code: a deleted code file, and a code file moved under docs/ (no rename detection)', () => {
    assert.equal(pr({ 'src/x.ts': null }).class, 'code');
    assert.equal(pr({ 'src/x.ts': null, 'docs/x.ts': 'x\n' }).class, 'code');
  });

  it('code: an empty diff, or a base not in the clone, so a diff that cannot be judged runs everything', () => {
    assert.equal(pr({}).class, 'code');
    assert.equal(pr({ 'docs/a.md': 'b\n' }, {}, 'f'.repeat(40)).class, 'code');
  });

  it('contracts: a changed contract names the test files that name it, and only those', () => {
    const r = pr({ [C]: 'changed\n', 'docs/a.md': 'b\n' }, named);
    assert.equal(r.class, 'contracts');
    assert.deepEqual(r.named, ['test/p9.test.ts']);
  });

  it('contracts: a deleted contract still names the tests that read it, so they fail', () => {
    const r = pr({ [C]: null }, named);
    assert.equal(r.class, 'contracts');
    assert.deepEqual(r.named, ['test/p9.test.ts']);
  });

  it('contracts: one no test names falls back to the tests that name its folder', () => {
    const r = pr({ 'docs/plan-v2/contracts/P99-new.md': 'n\n' }, named);
    assert.equal(r.class, 'contracts');
    assert.deepEqual(r.named, ['test/p9.test.ts']);
  });

  it('contracts: a committed eval result, read by its folder, brings the test that reads the folder', () => {
    const R = 'docs/plan-v2/evidence/results';
    const r = pr({ [`${R}/abc.json`]: '{"x":2}\n' }, { [`${R}/abc.json`]: '{"x":1}\n', 'test/r.test.ts': `const R = "${R}";\n` });
    assert.equal(r.class, 'contracts');
    assert.deepEqual(r.named, ['test/r.test.ts']);
  });

  it('contracts: when neither the file nor its folder is named, check alone, and says so', () => {
    const r = pr({ 'docs/plan-v2/contracts/P99-new.md': 'n\n' }, { 'test/other.test.ts': 'nothing\n' });
    assert.equal(r.class, 'contracts');
    assert.deepEqual(r.named, []);
    assert.match(r.log, /The files that name them: none/);
  });

  it('code: a contract beside a code change runs everything', () => {
    assert.equal(pr({ [C]: 'changed\n', 'test/p9.test.ts': 'edited\n' }, named).class, 'code');
  });

  it('says which files decided a code diff', () => {
    assert.match(pr({ 'docs/a.md': 'b\n', 'src/x.ts': 'y\n' }).log, /Judged: code\..*\n {2}src\/x\.ts\n/);
  });
});

describe('ci.yml gives one status over the jobs', () => {
  const status = stepScript('Every job passed or was skipped by the classification');
  const ok = (CLASS, scope, check, test) => {
    try {
      execFileSync('bash', ['-c', status], { encoding: 'utf8', env: { PATH: process.env.PATH, CLASS, RESULTS: `${scope} ${check} ${test}` } });
      return true;
    } catch {
      return false;
    }
  };

  it('passes code with every job passed, and docs or contracts with test skipped', () => {
    assert.ok(ok('code', 'success', 'success', 'success'));
    assert.ok(ok('docs', 'success', 'success', 'skipped'));
    assert.ok(ok('contracts', 'success', 'success', 'skipped'));
  });

  it('fails code whose tests failed, were cancelled or skipped', () => {
    for (const t of ['failure', 'cancelled', 'skipped']) assert.equal(ok('code', 'success', 'success', t), false, t);
  });

  it('fails a failed scope or check, whatever the class', () => {
    assert.equal(ok('docs', 'success', 'failure', 'skipped'), false);
    assert.equal(ok('code', 'failure', 'success', 'success'), false);
  });

  it('fails a missing or unknown class rather than reading it as docs', () => {
    assert.equal(ok('', 'success', 'success', 'skipped'), false);
    assert.equal(ok('other', 'success', 'success', 'skipped'), false);
  });
});
