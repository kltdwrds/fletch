import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { findViolations, SCOPE, violationsIn } from './check-test-hygiene.mjs';

const script = fileURLToPath(new URL('./check-test-hygiene.mjs', import.meta.url));
const dirs = [];
after(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function repo(tree) {
  const dir = mkdtempSync(path.join(tmpdir(), 'test-hygiene-'));
  dirs.push(dir);
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')));
  execFileSync('git', ['init', '-q'], { cwd: dir, env });
  for (const [f, text] of Object.entries(tree)) {
    mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    writeFileSync(path.join(dir, f), text);
  }
  return dir;
}

const codes = (text) => violationsIn(text).map((v) => `${v.line} ${v.code}`);

describe('check-test-hygiene', () => {
  it('pins its scope: test/ and the vitest config, nothing else', () => {
    assert.equal(SCOPE.source, '^test\\/|^vitest(?:\\.[\\w-]+)?\\.config\\.[cm]?[jt]s$');
    for (const f of ['test/m0/a.test.ts', 'test/support/x.ts', 'vitest.config.ts', 'vitest.workspace.config.mts']) assert.ok(SCOPE.test(f), f);
    for (const f of ['scripts/a.test.mjs', 'packages/agent/src/a.ts', 'my-test/a.ts']) assert.ok(!SCOPE.test(f), f);
  });

  it('fails every form of a focused test', () => {
    const text = 'describe.only("a", () => {});\nit.only("b", () => {});\ntest.concurrent.only("c", () => {});\nsuite . only("d");\nit.only.each([1])("e", () => {});\n';
    assert.deepEqual(codes(text), ['1 focused-test', '2 focused-test', '3 focused-test', '4 focused-test', '5 focused-test']);
  });

  it('fails a retry in options or config', () => {
    assert.deepEqual(codes('it("a", { retry: 3 }, () => {});\nexport default { test: { retry : 2 } };\nx.retry(2);\n'), ['1 test-retry', '2 test-retry', '3 test-retry']);
  });

  it('fails every sleep-style wait', () => {
    const text = [
      'await new Promise((r) => setTimeout(r, 10));',
      'setInterval(poll, 5);',
      'await sleep(100);',
      "import { setTimeout as wait } from 'node:timers/promises';",
      'Atomics.wait(buf, 0, 0, 10);',
      'await scheduler.wait(5);',
      'await vi.waitFor(() => expect(x).toBe(1));',
      'await vi.waitUntil(() => ready);',
      "const t = await import('timers/promises');",
    ].join('\n');
    assert.deepEqual(codes(text), ['1 sleep-wait', '2 sleep-wait', '3 sleep-wait', '4 sleep-wait', '5 sleep-wait', '6 sleep-wait', '7 sleep-wait', '8 sleep-wait', '9 sleep-wait']);
  });

  it('allows the words in titles, strings, comments and look-alike names', () => {
    const text = [
      'it("rejects .only and retry: and setTimeout(", () => {});',
      'const planted = "describe.only(\\"x\\")";',
      '// it.only("commented out")',
      '/* await sleep(1) */',
      'const onlyOne = list.only;',
      'const retryCount = 1;',
      'const asleep = 1; mySleep; settimeout;',
      'vi.useFakeTimers();',
    ].join('\n');
    assert.deepEqual(codes(text), []);
  });

  it('reads only test/ and the vitest config in a repository', () => {
    const dir = repo({ 'test/a.test.ts': 'it.only("x", () => {});\n', 'vitest.config.ts': 'export default { test: { retry: 1 } };\n', 'scripts/b.test.mjs': 'it.only("y", () => {});\n', 'packages/agent/src/c.ts': 'setTimeout(f, 1);\n' });
    assert.deepEqual(findViolations(dir).map((v) => `${v.file}:${v.line} ${v.code}`), ['test/a.test.ts:1 focused-test', 'vitest.config.ts:1 test-retry']);
  });

  it('fails a planted .only when run as a script, and passes a clean tree', () => {
    const bad = repo({ 'test/m9/x.test.ts': 'describe("[M9] x", () => {\n  it.only("y", () => {});\n});\n' });
    const r = spawnSync(process.execPath, [script], { cwd: bad, encoding: 'utf8' });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /test\/m9\/x\.test\.ts:2: focused-test/);
    const good = repo({ 'test/m9/x.test.ts': 'describe("[M9] x", () => {\n  it("y", () => {});\n});\n' });
    assert.equal(spawnSync(process.execPath, [script], { cwd: good, encoding: 'utf8' }).status, 0);
  });
});
