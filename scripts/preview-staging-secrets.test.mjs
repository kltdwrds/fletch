import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';
import { ADMIN_REF, ITEM, ITEM_REF, REPO, SECRET_NAMES, stagingSecrets, TOKEN_NAME, VAULT } from './preview-staging-secrets.mjs';

// `pnpm preview staging secrets` against fakes of `op`, `gh`, Cloudflare's token API and the staging slot's public
// lease. Every value is planted and obvious; each test greps what the fakes recorded (argv, logs, every header but the
// one Authorization each value belongs in) for them, so a value printed or passed as an argument fails it.
const ACCT = 'a'.repeat(32);
const SUB = 'example-sub';
const SCOPE = 'com.cloudflare.edge.worker.script';
const ADMIN = 'FAKE-ADMIN-TOKEN-VALUE';
const NEW = (n) => `FAKE-STAGING-TOKEN-VALUE-${n}`;
const TAG = (name) => createHash('md5').update(name).digest('hex');
const INV = { accountId: ACCT, slots: [1, 2].map((n) => ({ n, name: `fletch-pv-${n}`, ...(n === 1 ? { staging: true } : {}), resources: [{ kind: 'worker', name: `fletch-pv-${n}`, tag: TAG(`fletch-pv-${n}`) }] })) };
const GROUPS = [
  { id: 'g-editor', name: 'workers editor, individual', scopes: ['com.cloudflare.api.account', SCOPE] },
  { id: 'g-admin', name: 'workers admin', scopes: ['com.cloudflare.api.account'] },
];

/** The fakes, and every call each one saw. `fail` names an exec (by its first two words) that exits 1. */
function fakes({ fail = [], staging = true, existing = false, widen = false, itemExists = false } = {}) {
  const s = { exec: [], fetch: [], logs: [], tokens: new Map(), n: 0, gh: {}, item: null };
  const leaves = (r) => Object.entries(r).flatMap(([k, v]) => (typeof v === 'string' ? [k] : leaves(v)));
  const reach = (t, w) => t.policies.some((p) => leaves(p.resources).includes(`${SCOPE}.${TAG(w)}`) || leaves(p.resources).includes(`${SCOPE}.*`));
  const mint = (body) => ({ id: `t${++s.n}`, name: body.name, value: NEW(s.n), policies: body.policies.map((p) => (widen ? { ...p, resources: { [`com.cloudflare.api.account.${ACCT}`]: { [`${SCOPE}.*`]: '*' } } } : p)) });
  if (existing) {
    const t = mint({ name: TOKEN_NAME, policies: [{ effect: 'allow', resources: {}, permission_groups: [{ id: 'g-admin' }] }] });
    s.tokens.set(t.id, t);
  }
  if (itemExists) s.item = { id: 'item-1', title: ITEM, fields: [{ id: 'notesPlain', label: 'notes', value: 'keep me' }, { id: 'credential', label: 'credential', value: 'OLD-FAKE' }] };
  const res = (status, body) => ({ status, json: async () => body, text: async () => JSON.stringify(body) });
  const cf = (status, result) => res(status, { success: status < 300, result, errors: status < 300 ? [] : [{ code: 1, message: 'no' }] });
  s.io = {
    sleep: async () => {},
    exec: (file, args, { input } = {}) => {
      s.exec.push({ argv: [file, ...args], input });
      const key = `${file} ${args.slice(0, 2).join(' ')}`;
      if (fail.some((f) => key.startsWith(f))) return { status: 1, stdout: '', stderr: 'planted failure' };
      if (key === 'op read --no-newline') return { status: 0, stdout: ADMIN, stderr: '' };
      if (key.startsWith('op item get')) return s.item ? { status: 0, stdout: JSON.stringify(s.item), stderr: '' } : { status: 1, stdout: '', stderr: 'not found' };
      if (key.startsWith('op item create') || key.startsWith('op item edit')) s.item = { id: 'item-1', ...JSON.parse(input) };
      if (key.startsWith('gh secret set')) s.gh[args[2]] = input;
      if (key.startsWith('gh run list')) return { status: 0, stdout: JSON.stringify([{ databaseId: 42, url: `https://github.com/${REPO}/actions/runs/42` }]), stderr: '' };
      return { status: 0, stdout: '', stderr: '' };
    },
    fetch: async (url, { method = 'GET', headers = {}, body } = {}) => {
      s.fetch.push({ url, method, headers, body });
      if (url === `https://fletch-pv-1.${SUB}.workers.dev/__preview/lease`) return res(200, { staging, serving: 'main' });
      const path = url.replace('https://api.cloudflare.com/client/v4/', '').split('?')[0];
      const bearer = headers.authorization?.replace('Bearer ', '');
      const base = `accounts/${ACCT}/tokens`;
      if (path.startsWith(base)) {
        if (bearer !== ADMIN) return cf(403, null);
        const rest = path.slice(base.length + 1);
        if (rest === 'permission_groups') return cf(200, GROUPS);
        if (rest === '' && method === 'GET') return cf(200, [...s.tokens.values()].map(({ value, ...t }) => t));
        if (rest === '' && method === 'POST') {
          const t = mint(JSON.parse(body));
          s.tokens.set(t.id, t);
          return cf(200, { id: t.id, name: t.name, value: t.value });
        }
        const [id, tail] = rest.split('/');
        const t = s.tokens.get(id);
        if (!t) return cf(404, null);
        if (tail === 'value' && method === 'PUT') {
          t.value = NEW(`rolled-${id}`);
          return cf(200, t.value);
        }
        if (method === 'GET') return cf(200, { ...t, value: undefined });
        if (method === 'PUT') {
          t.policies = mint(JSON.parse(body)).policies;
          s.n--;
          return cf(200, { id });
        }
        if (method === 'DELETE') {
          s.tokens.delete(id);
          return cf(200, { id });
        }
      }
      const token = [...s.tokens.values()].find((t) => t.value === bearer);
      const m = path.match(/workers\/scripts\/([^/]+)\/settings$/);
      if (m) return cf(token && reach(token, m[1]) ? 200 : 403, {});
      return cf(403, null);
    },
  };
  s.run = () => stagingSecrets({ inv: INV, subdomain: SUB, io: s.io, log: (l) => s.logs.push(l) });
  return s;
}

/** No planted value in any argv, any log, or any header but the Authorization a Cloudflare call needs. */
function noLeak(s) {
  const values = [ADMIN, ...[...s.tokens.values()].map((t) => t.value), NEW(1), NEW('rolled-t1'), SUB];
  const said = [...s.exec.map((e) => e.argv.join(' ')), ...s.logs].join('\n');
  for (const v of values) assert.ok(!said.includes(v), `a value was printed or passed as an argument: ${v}`);
  for (const f of s.fetch) {
    assert.ok(!values.some((v) => f.url.includes(v) && v !== SUB) && !String(f.body ?? '').includes(ADMIN), 'a value in a URL or body');
    if (f.headers.authorization === `Bearer ${ADMIN}`) assert.ok(f.url.startsWith(`https://api.cloudflare.com/client/v4/accounts/${ACCT}/tokens`), 'the admin token left the tokens API');
  }
}

const refused = (code) => (e) => e.code === code;

describe('staging: pnpm preview staging secrets', () => {
  it('mints the token on the staging Worker alone, stores it, sets the three secrets on stdin and dispatches the workflow', async () => {
    const s = fakes();
    const out = await s.run();
    assert.deepEqual(out.token, { id: 't1', name: TOKEN_NAME, created: true });
    const t = s.tokens.get('t1');
    assert.deepEqual(t.policies, [{ effect: 'allow', resources: { [`com.cloudflare.api.account.${ACCT}`]: { [`${SCOPE}.${TAG('fletch-pv-1')}`]: '*' } }, permission_groups: [{ id: 'g-editor' }] }]);
    assert.equal(s.item.title, ITEM);
    assert.equal(s.item.fields.find((f) => f.id === 'credential').value, NEW(1));
    assert.ok(s.exec.some((e) => e.argv.join(' ') === `op item create --vault ${VAULT} --format json`));
    assert.deepEqual(s.gh, { CLOUDFLARE_API_TOKEN: NEW(1), CLOUDFLARE_ACCOUNT_ID: ACCT, FLETCH_PREVIEW_SUBDOMAIN: SUB });
    assert.ok(s.exec.some((e) => e.argv.join(' ') === `gh workflow run deploy-staging.yml --ref main --repo ${REPO}`));
    assert.deepEqual(out.secrets, SECRET_NAMES);
    assert.equal(out.stored, ITEM_REF);
    assert.equal(out.run.databaseId, 42);
    assert.match(s.logs.join('\n'), /created fletch-staging-deploy \(t1\).*fletch-pv-1 alone/);
    assert.match(s.logs.join('\n'), /run 42/);
    assert.ok(s.exec.some((e) => e.argv.includes(ADMIN_REF)));
    noLeak(s);
  });

  it('rolls an existing token, narrows its policy, and edits the 1Password item keeping its other fields', async () => {
    const s = fakes({ existing: true, itemExists: true });
    const out = await s.run();
    assert.deepEqual(out.token, { id: 't1', name: TOKEN_NAME, created: false });
    assert.equal(s.tokens.get('t1').value, NEW('rolled-t1'));
    assert.deepEqual(s.tokens.get('t1').policies[0].permission_groups, [{ id: 'g-editor' }]);
    assert.ok(s.exec.some((e) => e.argv.slice(0, 4).join(' ') === 'op item edit item-1'));
    assert.deepEqual(s.item.fields.map((f) => [f.id, f.value]), [['notesPlain', 'keep me'], ['credential', NEW('rolled-t1')]]);
    assert.equal(s.gh.CLOUDFLARE_API_TOKEN, NEW('rolled-t1'));
    assert.match(s.logs.join('\n'), /rolled fletch-staging-deploy/);
    noLeak(s);
  });

  it('refuses by code, before minting anything, when op or gh is not logged in or the slot is not converted', async () => {
    for (const [opts, code] of [
      [{ fail: ['op whoami'] }, 'PREVIEW_SECRETS_OP_LOGIN'],
      [{ fail: ['gh auth status'] }, 'PREVIEW_SECRETS_GH_LOGIN'],
      [{ staging: false }, 'PREVIEW_STAGING_NOT_CONVERTED'],
      [{ fail: ['op read'] }, 'PREVIEW_SECRETS_OP_READ'],
    ]) {
      const s = fakes(opts);
      await assert.rejects(s.run(), refused(code), code);
      assert.equal(s.tokens.size, 0, code);
      assert.deepEqual(s.gh, {}, code);
      noLeak(s);
    }
  });

  it('refuses a policy stored wider than asked, deletes the token it made, and sets no secret', async () => {
    const s = fakes({ widen: true });
    await assert.rejects(s.run(), refused('PREVIEW_SECRETS_POLICY_WIDE'));
    assert.equal(s.tokens.size, 0);
    assert.equal(s.item, null);
    assert.deepEqual(s.gh, {});
    assert.ok(!s.exec.some((e) => e.argv[1] === 'workflow'));
    noLeak(s);
  });

  it('stops by code when 1Password or gh refuses a write, and never dispatches after a failed secret', async () => {
    for (const [fail, code] of [
      [['op item create'], 'PREVIEW_SECRETS_OP_WRITE'],
      [['gh secret set'], 'PREVIEW_SECRETS_GH_WRITE'],
      [['gh workflow run'], 'PREVIEW_SECRETS_GH_DISPATCH'],
    ]) {
      const s = fakes({ fail });
      await assert.rejects(s.run(), refused(code), code);
      if (code !== 'PREVIEW_SECRETS_GH_DISPATCH') assert.ok(!s.exec.some((e) => e.argv[1] === 'workflow'), code);
      noLeak(s);
    }
  });
});
