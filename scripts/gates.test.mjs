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

  it('the release verifies main; CI runs pnpm verify on a code diff, check alone on docs, check and the related tests on contracts', () => {
    const release = read('.github/workflows/release.yml');
    assert.match(release, /^on:\n {2}push:\n {4}branches: \[main\]$/m, 'release.yml no longer runs on every push to main');
    assert.match(release, /^\s+run: pnpm verify$/m);
    assert.doesNotMatch(release, /run: pnpm check$/m);
    const ci = read('.github/workflows/ci.yml');
    assert.match(ci, /^on:\n {2}pull_request:\n\n/m, 'ci.yml runs on pull_request alone (main is the release check job)');
    const ciSteps = ci.split(/\n {6}- /);
    const gate = (cls) => new RegExp(`^\\s+if: steps\\.scope\\.outputs\\.class ${cls}$`, 'm');
    assert.ok(ciSteps.some((s) => /^name: Classify the diff\n\s+id: scope$/m.test(s)), 'ci.yml has no Classify the diff step');
    const verify = ciSteps.filter((x) => /run: pnpm verify$/m.test(x));
    const check = ciSteps.filter((x) => /run: pnpm check$/m.test(x));
    const related = ciSteps.filter((x) => /pnpm exec vitest related --run /.test(x));
    assert.ok(verify.length && check.length && related.length, 'ci.yml lost a verify, check or contract tests step');
    for (const s of verify) assert.match(s, gate("== 'code'"), s);
    for (const s of check) assert.match(s, gate("!= 'code'"), s);
    for (const s of related) assert.match(s, gate("== 'contracts'"), s);
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
