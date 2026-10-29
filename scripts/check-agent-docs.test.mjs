import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { BINDING, budgetOf, findViolations, inScope, violationsIn } from './check-agent-docs.mjs';

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
  it('pins its scope, and which files bind their paths and identifiers', () => {
    for (const f of ['AGENTS.md', 'packages/host/AGENTS.md', 'VISION.md', 'CONTRIBUTING.md', 'docs/runbooks/incident.md', 'docs/plan-v2/parts.md', 'skills/handoff/SKILL.md']) assert.ok(inScope(f), f);
    for (const f of ['README.md', 'CLAUDE.md', 'docs/plan/KICKOFF.md', 'docs/runbooks/a/b.md', 'docs/decisions/a/b.md']) assert.ok(!inScope(f), f);
    for (const f of ['AGENTS.md', 'docs/plan-v2/KICKOFF.md', 'docs/plan-v2/VERIFIER-PROMPT.md', 'docs/runbooks/a.md']) assert.ok(BINDING(f), f);
    for (const f of ['docs/plan-v2/parts.md', 'docs/plan-v2/PROGRESS.md', 'packages/agent/docs/platform/files.md', 'docs/decisions/0001-a.md', 'docs/decisions/log.md']) assert.ok(!BINDING(f), f);
    for (const f of ['docs/decisions/0001-a.md', 'docs/decisions/log.md']) assert.ok(inScope(f), f);
  });

  it('pins the line budgets', () => {
    assert.equal(budgetOf('AGENTS.md'), 200);
    assert.equal(budgetOf('docs/plan-v2/KICKOFF.md'), 200);
    assert.equal(budgetOf('skills/x/SKILL.md'), 200);
    assert.equal(budgetOf('packages/host/AGENTS.md'), 80);
    assert.equal(budgetOf('docs/plan-v2/parts.md'), null);
    const long = (n) => `${'x\n'.repeat(n)}`;
    assert.deepEqual(codes('packages/host/AGENTS.md', long(80)), []);
    assert.deepEqual(codes('packages/host/AGENTS.md', long(81)), ['81 line-budget']);
    assert.deepEqual(codes('AGENTS.md', long(201)), ['201 line-budget']);
  });

  it('fails a named path or identifier that does not exist, in binding files only', () => {
    const named = { ...ctx, known: (p) => ['scripts/accept.ts', 'packages/host/src/host.ts', 'packages/host/src'].includes(p), isDir: (d) => ['scripts', 'packages', 'packages/host', 'packages/host/src', 'src'].includes(d), mentioned: (w) => ['hostOf', 'HOST_NOT_SET'].includes(w) };
    const at = (file, text) => violationsIn(file, text, named).map((v) => `${v.line} ${v.code}`);
    const text = 'Run `scripts/accept.ts` and `scripts/gone.ts`; see `src/host.ts`; not `origin/main`, `@qyvr/host` or `/api`.\n`hostOf` `HOST_NOT_SET` `renamedAway()` `JSON.stringify` `plain`\n';
    assert.deepEqual(at('AGENTS.md', text), ['1 missing-path', '1 missing-path', '2 missing-identifier']);
    assert.deepEqual(at('packages/host/AGENTS.md', text), ['1 missing-path', '2 missing-identifier']);
    assert.deepEqual(at('docs/plan-v2/parts.md', text), []);
  });

  it('fails a broken relative link and passes a resolving one', () => {
    assert.deepEqual(codes('docs/runbooks/a.md', '# A\n## Steps\n[x](../missing.md) [y](../other.md#top) [z](https://example.test) [w](#here)\n'), ['3 broken-link']);
  });

  it('fails a pnpm script that does not exist, in fenced blocks only', () => {
    const text = '# A\n## Steps\n```sh\npnpm accept M1\npnpm tenant create\npnpm nonesuch now\npnpm run ghost\npnpm install\n```\nprose: pnpm nonesuch\n';
    assert.deepEqual(codes('docs/runbooks/a.md', text), ['6 unknown-script', '7 unknown-script']);
  });

  it('fails a reference to the dump', () => {
    assert.deepEqual(codes('AGENTS.md', `see ~/x/${['harness', 'dump'].join('-')}/y\n`), ['1 dump-reference']);
  });

  it('fails a secret-shaped string without printing it', () => {
    const v = violationsIn('AGENTS.md', `key ${'sk-ant-'}${'a'.repeat(30)}\n`, ctx);
    assert.deepEqual(v.map((x) => x.code), ['secret-shape']);
    assert.ok(!JSON.stringify(v).includes('aaaa'));
  });

  it('fails a runbook with no title or no Steps/When section, not other files', () => {
    assert.deepEqual(codes('docs/runbooks/a.md', 'text\n## Steps\n'), ['1 runbook-shape']);
    assert.deepEqual(codes('docs/runbooks/a.md', '# A\nno sections\n'), ['1 runbook-shape']);
    assert.deepEqual(codes('docs/runbooks/a.md', '# A\n## When\nx\n'), []);
    assert.deepEqual(codes('docs/runbooks/README.md', '# Runbooks\n'), []);
    assert.deepEqual(codes('AGENTS.md', 'no heading\n'), []);
  });

  it('the CLI exits 1 on a violation and 0 on a clean repository', () => {
    const bad = repo({ 'docs/runbooks/a.md': '# A\n## Steps\n```\npnpm ghost\n```\n' });
    const r = spawnSync('node', [script], { cwd: bad, encoding: 'utf8' });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /unknown-script/);
    const good = repo({ 'docs/runbooks/a.md': '# A\n## Steps\n```\npnpm accept M1\n```\n', 'AGENTS.md': 'Run `docs/runbooks/a.md`.\n' });
    symlinkSync('AGENTS.md', path.join(good, 'CLAUDE.md'));
    assert.equal(spawnSync('node', [script], { cwd: good, encoding: 'utf8' }).status, 0);
    assert.deepEqual(findViolations(good), []);
  });

  it('fails an AGENTS.md without its CLAUDE.md link, a misnamed skill and a harness entry that is not a link', () => {
    const dir = repo({ 'AGENTS.md': 'x\n', 'packages/p/AGENTS.md': 'x\n', 'packages/p/CLAUDE.md': 'a copy\n', 'skills/handoff/SKILL.md': '---\nname: other\n---\n', '.claude/skills/stray/SKILL.md': '---\nname: stray\n---\n' });
    assert.deepEqual(findViolations(dir).map((v) => `${v.file} ${v.code}`), ['CLAUDE.md claude-link', 'packages/p/CLAUDE.md claude-link', 'skills/handoff/SKILL.md skill-name', '.claude/skills/stray harness-link']);
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
