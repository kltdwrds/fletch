import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { FIRST_CLUSTER_PART, check, partsViolations, scorecardViolations } from './check-plan.mjs';

const script = fileURLToPath(new URL('./check-plan.mjs', import.meta.url));
const dirs = [];
after(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
function tree(files) {
  const dir = mkdtempSync(path.join(tmpdir(), 'plan-'));
  dirs.push(dir);
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')));
  execFileSync('git', ['init', '-q'], { cwd: dir, env });
  for (const [f, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    writeFileSync(path.join(dir, f), text);
  }
  return dir;
}
const codes = (vs) => vs.map((v) => `${v.line} ${v.code}`);
const header = '| cluster | level | tasks | evidence | last verified |\n|---|---|---|---|---|\n';

describe('check-plan', () => {
  it('fails a scorecard level of 2 or more that cites no evidence file, a missing one, or no PR, in the planted rows only', () => {
    const exists = (f) => f === 'docs/plan-v2/evidence/results/abc123.json';
    const text = `${header}| P1 | 1 | 0/3 | nothing yet | |\n| P2 | 2 | 3/3 | docs/plan-v2/evidence/results/abc123.json, #41 | 2026-11-01 |\n| P3 | 2 | 3/3 | #42 | |\n| P4 | 3 | 3/3 | docs/plan-v2/evidence/results/gone.json #43 | |\n| P5 | 2 | 3/3 | docs/plan-v2/evidence/results/abc123.json | |\n`;
    assert.deepEqual(codes(scorecardViolations(text, exists)), ['5 scorecard-evidence', '6 scorecard-evidence', '7 scorecard-evidence']);
    assert.match(scorecardViolations(text, exists)[0].why, /names no file under docs\/plan-v2\/evidence\//);
    assert.match(scorecardViolations(text, exists)[1].why, /gone\.json, which does not exist/);
    assert.match(scorecardViolations(text, exists)[2].why, /names no PR/);
  });

  it(`fails a part from F${FIRST_CLUSTER_PART} that names no contract or a missing one; Phase 0 parts are exempt`, () => {
    const exists = (f) => f === 'docs/plan-v2/contracts/P2-loop.md';
    const text = [
      '## F18 The contract kit', '**Read:** the design.', '',
      `## F${FIRST_CLUSTER_PART} Loop one`, '**Read:** `contracts/P2-loop.md`, the code.', '',
      `## F${FIRST_CLUSTER_PART + 1} Loop two`, '**Read:** `docs/plan-v2/contracts/P2-gone.md`.', '',
      `### F${FIRST_CLUSTER_PART + 2}.1 Grants`, '**Read:** nothing named.', '',
    ].join('\n');
    assert.deepEqual(codes(partsViolations(text, exists)), ['7 part-contract', '10 part-contract']);
    assert.match(partsViolations(text, exists)[0].why, /P2-gone\.md, which does not exist/);
    assert.match(partsViolations(text, exists)[1].why, /names no contracts/);
  });

  it('passes a checkout without a scorecard, and reads both files from the checkout', () => {
    const clean = tree({ 'docs/plan-v2/parts.md': '## F18 Kit\n**Read:** x.\n' });
    assert.deepEqual(check(clean), []);
    const planted = tree({
      'docs/plan-v2/parts.md': `## F${FIRST_CLUSTER_PART} Loop\n**Read:** \`contracts/P2-loop.md\`.\n`,
      'docs/plan-v2/SCORECARD.md': `${header}| P2 | 2 | 3/3 | #7 | |\n`,
    });
    assert.deepEqual(check(planted).map((v) => v.code), ['scorecard-evidence', 'part-contract']);
  });

  it('exits 1 with each violation on stderr and the count on stdout', () => {
    const planted = tree({ 'docs/plan-v2/SCORECARD.md': `${header}| P2 | 3 | 3/3 | #7 | |\n` });
    let status = 0;
    let out = '';
    try {
      out = execFileSync('node', [script], { cwd: planted, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      status = e.status;
      out = `${e.stdout}${e.stderr}`;
    }
    assert.equal(status, 1);
    assert.match(out, /scorecard-evidence/);
    assert.match(out, /check-plan: 1 violation\(s\)/);
  });
});
