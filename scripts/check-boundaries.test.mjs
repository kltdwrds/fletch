import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./check-boundaries.mjs', import.meta.url));
const dirs = [];
after(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

/** A throwaway repository holding `tree` (path -> contents); untracked files count, as in a working tree. */
function repo(tree) {
  const dir = mkdtempSync(path.join(tmpdir(), 'check-boundaries-'));
  dirs.push(dir);
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')));
  execFileSync('git', ['init', '-q'], { cwd: dir, env });
  for (const [f, text] of Object.entries(tree)) {
    mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    writeFileSync(path.join(dir, f), text);
  }
  return dir;
}

/** Run the check as a CLI in a throwaway repository. */
const run = (tree) => {
  const dir = repo(tree);
  const r = spawnSync('node', [script], { cwd: dir, encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
};

describe('check-boundaries', () => {
  it('exits zero on a clean tree', () => {
    const r = run({
      'packages/host/src/index.ts': 'export {};\n',
      'packages/host-cloudflare/src/index.ts': 'import { x } from "@qyvr/host";\nexport { x };\n',
    });
    assert.equal(r.code, 0, r.out);
  });

  it('no-fletch and no-deep-import: exits non-zero naming both planted files', () => {
    const r = run({
      'packages/host/src/x.ts': 'import { a } from "fletch";\nexport { a };\n',
      'packages/host/src/y.ts': 'import { k } from "@qyvr/host-cloudflare/src/keys.ts";\nexport { k };\n',
    });
    assert.notEqual(r.code, 0);
    assert.match(r.out, /packages\/host\/src\/x\.ts.*no-fletch/);
    assert.match(r.out, /packages\/host\/src\/y\.ts.*no-deep-import/);
  });

  it('no-fletch also catches fletch/ subpaths; a bare @qyvr/ package or one subpath-less scope passes', () => {
    const r = run({
      'packages/host/src/a.ts': 'import { a } from "fletch/agent";\nexport { a };\n',
      'packages/host/src/b.ts': 'import { b } from "@qyvr/host";\nexport { b };\n',
      'packages/host/src/c.ts': 'import { c } from "fletcher";\nexport { c };\n',
    });
    assert.notEqual(r.code, 0);
    assert.match(r.out, /a\.ts.*no-fletch/);
    assert.doesNotMatch(r.out, /b\.ts|c\.ts/);
  });
});
