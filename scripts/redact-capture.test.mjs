// F18: the redaction gate. A planted secret deletes the capture and fails; a value outside the allowlist is
// stripped to its shape; an allowlisted field keeps its value; the gate is idempotent and handles text and binary.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { ALLOWLIST, redactText, redactValue } from './redact-capture.mjs';

const script = fileURLToPath(new URL('./redact-capture.mjs', import.meta.url));
const root = fileURLToPath(new URL('..', import.meta.url));
const planted = readFileSync(path.join(root, 'test/fixtures/fake-secrets/planted.txt'), 'utf8');
const fakeLine = (label) => planted.split('\n').find((l) => l.startsWith(`${label}: `))?.slice(label.length + 2) ?? '';

const dirs = [];
after(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
function capture(name, content) {
  const dir = mkdtempSync(path.join(tmpdir(), 'redact-'));
  dirs.push(dir);
  const file = path.join(dir, name);
  writeFileSync(file, content);
  return file;
}
const run = (...files) => {
  const res = spawnSync(process.execPath, [script, ...files], { encoding: 'utf8' });
  return { status: res.status, out: `${res.stdout}${res.stderr}` };
};

describe('redact-capture', () => {
  it('deletes a capture holding a planted secret and exits non-zero, naming the rule and never the value', () => {
    const token = fakeLine('github');
    const file = capture('request-log.json', JSON.stringify({ method: 'GET', path: '/app/chats', status: 200, body: { authorization: `Bearer ${token}` } }));
    const { status, out } = run(file);
    assert.equal(status, 1);
    assert.equal(existsSync(file), false);
    assert.match(out, /REDACT_SECRET_FOUND/);
    assert.match(out, /github-token/);
    assert.equal(out.includes(token), false);
  });

  it('deletes a text capture holding a planted secret too', () => {
    const file = capture('muse-answer.md', `Muse said the key was ${fakeLine('anthropic')} and moved on.\n`);
    const { status, out } = run(file);
    assert.equal(status, 1);
    assert.equal(existsSync(file), false);
    assert.match(out, /anthropic-key/);
  });

  it('strips a value outside the allowlist to its shape and keeps an allowlisted field, in place', () => {
    const file = capture('step-1.json', JSON.stringify({ id: 'chat_01', kind: 'approval', status: 403, code: 'CHAT_NOT_OWNER', method: 'POST', path: '/app/chats?setup=abc', body: { text: 'Pat asked for the quarterly numbers', count: 3, ok: true, nested: { chat_id: 'c9', title: 'Numbers' } } }));
    const { status, out } = run(file);
    assert.equal(status, 0, out);
    assert.match(out, /ok \(4 fields stripped\)/);
    assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), {
      id: 'chat_01',
      kind: 'approval',
      status: 403,
      code: 'CHAT_NOT_OWNER',
      method: 'POST',
      path: '/app/chats?[stripped]',
      body: { text: '[string:35]', count: '[number]', ok: true, nested: { chat_id: 'c9', title: '[string:7]' } },
    });
  });

  it('is idempotent: a redacted capture redacts to itself with nothing further stripped', () => {
    const file = capture('again.json', JSON.stringify({ id: 'x', title: 'hello world', tags: ['captured'], list: ['a sentence here'] }));
    assert.equal(run(file).status, 0);
    const once = readFileSync(file, 'utf8');
    const { out } = run(file);
    assert.match(out, /ok \(0 fields stripped\)/);
    assert.equal(readFileSync(file, 'utf8'), once);
    assert.deepEqual(JSON.parse(once), { id: 'x', title: '[string:11]', tags: ['captured'], list: ['[string:15]'] });
  });

  it('allowlists by field name only: an allowlisted key keeps its value anywhere, an array under it keeps its strings', () => {
    assert.deepEqual(redactValue({ cards: ['approval', 'file'], roles: ['button', 'link'], hrefs: ['/chats/1'], labels: ['Send'] }), { cards: ['approval', 'file'], roles: ['button', 'link'], hrefs: ['/chats/1'], labels: ['[string:4]'] });
    assert.ok(ALLOWLIST.has('status'));
    assert.ok(!ALLOWLIST.has('title'));
  });

  it('masks addresses in a text capture and reports the count; a binary file is passed through unread', () => {
    const md = capture('dom-note.md', `## Step 2\nrole=button label=Send href=/chats/1\nA line from pat@solo-sam.example about the plan.\n`);
    const { status, out } = run(md);
    assert.equal(status, 0, out);
    assert.match(out, /ok \(1 address masked\)/);
    assert.equal(readFileSync(md, 'utf8'), '## Step 2\nrole=button label=Send href=/chats/1\nA line from [email] about the plan.\n');
    assert.equal(redactText('sam@solo-sam.example and pat@solo-sam.example').text, '[email] and [email]');
    const png = capture('step-1.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2]));
    const bin = run(png);
    assert.equal(bin.status, 0);
    assert.match(bin.out, /binary, not scanned/);
    assert.equal(readFileSync(png).length, 7);
  });

  it('fails a missing file and a malformed JSON capture by code, and takes several files at once', () => {
    const bad = capture('broken.json', '{ not json');
    const good = capture('fine.json', JSON.stringify({ id: 'a' }));
    const { status, out } = run(good, bad, path.join(path.dirname(bad), 'absent.json'));
    assert.equal(status, 1);
    assert.match(out, /REDACT_BAD_JSON/);
    assert.match(out, /REDACT_NO_FILE/);
    assert.match(out, /fine\.json: ok/);
  });

  it('prints usage and exits 2 with no file', () => {
    const { status, out } = run();
    assert.equal(status, 2);
    assert.match(out, /usage: pnpm redact <file>/);
  });
});
