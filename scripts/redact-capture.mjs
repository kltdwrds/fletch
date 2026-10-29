#!/usr/bin/env node
// The redaction gate (parity framework design §4.4; F18): every capture passes it before it is stored under
// docs/plan-v2/evidence/ (docs/plan-v2/evidence/README.md). Per file, in place:
//   - the secret patterns (scripts/lib/secret-patterns.ts) over the whole text: a hit deletes the file and fails with
//     REDACT_SECRET_FOUND and the rule's name, never the value (a capture that fails is deleted, not fixed by hand);
//   - a JSON capture: every string or number under a field outside ALLOWLIST is replaced by its shape
//     (`[string:<length>]`, `[number]`); booleans and nulls stay; an allowlisted key keeps its value, an array
//     under it its strings; a `path` or `href` keeps its path and loses its query (`?[stripped]`);
//   - a text capture (a DOM note, Muse's answer): addresses become `[email]`;
//   - a binary file (a screenshot) is passed through unread and said so: it is reviewed by eye.
// Idempotent: a redacted capture redacts to itself. Exit 0 when every file passed, 1 when any failed, 2 on usage.
//
//   pnpm redact <file>...
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SECRET_PATTERNS } from './lib/secret-patterns.ts';

/** Field names whose values carry no content: ids, kinds, enums, status codes, failure words, request shape. */
export const ALLOWLIST = new Set([
  'id', 'ids', 'key', 'keys', 'kind', 'kinds', 'type', 'types', 'status', 'statuses', 'code', 'codes', 'reason', 'rule',
  'method', 'path', 'href', 'hrefs', 'role', 'roles', 'tag', 'tags', 'level', 'state', 'arm', 'actor', 'timing', 'finality',
  'surface', 'notification', 'input_class', 'text_class', 'cards', 'scope', 'default', 'asked', 'shape', 'enum',
  'scenario_id', 'cluster', 'run_at', 'dump_version', 'preview_slot', 'records', 'files', 'jobs', 'reactions', 'other',
  'version', 'hash', 'version_hash',
]);
const ID_KEY = /(?:_id|Id|_ids|Ids|_at|At)$/;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;

export const allowed = (key) => ALLOWLIST.has(key) || ID_KEY.test(key);

/** The first secret pattern the text matches, by rule name, or null. */
export function findSecret(text) {
  for (const line of text.split('\n')) for (const p of SECRET_PATTERNS) if (p.re.test(line)) return p.name;
  return null;
}

const shape = (v) => (typeof v === 'string' ? (/^\[string:\d+\]$/.test(v) || v === '[number]' ? v : `[string:${v.length}]`) : typeof v === 'number' ? '[number]' : v);
const stripQuery = (v) => (typeof v === 'string' && v.includes('?') && !v.endsWith('?[stripped]') ? `${v.slice(0, v.indexOf('?'))}?[stripped]` : v);

/** `value` with every field outside the allowlist stripped to its shape; `stripped` counts the fields changed. */
export function redactValue(value, counter = { stripped: 0 }, keep = false, key = '') {
  if (Array.isArray(value)) return value.map((v) => redactValue(v, counter, keep, key));
  if (value !== null && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = redactValue(v, counter, allowed(k), k);
    return out;
  }
  if (keep) {
    if ((key === 'path' || key === 'href' || key === 'hrefs') && stripQuery(value) !== value) {
      counter.stripped++;
      return stripQuery(value);
    }
    return value;
  }
  const s = shape(value);
  if (s !== value) counter.stripped++;
  return s;
}

/** Text with every address masked, and how many were. */
export function redactText(text) {
  let masked = 0;
  const out = text.replace(EMAIL, () => {
    masked++;
    return '[email]';
  });
  return { text: out, masked };
}

/** One file through the gate: `{ ok, line }` with the line to print; a failing file is deleted when it exists. */
export function redactFile(file) {
  if (!existsSync(file)) return { ok: false, line: `${file}: REDACT_NO_FILE` };
  const buf = readFileSync(file);
  if (buf.includes(0)) return { ok: true, line: `${file}: binary, not scanned (review it by eye)` };
  const text = buf.toString('utf8');
  const rule = findSecret(text);
  if (rule) {
    unlinkSync(file);
    return { ok: false, line: `${file}: REDACT_SECRET_FOUND ${rule}; the file is deleted` };
  }
  if (file.endsWith('.json')) {
    let doc;
    try {
      doc = JSON.parse(text);
    } catch {
      return { ok: false, line: `${file}: REDACT_BAD_JSON` };
    }
    const counter = { stripped: 0 };
    const out = redactValue(doc, counter);
    writeFileSync(file, `${JSON.stringify(out, null, 2)}\n`);
    return { ok: true, line: `${file}: ok (${counter.stripped} fields stripped)` };
  }
  const { text: out, masked } = redactText(text);
  if (masked) writeFileSync(file, out);
  return { ok: true, line: `${file}: ok (${masked} ${masked === 1 ? 'address' : 'addresses'} masked)` };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const files = process.argv.slice(2);
  if (files.length === 0) {
    console.error('usage: pnpm redact <file>...');
    process.exit(2);
  }
  let failed = 0;
  for (const file of files) {
    const { ok, line } = redactFile(file);
    (ok ? console.log : console.error)(`redact ${line}`);
    if (!ok) failed++;
  }
  console.log(`redact: ${files.length} files, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
