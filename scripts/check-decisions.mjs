#!/usr/bin/env node
// The decision-records check (docs/decisions/README.md; the evidence is docs/research/2026-10-22-decision-records.md):
// a binding decision is one file, docs/decisions/NNNN-slug.md, and this check fails when one goes stale. Rules, each with
// a code:
//   - decision-schema:   front matter with every field in FIELDS, a known status and door, dates as YYYY-MM-DD, an id
//                        that matches the file name, and a `Ruling:` line in the body;
//   - decision-ratify:   an accepted one-way door is decided by Kyle, or is `inherited` (taken before the records existed,
//                        ratified only by its merge) and carries a review-by date, so Kyle confirms it;
//   - decision-supersede: `supersedes` and `superseded-by` name records that exist and name each other back, and a record
//                        is `superseded` exactly when it has a `superseded-by`;
//   - decision-cite:     a `D-NNNN` cited in an instruction file or in source names a record that exists and is not
//                        rejected, superseded or deprecated; a superseded one names its replacement;
//   - decision-confirmation: an accepted record's `confirmation` is `review`, or files that exist and mention its id, so
//                        renaming or deleting the test that holds a decision fails here;
//   - decision-due:      a `review-by` date in the past; one within WARN_DAYS is printed, not failed;
//   - decision-index:    docs/decisions/README.md's table is not what `node scripts/check-decisions.mjs --write` makes;
//   - decision-log-size: docs/decisions/log.md over LOG_MAX_BYTES: promote what others rely on into records, prune the rest.
// Every violation fails the check; there is no allowlist.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { repoFiles, repoRoot } from './lib/repo-files.mjs';

export const DIR = 'docs/decisions';
export const FIELDS = ['id', 'title', 'status', 'door', 'decided', 'decider', 'confirmation'];
export const STATUSES = ['proposed', 'accepted', 'rejected', 'superseded', 'deprecated'];
export const DOORS = ['one-way', 'two-way'];
export const DECIDERS = ['Kyle', 'agent', 'inherited'];
export const WARN_DAYS = 14;
export const LOG_MAX_BYTES = 40 * 1024;
const RECORD = /^docs\/decisions\/(\d{4})-[a-z0-9-]+\.md$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const ID = /\bD-(\d{4})\b/g;
const BEGIN = '<!-- index:begin (node scripts/check-decisions.mjs --write) -->';
const END = '<!-- index:end -->';
/** This check's own test, whose fixtures plant ids that do not exist. */
const SELF_TEST = 'scripts/check-decisions.test.mjs';
/** Where a citation counts: instruction files, the plan and source. Records, the log and research may name any id. */
const CITES = (f) => f !== SELF_TEST && /(?:^|\/)AGENTS\.md$|^docs\/plan\/[^/]+\.md$|^docs\/runbooks\/[^/]+\.md$|^README\.md$|^VISION\.md$|\.(?:[cm]?[jt]sx?)$/.test(f);

/** A record's front matter as a map of field to string, and its body; null when it has none. */
export function parse(text) {
  const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text);
  if (!m) return null;
  const fields = {};
  for (const line of m[1].split('\n')) {
    const f = /^([a-z-]+):\s*(.*)$/.exec(line);
    if (f) fields[f[1]] = f[2].trim();
  }
  return { fields, body: m[2] };
}

const list = (v) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : []);
const days = (a, b) => Math.round((Date.parse(a) - Date.parse(b)) / 86_400_000);

/** The index table docs/decisions/README.md carries between its markers. */
export function indexTable(records) {
  const rows = records.map((r) => `| [${r.fields.id}](${path.posix.basename(r.file)}) | ${r.fields.title} | ${r.fields.status} | ${r.fields.door} | ${r.fields.decided} | ${r.fields['review-by'] || ''} |`);
  return ['| Id | Decision | Status | Door | Decided | Review by |', '|---|---|---|---|---|---|', ...rows].join('\n');
}

/**
 * Every violation, as `{file, code, why}`, and the warnings, over `files` (repository-relative paths) read with
 * `read(path)`. `today` is YYYY-MM-DD.
 */
export function findViolations(files, read, today) {
  const out = [];
  const warnings = [];
  const records = [];
  for (const file of files.filter((f) => RECORD.test(f)).sort()) {
    const parsed = parse(read(file));
    if (!parsed) {
      out.push({ file, code: 'decision-schema', why: 'no front matter' });
      continue;
    }
    records.push({ file, ...parsed });
  }
  const byId = new Map(records.map((r) => [r.fields.id, r]));
  for (const r of records) {
    const f = r.fields;
    const bad = (code, why) => out.push({ file: r.file, code, why });
    for (const k of FIELDS) if (!f[k]) bad('decision-schema', `no ${k}`);
    if (f.id && f.id !== `D-${RECORD.exec(r.file)?.[1]}`) bad('decision-schema', `id ${f.id} does not match the file name`);
    if (records.filter((o) => o.fields.id === f.id).length > 1) bad('decision-schema', `id ${f.id} is used twice`);
    if (f.status && !STATUSES.includes(f.status)) bad('decision-schema', `status ${f.status} is not one of ${STATUSES.join(', ')}`);
    if (f.door && !DOORS.includes(f.door)) bad('decision-schema', `door ${f.door} is not one of ${DOORS.join(', ')}`);
    if (f.decider && !DECIDERS.includes(f.decider)) bad('decision-schema', `decider ${f.decider} is not one of ${DECIDERS.join(', ')}`);
    for (const k of ['decided', 'review-by']) if (f[k] && !DATE.test(f[k])) bad('decision-schema', `${k} ${f[k]} is not YYYY-MM-DD`);
    if (!/^Ruling: .+/m.test(r.body)) bad('decision-schema', 'no "Ruling: X — because Y — if wrong, Z" line');
    if (f.status === 'accepted' && f.door === 'one-way') {
      if (f.decider === 'agent') bad('decision-ratify', 'an accepted one-way door is ratified by Kyle; an agent may only propose it');
      if (f.decider === 'inherited' && !f['review-by']) bad('decision-ratify', 'an inherited one-way door needs a review-by date for Kyle to confirm it');
    }
    for (const target of list(f.supersedes)) {
      const t = byId.get(target);
      if (!t) bad('decision-supersede', `supersedes ${target}, which does not exist`);
      else if (t.fields['superseded-by'] !== f.id) bad('decision-supersede', `supersedes ${target}, whose superseded-by is not ${f.id}`);
    }
    const by = f['superseded-by'];
    if (by) {
      const t = byId.get(by);
      if (!t) bad('decision-supersede', `superseded-by ${by}, which does not exist`);
      else if (!list(t.fields.supersedes).includes(f.id)) bad('decision-supersede', `superseded-by ${by}, which does not list ${f.id} in supersedes`);
    }
    if ((f.status === 'superseded') !== Boolean(by)) bad('decision-supersede', 'status superseded and a superseded-by go together');
    if (f.status === 'accepted' && f.confirmation && f.confirmation !== 'review') {
      for (const c of list(f.confirmation)) {
        if (!files.includes(c)) bad('decision-confirmation', `confirmation ${c} does not exist`);
        else if (!read(c).includes(f.id)) bad('decision-confirmation', `confirmation ${c} does not mention ${f.id}`);
      }
    }
    if (f.status === 'accepted' && f.confirmation === 'review' && !f['review-by']) bad('decision-confirmation', 'a decision held only by review needs a review-by date');
    if (f.status === 'accepted' && f['review-by'] && DATE.test(f['review-by'])) {
      const left = days(f['review-by'], today);
      if (left < 0) bad('decision-due', `review-by ${f['review-by']} has passed: renew it, or propose a record that supersedes it`);
      else if (left <= WARN_DAYS) warnings.push(`${r.file}: review by ${f['review-by']} (${left} days)`);
    }
  }
  for (const file of files.filter((f) => CITES(f) && !f.startsWith(`${DIR}/`))) {
    const text = read(file);
    for (const m of text.matchAll(ID)) {
      const t = byId.get(m[0]);
      if (!t) out.push({ file, code: 'decision-cite', why: `cites ${m[0]}, which does not exist` });
      else if (['rejected', 'superseded', 'deprecated'].includes(t.fields.status)) {
        const next = t.fields['superseded-by'] ? `; cite ${t.fields['superseded-by']}` : '';
        out.push({ file, code: 'decision-cite', why: `cites ${m[0]}, which is ${t.fields.status}${next}` });
      }
    }
  }
  const readme = `${DIR}/README.md`;
  if (records.length || files.includes(readme)) {
    const text = files.includes(readme) ? read(readme) : '';
    const inside = text.includes(BEGIN) && text.includes(END) ? text.slice(text.indexOf(BEGIN) + BEGIN.length, text.indexOf(END)).trim() : null;
    if (inside !== indexTable(records)) out.push({ file: readme, code: 'decision-index', why: 'the index is stale: run node scripts/check-decisions.mjs --write' });
  }
  const log = `${DIR}/log.md`;
  if (files.includes(log) && Buffer.byteLength(read(log)) > LOG_MAX_BYTES) out.push({ file: log, code: 'decision-log-size', why: `over ${LOG_MAX_BYTES} bytes: promote what others rely on into records and prune the rest` });
  return { violations: out, warnings, records };
}

/** docs/decisions/README.md with its index rewritten from `records`. */
export function withIndex(text, records) {
  return `${text.slice(0, text.indexOf(BEGIN) + BEGIN.length)}\n${indexTable(records)}\n${text.slice(text.indexOf(END))}`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = repoRoot();
  const read = (f) => readFileSync(path.join(root, f), 'utf8');
  const today = process.env.DECISIONS_TODAY || new Date().toISOString().slice(0, 10);
  let { violations, warnings, records } = findViolations(repoFiles(root), read, today);
  if (process.argv.includes('--write')) {
    writeFileSync(path.join(root, DIR, 'README.md'), withIndex(read(`${DIR}/README.md`), records));
    ({ violations, warnings } = findViolations(repoFiles(root), read, today));
  }
  for (const w of warnings) console.log(`warning: ${w}`);
  for (const v of violations) console.error(`${v.file}: ${v.code}: ${v.why}`);
  console.log(`check-decisions: ${records.length} record(s), ${violations.length} violation(s)`);
  if (violations.length > 0) process.exit(1);
}
