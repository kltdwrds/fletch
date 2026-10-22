import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

// The wiring of the gates, after qyvr's scripts/gates.test.mjs: a check that nothing runs protects nothing. Each
// check's own test plants a violation; this one fails when a check, a hook or the CI step stops running it.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(root, f), 'utf8');
const pkg = JSON.parse(read('package.json'));
const steps = (script) => script.split('&&').map((s) => s.trim());
const checks = readdirSync(path.join(root, 'scripts')).filter((f) => /^check-.*\.mjs$/.test(f) && !f.endsWith('.test.mjs')).sort();

describe('the gates are wired', () => {
  it('every scripts/check-*.mjs has a test beside it and runs in `pnpm harness`, with both scans', () => {
    assert.ok(checks.length >= 5, checks.join(', '));
    const harness = steps(pkg.scripts.harness);
    for (const c of checks) {
      assert.ok(existsSync(path.join(root, 'scripts', c.replace(/\.mjs$/, '.test.mjs'))), `${c} has no test`);
      assert.ok(harness.includes(`node scripts/${c}`), `${c} is not in pnpm harness`);
    }
    assert.ok(harness.includes('node scripts/scans.ts secret'));
    assert.ok(harness.includes('node scripts/scans.ts privacy'));
  });

  it('accept runs the same harness checks', () => {
    const listed = /const HARNESS_CHECKS = \[([^\]]*)\]/.exec(read('scripts/accept.ts'))?.[1] ?? '';
    const inAccept = [...listed.matchAll(/"scripts\/([^"]+)"/g)].map((m) => m[1]).sort();
    assert.deepEqual(inAccept, checks);
  });

  it('check is lint, harness, typecheck; verify is check then the tests', () => {
    assert.deepEqual(steps(pkg.scripts.check), ['pnpm lint', 'pnpm harness', 'pnpm typecheck']);
    assert.deepEqual(steps(pkg.scripts.verify), ['pnpm check', 'pnpm test']);
    assert.match(pkg.scripts.test, /node --test scripts\/\*\.test\.mjs/);
  });

  it('the git hooks run the pre-commit scans and the pre-push check', () => {
    assert.equal(pkg.scripts.prepare, 'simple-git-hooks');
    assert.equal(pkg['simple-git-hooks']['pre-commit'], 'node scripts/pre-commit.ts');
    assert.match(pkg['simple-git-hooks']['pre-push'], /node scripts\/pre-push\.mjs/);
  });

  it('CI and the release run pnpm verify', () => {
    for (const wf of ['.github/workflows/ci.yml', '.github/workflows/release.yml']) {
      assert.match(read(wf), /^\s+run: pnpm verify$/m, wf);
      assert.doesNotMatch(read(wf), /run: pnpm check$/m, wf);
    }
  });

  it('Claude Code runs the hook guard, the handoff hook and the session start', () => {
    const settings = JSON.parse(read('.claude/settings.json'));
    const commands = (event) => (settings.hooks[event] ?? []).flatMap((h) => h.hooks.map((x) => ({ matcher: h.matcher, command: x.command })));
    assert.ok(commands('PreToolUse').some((h) => h.matcher === 'Bash' && h.command.includes('.claude/hooks/no-hook-bypass.mjs')));
    assert.ok(commands('PostToolUse').some((h) => h.command.includes('.claude/hooks/handoff.mjs')));
    assert.ok(commands('SessionStart').some((h) => h.command.includes('.claude/hooks/handoff.mjs')));
    assert.ok(commands('SessionStart').some((h) => h.command.includes('.claude/hooks/session-start.mjs')));
    assert.ok(settings.autoCompactWindow > 0, 'the handoff hook needs a window');
    for (const f of ['no-hook-bypass.mjs', 'handoff.mjs', 'session-start.mjs']) assert.ok(existsSync(path.join(root, '.claude/hooks', f)), f);
  });
});
