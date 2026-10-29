#!/usr/bin/env node
// The plan check (docs/plan-v2/ORCHESTRATOR.md, "What the orchestrator may not decide"): the two ledger rules the
// orchestrator is most tempted to bend are held by a check, not a sentence. Codes:
//   - scorecard-evidence:  a row of docs/plan-v2/SCORECARD.md at level 2 or more that does not name a file under
//                          docs/plan-v2/evidence/ that exists, or names no PR (`#<n>`): a level is a reading until it
//                          cites what it rests on (design §3, Lock);
//   - part-contract:       a part `## F<n>` (or `### F<n>.<p>`) in docs/plan-v2/parts.md with n >= FIRST_CLUSTER_PART
//                          whose section names no `contracts/P<n>-<slug>.md`, or names one that does not exist: parts
//                          after Phase 0 are written from a cluster's contract (D-0012).
// A missing SCORECARD.md or parts.md is not a violation: Phase 0 (F18) creates the scorecard, and a checkout without
// a plan has nothing to hold.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { repoRoot } from './lib/repo-files.mjs';

export const SCORECARD = 'docs/plan-v2/SCORECARD.md';
export const PARTS = 'docs/plan-v2/parts.md';
export const EVIDENCE = 'docs/plan-v2/evidence/';
/** F18 to F20 are Phase 0, the framework itself; from F21 every part is a cluster's. */
export const FIRST_CLUSTER_PART = 21;

const read = (cwd, file) => (existsSync(path.join(cwd, file)) ? readFileSync(path.join(cwd, file), 'utf8') : null);

/** Violations in a scorecard's text: rows `| P<n> | <level> | ... |`. */
export function scorecardViolations(text, exists) {
  const out = [];
  text.split('\n').forEach((line, i) => {
    const cells = line.split('|').map((c) => c.trim());
    if (cells.length < 4 || !/^P\d+/.test(cells[1]) || !/^[0-3]$/.test(cells[2])) return;
    if (Number(cells[2]) < 2) return;
    const files = [...line.matchAll(/docs\/plan-v2\/evidence\/[^\s|`),]+/g)].map((m) => m[0]);
    const why = [];
    if (files.length === 0) why.push(`names no file under ${EVIDENCE}`);
    for (const f of files) if (!exists(f)) why.push(`names ${f}, which does not exist`);
    if (!/#\d+/.test(line)) why.push('names no PR (`#<n>`)');
    if (why.length) out.push({ file: SCORECARD, line: i + 1, code: 'scorecard-evidence', why: `${cells[1]} at level ${cells[2]} ${why.join('; ')}` });
  });
  return out;
}

/** Violations in parts.md's text: sections `## F<n>` / `### F<n>.<p>` from FIRST_CLUSTER_PART on. */
export function partsViolations(text, exists) {
  const out = [];
  const lines = text.split('\n');
  const heads = [];
  lines.forEach((l, i) => {
    const m = l.match(/^#{2,3} (F(\d+)(?:\.\d+)?)\b/);
    if (m) heads.push({ id: m[1], n: Number(m[2]), line: i });
  });
  heads.forEach((h, k) => {
    if (h.n < FIRST_CLUSTER_PART) return;
    const end = heads[k + 1]?.line ?? lines.length;
    const section = lines.slice(h.line, end).join('\n');
    const named = [...section.matchAll(/(?:docs\/plan-v2\/)?contracts\/P\d+-[a-z0-9-]+\.md/g)].map((m) => m[0].replace(/^docs\/plan-v2\//, ''));
    if (named.length === 0) out.push({ file: PARTS, line: h.line + 1, code: 'part-contract', why: `${h.id} names no contracts/P<n>-<slug>.md` });
    for (const c of new Set(named)) if (!exists(`docs/plan-v2/${c}`)) out.push({ file: PARTS, line: h.line + 1, code: 'part-contract', why: `${h.id} names ${c}, which does not exist` });
  });
  return out;
}

/** Every violation at `cwd`. */
export function check(cwd) {
  const exists = (f) => existsSync(path.join(cwd, f));
  const out = [];
  const scorecard = read(cwd, SCORECARD);
  if (scorecard !== null) out.push(...scorecardViolations(scorecard, exists));
  const parts = read(cwd, PARTS);
  if (parts !== null) out.push(...partsViolations(parts, exists));
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const violations = check(repoRoot());
  for (const v of violations) console.error(`${v.file}:${v.line}: ${v.code}: ${v.why}`);
  console.log(`check-plan: ${violations.length} violation(s)`);
  if (violations.length) process.exit(1);
}
