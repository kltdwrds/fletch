import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';
import { editorGroup, ensureToken, parseEnv, setEnv, shapeFromTemplate, slotWorkers, TOKEN_NAME, VALUE_ENV } from './preview-token.mjs';

// `pnpm preview token` against a fake Cloudflare: account tokens, permission groups, Worker settings that answer by what
// the calling token's policy names, and account resource lists only the admin reaches. The fake's notion of a real
// per-Worker key (`realKey`) is what the live check finds.
const ACCT = 'a'.repeat(32);
const SCOPE = 'com.cloudflare.edge.worker.script';
const ADMIN = 'admin-secret-value';
/** A Worker's tag, as Cloudflare lists it: 32 hex. */
const TAG = (name) => createHash('md5').update(name).digest('hex');
const worker = (name) => ({ kind: 'worker', name, tag: TAG(name) });
const INV = { accountId: ACCT, slots: [1, 2].map((n) => ({ n, resources: [{ kind: 'r2', name: `fletch-pv-${n}-agent` }, { kind: 'vectorize', name: `fletch-pv-${n}-memory` }, worker(`fletch-pv-${n}`)] })) };
const WORKERS = slotWorkers(INV);
const GROUPS = [
  { id: 'g-editor', name: 'workers editor, individual', scopes: ['com.cloudflare.api.account', SCOPE] },
  { id: 'g-admin', name: 'workers admin', scopes: ['com.cloudflare.api.account'] },
  { id: 'g-tokens', name: 'account api tokens write', scopes: ['com.cloudflare.api.account'] },
];

function fakeCloudflare({ realKey = (n) => `${SCOPE}.${TAG(n)}`, refuse = () => false, storeAs = (r) => r } = {}) {
  const s = { tokens: new Map(), calls: [], n: 0 };
  const leaves = (r) => Object.entries(r).flatMap(([k, v]) => (typeof v === 'string' ? [k] : leaves(v)));
  const reach = (token, worker) => token.policies.some((p) => leaves(p.resources).includes(realKey(worker)));
  const json = (status, result, errors = []) => ({ status, json: async () => ({ success: status < 300, result, errors }) });
  s.fetch = async (url, { method = 'GET', headers = {}, body } = {}) => {
    const path = url.replace('https://api.cloudflare.com/client/v4/', '').split('?')[0];
    s.calls.push(`${method} ${path}`);
    const bearer = headers.authorization?.replace('Bearer ', '');
    const base = `accounts/${ACCT}/tokens`;
    if (path.startsWith(base)) {
      if (bearer !== ADMIN) return json(403, null, [{ code: 9109, message: 'Unauthorized' }]);
      const rest = path.slice(base.length + 1);
      if (rest === 'permission_groups') return json(200, GROUPS);
      if (rest === '' && method === 'GET') return json(200, [...s.tokens.values()].map(({ value, ...t }) => t));
      if (rest === '' && method === 'POST') {
        const b = JSON.parse(body);
        if (refuse(b.policies[0].resources)) return json(400, null, [{ code: 1001, message: 'not a supported resource type' }]);
        const t = { id: `t${++s.n}`, name: b.name, status: 'active', value: `new-secret-${s.n}`, policies: b.policies.map((p) => ({ ...p, resources: storeAs(p.resources) })) };
        s.tokens.set(t.id, t);
        return json(200, { id: t.id, name: t.name, value: t.value });
      }
      const t = s.tokens.get(rest);
      if (!t) return json(404, null, [{ code: 1003, message: 'not found' }]);
      if (method === 'GET') return json(200, { ...t, value: undefined });
      if (method === 'DELETE') {
        s.tokens.delete(rest);
        return json(200, { id: rest });
      }
      if (method === 'PUT') {
        const b = JSON.parse(body);
        if (refuse(b.policies[0].resources)) return json(400, null, [{ code: 1001, message: 'not a supported resource type' }]);
        t.policies = b.policies.map((p) => ({ ...p, resources: storeAs(p.resources) }));
        return json(200, { id: t.id });
      }
    }
    const token = [...s.tokens.values()].find((t) => t.value === bearer);
    const m = path.match(/^accounts\/[0-9a-f]+\/workers\/scripts\/([^/]+)\/settings$/);
    if (m) return json(token && reach(token, m[1]) ? 200 : 403, {});
    if (/\/(r2\/buckets|vectorize\/v2\/indexes|d1\/database)$/.test(path)) return json(bearer === ADMIN || s.leaky ? 200 : 403, []);
    return json(404, null);
  };
  return s;
}

/** An .env in memory, and every line logged. */
function harness(cf, envText = `OTHER=1\nCF_TOKENS_ADMIN=${ADMIN}\n`) {
  const h = { env: envText, logs: [] };
  h.run = (opts = {}) =>
    ensureToken({
      inv: INV,
      envFile: '/qyvr/.env',
      fetchFn: cf.fetch,
      log: (l) => h.logs.push(l),
      sleep: async () => {},
      read: () => h.env,
      write: (_f, text) => {
        h.env = text;
      },
      ...opts,
    });
  return h;
}

const noSecretIn = (h, cf) => {
  const all = h.logs.join('\n');
  assert.ok(!all.includes(ADMIN), 'the admin token is never logged');
  for (const t of cf.tokens.values()) assert.ok(!all.includes(t.value), 'the new token is never logged');
};

describe('preview token', () => {
  it('creates a token naming exactly the slot Workers with Editor, checks it live, and writes its value to .env', async () => {
    const cf = fakeCloudflare();
    const h = harness(cf);
    const r = await h.run();
    assert.equal(r.created, true);
    const [t] = cf.tokens.values();
    assert.equal(t.name, TOKEN_NAME);
    assert.deepEqual(t.policies, [{ effect: 'allow', resources: { [`com.cloudflare.api.account.${ACCT}`]: Object.fromEntries(WORKERS.map((w) => [`${SCOPE}.${w.tag}`, '*'])) }, permission_groups: [{ id: 'g-editor' }] }]);
    assert.equal(parseEnv(h.env).FLETCH_PREVIEW_CLOUDFLARE_API_TOKEN, t.value);
    assert.equal(parseEnv(h.env).OTHER, '1');
    assert.deepEqual(r.check.denied, { 'qyvr-dev': 403, 'qyvr-identity': 403, r2: 403, vectorize: 403, d1: 403 });
    noSecretIn(h, cf);
  });

  it("never touches qyvr's own preview token", async () => {
    const cf = fakeCloudflare();
    const qyvr = { id: 'q', name: 'qyvr-preview-slots', value: 'qyvr-secret', policies: [{ effect: 'allow', resources: { x: '*' }, permission_groups: [{ id: 'g-editor' }] }] };
    cf.tokens.set('q', structuredClone(qyvr));
    const h = harness(cf, `CF_TOKENS_ADMIN=${ADMIN}\nPREVIEW_CLOUDFLARE_API_TOKEN=qyvr-secret\n`);
    await h.run();
    assert.deepEqual(cf.tokens.get('q'), qyvr);
    assert.ok(!cf.calls.some((c) => c.endsWith('/tokens/q') && !c.startsWith('GET')), cf.calls.join('\n'));
    assert.equal(parseEnv(h.env).PREVIEW_CLOUDFLARE_API_TOKEN, 'qyvr-secret');
  });

  it('a rerun updates the same token in place and leaves .env alone', async () => {
    const cf = fakeCloudflare();
    const h = harness(cf);
    await h.run();
    const before = h.env;
    const r = await h.run();
    assert.equal(r.created, false);
    assert.equal(cf.tokens.size, 1);
    assert.equal(h.env, before);
    assert.ok(cf.calls.includes(`PUT accounts/${ACCT}/tokens/t1`));
  });

  it('tries the next shape when the API refuses one, keeping nothing refused', async () => {
    const cf = fakeCloudflare({ refuse: (r) => Object.keys(r).some((k) => k.startsWith('com.cloudflare.api.account.')) });
    const r = await harness(cf).run();
    assert.equal(r.shape, `${SCOPE}.<tag>`);
    assert.equal(cf.tokens.size, 1);
  });

  it('deletes a token it created that cannot reach the slot Workers, then tries the next shape', async () => {
    const cf = fakeCloudflare({ realKey: (n) => `${SCOPE}.${ACCT}_${TAG(n)}` });
    const h = harness(cf);
    const r = await h.run();
    assert.equal(r.shape, `${SCOPE}.<account>_<tag>`);
    assert.deepEqual([...cf.tokens.keys()], ['t3']);
    assert.ok(cf.calls.includes(`DELETE accounts/${ACCT}/tokens/t1`) && cf.calls.includes(`DELETE accounts/${ACCT}/tokens/t2`));
    assert.equal(parseEnv(h.env)[VALUE_ENV], cf.tokens.get('t3').value);
  });

  it('refuses a token that reaches production, deleting it and keeping no value', async () => {
    const cf = fakeCloudflare({ realKey: (n) => `${SCOPE}.${TAG(n.startsWith('fletch-pv-') ? n : 'fletch-pv-1')}` });
    const h = harness(cf);
    await assert.rejects(h.run(), /nothing kept[\s\S]*reaches production Worker qyvr-dev/);
    assert.equal(cf.tokens.size, 0);
    assert.equal(parseEnv(h.env)[VALUE_ENV], undefined);
    noSecretIn(h, cf);
  });

  it("refuses a token that lists the account's buckets, indexes or databases", async () => {
    const cf = fakeCloudflare();
    cf.leaky = true;
    await assert.rejects(harness(cf).run(), /reaches the account's r2; reaches the account's vectorize; reaches the account's d1/);
    assert.equal(cf.tokens.size, 0);
  });

  it('refuses a token whose stored policy is not the one sent', async () => {
    const cf = fakeCloudflare({ storeAs: (r) => ({ ...r, [`com.cloudflare.api.account.${ACCT}`]: '*' }) });
    await assert.rejects(harness(cf).run(), /stored policy is not the one sent/);
    assert.equal(cf.tokens.size, 0);
  });

  it('names the missing admin token and calls nothing', async () => {
    const cf = fakeCloudflare();
    await assert.rejects(harness(cf, 'OTHER=1\n').run(), /no CF_TOKENS_ADMIN in \/qyvr\/\.env.*Account API Tokens > Edit/);
    assert.deepEqual(cf.calls, []);
  });

  it('refuses to update a token whose value .env lacks', async () => {
    const cf = fakeCloudflare();
    const h = harness(cf);
    await h.run();
    h.env = h.env.replace(new RegExp(`^${VALUE_ENV}=.*\\n`, 'm'), '');
    await assert.rejects(h.run(), /exists but \/qyvr\/\.env has no FLETCH_PREVIEW_CLOUDFLARE_API_TOKEN/);
  });

  it('copies the key shape from a template token made for one slot Worker', async () => {
    const cf = fakeCloudflare({ realKey: (n) => `com.cloudflare.edge.worker.x.${ACCT}/${TAG(n)}` });
    cf.tokens.set('tpl', { id: 'tpl', name: 'dash', value: 'tpl-secret', policies: [{ effect: 'allow', resources: { [`com.cloudflare.api.account.${ACCT}`]: { [`com.cloudflare.edge.worker.x.${ACCT}/${TAG('fletch-pv-1')}`]: '*' } }, permission_groups: [{ id: 'g-editor' }] }] });
    const r = await harness(cf).run({ templateId: 'tpl' });
    assert.match(r.shape, /^template tpl/);
    assert.deepEqual(cf.tokens.get('t1').policies[0].resources, { [`com.cloudflare.api.account.${ACCT}`]: Object.fromEntries(WORKERS.map((w) => [`com.cloudflare.edge.worker.x.${ACCT}/${w.tag}`, '*'])) });
  });
});

describe('preview token helpers', () => {
  it('editorGroup picks the one Editor group with a per-Worker scope, and lists candidates otherwise', () => {
    assert.deepEqual(editorGroup(GROUPS), { id: 'g-editor', name: 'workers editor, individual', scope: SCOPE });
    assert.throws(() => editorGroup(GROUPS.slice(1)), /no permission group[\s\S]*g-admin {2}workers admin/);
    assert.throws(() => editorGroup([...GROUPS, { id: 'g2', name: 'Worker Editor 2', scopes: [SCOPE] }]), /more than one/);
    assert.equal(editorGroup([...GROUPS, { id: 'g2', name: 'Worker Editor 2', scopes: [SCOPE] }], 'g2').id, 'g2');
  });

  it('slotWorkers refuses an inventory with no Worker, or a Worker that has no tag', () => {
    assert.throws(() => slotWorkers({ slots: [{ resources: [{ kind: 'worker', name: 'fletch-pv-1' }] }] }), /no tag for fletch-pv-1/);
    assert.throws(() => slotWorkers({ slots: [] }), /no slot Worker/);
  });

  it('shapeFromTemplate refuses a template that names no slot Worker', () => {
    assert.throws(() => shapeFromTemplate({ id: 'x', policies: [{ resources: { [`com.cloudflare.api.account.${ACCT}`]: '*' } }] }, WORKERS), /names none of/);
  });

  it('setEnv replaces a line or appends one, keeping a value with $ as typed, and parseEnv reads quoted values', () => {
    assert.equal(setEnv('A=1\nB=2\n', 'B', '3'), 'A=1\nB=3\n');
    assert.equal(setEnv('A=1', 'B', '3'), 'A=1\nB=3\n');
    assert.equal(setEnv('B=2\n', 'B', 'x$&y'), 'B=x$&y\n');
    assert.deepEqual(parseEnv('A="x y"\nB=\'z\'\n# c\n'), { A: 'x y', B: 'z' });
  });
});
