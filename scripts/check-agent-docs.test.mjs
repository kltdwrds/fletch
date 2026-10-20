import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { findViolations, inScope, violationsIn } from './check-agent-docs.mjs';

const script = fileURLToPath(new URL('./check-agent-docs.mjs', import.meta.url));
const dirs = [];
after(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
const ctx = { exists: (p) => p === 'docs/other.md', scripts: new Set(['accept', 'tenant']) };
const codes = (file, text) => violationsIn(file, text, ctx).map((v) => `${v.line} ${v.code}`);

function repo(tree) {
  const dir = mkdtempSync(path.join(tmpdir(), 'agent-docs-'));
  dirs.push(dir);
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')));
  execFileSync('git', ['init', '-q'], { cwd: dir, env });
  const files = { 'package.json': '{"scripts":{"accept":"x"}}', ...tree };
  for (const [f, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    writeFileSync(path.join(dir, f), text);
  }
  return dir;
}

describe('check-agent-docs', () => {
  it('pins its scope', () => {
    for (const f of ['CLAUDE.md', 'docs/runbooks/incident.md', 'skills/handoff/SKILL.md']) assert.ok(inScope(f), f);
    for (const f of ['README.md', 'docs/plan-v2/KICKOFF.md', 'docs/runbooks/a/b.md']) assert.ok(!inScope(f), f);
  });

  it('fails a broken relative link and passes a resolving one', () => {
    assert.deepEqual(codes('docs/runbooks/a.md', '# A\n## Steps\n[x](../missing.md) [y](../other.md#top) [z](https://example.test) [w](#here)\n'), ['3 broken-link']);
  });

  it('fails a pnpm script that does not exist, in fenced blocks only', () => {
    const text = '# A\n## Steps\n```sh\npnpm accept M1\npnpm tenant create\npnpm nonesuch now\npnpm run ghost\npnpm install\n```\nprose: pnpm nonesuch\n';
    assert.deepEqual(codes('docs/runbooks/a.md', text), ['6 unknown-script', '7 unknown-script']);
  });

  it('fails a reference to the dump', () => {
    assert.deepEqual(codes('CLAUDE.md', `see ~/x/${['harness', 'dump'].join('-')}/y\n`), ['1 dump-reference']);
  });

  it('fails a secret-shaped string without printing it', () => {
    const v = violationsIn('CLAUDE.md', `key ${'sk-ant-'}${'a'.repeat(30)}\n`, ctx);
    assert.deepEqual(v.map((x) => x.code), ['secret-shape']);
    assert.ok(!JSON.stringify(v).includes('aaaa'));
  });

  it('fails a runbook with no title or no Steps/When section, not other files', () => {
    assert.deepEqual(codes('docs/runbooks/a.md', 'text\n## Steps\n'), ['1 runbook-shape']);
    assert.deepEqual(codes('docs/runbooks/a.md', '# A\nno sections\n'), ['1 runbook-shape']);
    assert.deepEqual(codes('docs/runbooks/a.md', '# A\n## When\nx\n'), []);
    assert.deepEqual(codes('docs/runbooks/README.md', '# Runbooks\n'), []);
    assert.deepEqual(codes('CLAUDE.md', 'no heading\n'), []);
  });

  it('the CLI exits 1 on a violation and 0 on a clean repository', () => {
    const bad = repo({ 'docs/runbooks/a.md': '# A\n## Steps\n```\npnpm ghost\n```\n' });
    const r = spawnSync('node', [script], { cwd: bad, encoding: 'utf8' });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /unknown-script/);
    const good = repo({ 'docs/runbooks/a.md': '# A\n## Steps\n```\npnpm accept M1\n```\n', 'CLAUDE.md': 'hi\n' });
    assert.equal(spawnSync('node', [script], { cwd: good, encoding: 'utf8' }).status, 0);
    assert.deepEqual(findViolations(good), []);
  });
});

describe('[M24.1] platform docs are in scope', () => {
  const doc = '---\nsummary: What it is.\nread_when: When needed.\n---\n# Title\n';
  it('puts packages/agent/docs/platform/*.md in scope', () => {
    assert.equal(inScope('packages/agent/docs/platform/approvals.md'), true);
    assert.equal(inScope('packages/agent/docs/other/x.md'), false);
  });
  it('accepts a manual with summary and read_when and fails one without, with a broken link, an unknown script or the dump', () => {
    const f = 'packages/agent/docs/platform/x.md';
    assert.deepEqual(codes(f, doc), []);
    assert.deepEqual(codes(f, '# Title\n'), ['1 docs-frontmatter']);
    assert.deepEqual(codes(f, '---\nsummary: a\n---\n'), ['1 docs-frontmatter']);
    assert.deepEqual(codes(f, `${doc}[x](missing.md)\n`), ['6 broken-link']);
    assert.deepEqual(codes(f, `${doc}\`\`\`\npnpm nothing\n\`\`\`\n`), ['7 unknown-script']);
    assert.deepEqual(codes(f, `${doc}see ${['harness', 'dump'].join('-')}\n`), ['6 dump-reference']);
  });
});
