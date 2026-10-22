// Holds decision D-0007 (docs/decisions/0007-decision-records.md). The fixtures below plant ids that do not exist on
// purpose, so check-decisions skips this file when it looks for citations.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { findViolations, indexTable, LOG_MAX_BYTES, parse, WARN_DAYS } from './check-decisions.mjs';

const script = fileURLToPath(new URL('./check-decisions.mjs', import.meta.url));
const TODAY = '2026-10-22';
const dirs = [];
after(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

/** A record's text from front-matter fields; `body` defaults to a ruling. */
function record(fields, body = 'Ruling: X — because Y — if wrong, Z.\n') {
  const base = { id: 'D-0001', title: 'A decision', status: 'accepted', door: 'two-way', decided: '2026-10-01', decider: 'agent', confirmation: 'test/a.test.ts' };
  const all = { ...base, ...fields };
  const lines = Object.entries(all).filter(([, v]) => v !== undefined).map(([k, v]) => `${k}: ${v}`);
  return `---\n${lines.join('\n')}\n---\n${body}`;
}

/** Runs the check over an in-memory tree; the index is kept fresh unless `stale`. */
function run(tree, { stale = false, today = TODAY } = {}) {
  const files = { 'test/a.test.ts': '// holds D-0001\n', ...tree };
  const recordFiles = Object.keys(files).filter((f) => /^docs\/decisions\/\d{4}-/.test(f));
  if (!stale && recordFiles.length) {
    const records = recordFiles.sort().map((file) => ({ file, ...parse(files[file]) }));
    files['docs/decisions/README.md'] = `# Decisions\n\n<!-- index:begin (node scripts/check-decisions.mjs --write) -->\n${indexTable(records)}\n<!-- index:end -->\n`;
  }
  const result = findViolations(Object.keys(files), (f) => files[f], today);
  return { codes: result.violations.map((v) => `${v.file} ${v.code}`), warnings: result.warnings };
}

describe('check-decisions', () => {
  it('passes a well-formed accepted record held by a test that names it', () => {
    assert.deepEqual(run({ 'docs/decisions/0001-a.md': record({}) }).codes, []);
  });

  it('fails a missing field, an unknown status, a bad date, a mismatched id and a missing ruling', () => {
    const f = 'docs/decisions/0001-a.md';
    assert.deepEqual(run({ [f]: record({ title: undefined }) }).codes, [`${f} decision-schema`]);
    assert.deepEqual(run({ [f]: record({ status: 'done' }) }).codes, [`${f} decision-schema`]);
    assert.deepEqual(run({ [f]: record({ decided: '22/10/2026' }) }).codes, [`${f} decision-schema`]);
    assert.deepEqual(run({ [f]: record({ id: 'D-0002' }), 'test/a.test.ts': '// holds D-0002\n' }).codes, [`${f} decision-schema`]);
    assert.deepEqual(run({ [f]: record({}, 'No ruling here.\n') }).codes, [`${f} decision-schema`]);
  });

  it('refuses an accepted one-way door an agent decided, and an inherited one with no review date', () => {
    const f = 'docs/decisions/0001-a.md';
    assert.deepEqual(run({ [f]: record({ door: 'one-way', decider: 'agent' }) }).codes, [`${f} decision-ratify`]);
    assert.deepEqual(run({ [f]: record({ door: 'one-way', decider: 'inherited' }) }).codes, [`${f} decision-ratify`]);
    assert.deepEqual(run({ [f]: record({ door: 'one-way', decider: 'inherited', 'review-by': '2026-11-30' }) }).codes, []);
    assert.deepEqual(run({ [f]: record({ door: 'one-way', decider: 'Kyle' }) }).codes, []);
    assert.deepEqual(run({ [f]: record({ door: 'one-way', decider: 'agent', status: 'proposed' }) }).codes, []);
  });

  it('holds supersede links both ways', () => {
    const a = 'docs/decisions/0001-a.md';
    const b = 'docs/decisions/0002-b.md';
    const good = { 'test/a.test.ts': '// holds D-0002\n', [a]: record({ status: 'superseded', 'superseded-by': 'D-0002' }), [b]: record({ id: 'D-0002', supersedes: 'D-0001' }) };
    assert.deepEqual(run(good).codes, []);
    assert.deepEqual(run({ ...good, [a]: record({ status: 'superseded' }) }).codes, [`${a} decision-supersede`, `${b} decision-supersede`]);
    assert.deepEqual(run({ ...good, [a]: record({ confirmation: 'review', 'review-by': '2027-01-01' }) }).codes, [`${b} decision-supersede`]);
    assert.deepEqual(run({ [b]: record({ id: 'D-0002', supersedes: 'D-0009' }), 'test/a.test.ts': '// holds D-0002\n' }).codes, [`${b} decision-supersede`]);
  });

  it('fails a citation of a missing or superseded record, naming the replacement, and passes one of a live record', () => {
    const recs = { 'test/a.test.ts': '// holds D-0002\n', 'docs/decisions/0001-a.md': record({ status: 'superseded', 'superseded-by': 'D-0002' }), 'docs/decisions/0002-b.md': record({ id: 'D-0002', supersedes: 'D-0001' }) };
    assert.deepEqual(run({ ...recs, 'AGENTS.md': 'Refusals carry codes (D-0002).\n' }).codes, []);
    assert.deepEqual(run({ ...recs, 'AGENTS.md': 'Refusals carry codes (D-0001).\n' }).codes, ['AGENTS.md decision-cite']);
    assert.deepEqual(run({ ...recs, 'packages/agent/src/x.ts': '// see D-0007\n' }).codes, ['packages/agent/src/x.ts decision-cite']);
    assert.deepEqual(run({ ...recs, 'docs/research/note.md': 'D-0001 was replaced\n' }).codes, []);
    const { violations } = findViolations(['AGENTS.md', ...Object.keys(recs)], (f) => ({ 'AGENTS.md': 'D-0001', ...recs })[f] ?? '', TODAY);
    assert.match(violations.find((v) => v.code === 'decision-cite').why, /superseded; cite D-0002/);
  });

  it('fails a confirmation that is missing or no longer names the record, and a review with no date', () => {
    const f = 'docs/decisions/0001-a.md';
    assert.deepEqual(run({ [f]: record({ confirmation: 'test/gone.test.ts' }) }).codes, [`${f} decision-confirmation`]);
    assert.deepEqual(run({ [f]: record({}), 'test/a.test.ts': '// renamed away\n' }).codes, [`${f} decision-confirmation`]);
    assert.deepEqual(run({ [f]: record({ confirmation: 'review' }) }).codes, [`${f} decision-confirmation`]);
    assert.deepEqual(run({ [f]: record({ confirmation: 'review', 'review-by': '2027-01-01' }) }).codes, []);
  });

  it('fails a passed review date and warns within the window', () => {
    const f = 'docs/decisions/0001-a.md';
    assert.deepEqual(run({ [f]: record({ 'review-by': '2026-10-21' }) }).codes, [`${f} decision-due`]);
    const soon = run({ [f]: record({ 'review-by': '2026-10-30' }) });
    assert.deepEqual(soon.codes, []);
    assert.equal(soon.warnings.length, 1);
    assert.equal(WARN_DAYS, 14);
    assert.deepEqual(run({ [f]: record({ 'review-by': '2026-12-31' }) }).warnings, []);
  });

  it('fails a stale index and an oversized log', () => {
    assert.deepEqual(run({ 'docs/decisions/0001-a.md': record({}) }, { stale: true }).codes, ['docs/decisions/README.md decision-index']);
    assert.deepEqual(run({ 'docs/decisions/log.md': 'x'.repeat(LOG_MAX_BYTES + 1), 'test/a.test.ts': '' }).codes, ['docs/decisions/log.md decision-log-size']);
  });

  it('as a script, writes the index with --write and then passes, and fails a planted citation', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'decisions-'));
    dirs.push(dir);
    const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')));
    execFileSync('git', ['init', '-q'], { cwd: dir, env });
    const write = (f, t) => {
      mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
      writeFileSync(path.join(dir, f), t);
    };
    write('test/a.test.ts', '// D-0001\n');
    write('docs/decisions/0001-a.md', record({}));
    write('docs/decisions/README.md', '# Decisions\n\n<!-- index:begin (node scripts/check-decisions.mjs --write) -->\n<!-- index:end -->\n');
    const go = (...args) => spawnSync(process.execPath, [script, ...args], { cwd: dir, env: { ...env, DECISIONS_TODAY: TODAY }, encoding: 'utf8' });
    assert.equal(go().status, 1);
    assert.equal(go('--write').status, 0);
    assert.match(readFileSync(path.join(dir, 'docs/decisions/README.md'), 'utf8'), /\| \[D-0001\]\(0001-a\.md\) \| A decision \| accepted/);
    write('AGENTS.md', 'see D-0042\n');
    const r = go();
    assert.equal(r.status, 1);
    assert.match(r.stderr, /AGENTS\.md: decision-cite: cites D-0042, which does not exist/);
  });
});
