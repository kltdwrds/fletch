import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  assertDeletable,
  authMode,
  baseNames,
  deletionOrder,
  freeSlot,
  gcReason,
  isPreviewName,
  jsonOut,
  LEASE_OBJECT,
  r2Names,
  record,
  SLOT_OWNER,
  slotConfig,
  slotPlan,
  subdomainIn,
  workerTag,
  wranglerEnv,
} from './preview-plan.mjs';

// The pure half of `pnpm preview` (scripts/preview-plan.mjs): names, the slot config derived from the agent's real base
// config, the inventory's deletion guard, the lease rules and the credential choice.
const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const { experimental_readRawConfig } = createRequire(path.join(REPO, 'package.json'))('wrangler');
const BASE = experimental_readRawConfig({ config: path.join(REPO, 'packages', 'agent', 'wrangler.jsonc') }).rawConfig;
const ACCT = 'a'.repeat(32);
const AGENT_CLASSES = Object.keys(BASE.exports);

describe('preview plan: names', () => {
  it('names every resource of a slot under the prefix, and its host only with the subdomain', () => {
    const p = slotPlan(3, 'example-sub');
    assert.equal(p.worker, 'fletch-pv-3');
    assert.deepEqual(p.r2, { AGENT_BUCKET: 'fletch-pv-3-agent' });
    assert.deepEqual(p.vectorize, { MEMORY_INDEX: 'fletch-pv-3-memory' });
    assert.equal(p.host, 'fletch-pv-3.example-sub.workers.dev');
    assert.equal(slotPlan(3).host, null);
    assert.throws(() => slotPlan(0), /not 1 to/);
    assert.throws(() => slotPlan(1, 'a.b'), /not a workers.dev subdomain/);
  });

  it('isPreviewName takes only fletch-pv- names', () => {
    for (const ok of ['fletch-pv-1', 'fletch-pv-12-agent']) assert.ok(isPreviewName(ok), ok);
    for (const bad of ['fletch-pv', 'fletch-pv-', 'qyvr-pv-1', 'agent', 'fletch-pv-1--x', 'Fletch-pv-1', 'x-fletch-pv-1', null]) assert.ok(!isPreviewName(bad), String(bad));
  });

  it('subdomainIn reads the workers.dev subdomain wrangler printed for one Worker only', () => {
    const out = 'Deployed fletch-pv-2 triggers\n  https://fletch-pv-2.some-sub.workers.dev\n';
    assert.equal(subdomainIn(out, 'fletch-pv-2'), 'some-sub');
    assert.equal(subdomainIn(out, 'fletch-pv-1'), null);
    assert.equal(subdomainIn('https://fletch-pv-22.x.workers.dev', 'fletch-pv-2'), null);
  });
});

describe('preview plan: the slot config', () => {
  const plan = slotPlan(1);
  const app = slotConfig(BASE, plan, { accountId: ACCT, deploy: 'd1' });
  const ph = slotConfig(BASE, plan, { accountId: ACCT, placeholder: true, deploy: 'd2' });

  it("runs the agent on the slot's own bucket, index and tenant, with the fixture owner, on workers.dev", () => {
    assert.equal(app.name, 'fletch-pv-1');
    assert.equal(app.account_id, ACCT);
    assert.equal(app.main, '../../scripts/preview-slot/app.mjs');
    assert.equal(app.workers_dev, true);
    assert.deepEqual(app.r2_buckets, [{ binding: 'AGENT_BUCKET', bucket_name: 'fletch-pv-1-agent' }]);
    assert.deepEqual(app.vectorize, [{ binding: 'MEMORY_INDEX', index_name: 'fletch-pv-1-memory' }]);
    assert.equal(app.vars.TENANT_ID, 'fletch-pv-1');
    assert.equal(app.vars.OWNER_EMAIL, SLOT_OWNER);
    assert.deepEqual([app.vars.PREVIEW_SERVING, app.vars.PREVIEW_DEPLOY], ['app', 'd1']);
    assert.deepEqual(app.ai, BASE.ai);
    assert.equal(app.routes, undefined);
    const text = JSON.stringify(app);
    for (const n of baseNames(BASE)) if (n !== 'agent') assert.ok(!text.includes(n), `the slot config names the base's ${n}`);
  });

  it("keeps every agent Durable Object live, with the lease's beside them", () => {
    assert.deepEqual(app.durable_objects.bindings, [...BASE.durable_objects.bindings, { name: LEASE_OBJECT.binding, class_name: LEASE_OBJECT.className }]);
    for (const c of AGENT_CLASSES) assert.deepEqual(app.exports[c], BASE.exports[c]);
    assert.deepEqual(app.exports.PreviewLease, { type: 'durable-object', storage: 'sqlite' });
  });

  it("the placeholder tombstones every agent class (deleting its objects), binds none of them, and keeps the lease's", () => {
    assert.equal(ph.main, '../../scripts/preview-slot/placeholder.mjs');
    for (const c of AGENT_CLASSES) assert.deepEqual(ph.exports[c], { type: 'durable-object', state: 'deleted' }, c);
    assert.deepEqual(ph.durable_objects.bindings, [{ name: 'PREVIEW_LEASE', class_name: 'PreviewLease' }]);
    assert.deepEqual(ph.exports.PreviewLease, { type: 'durable-object', storage: 'sqlite' });
    assert.equal(ph.ai, undefined);
    assert.deepEqual(ph.r2_buckets, app.r2_buckets, 'the ops empty the bucket through it');
    assert.deepEqual(ph.vectorize, app.vectorize);
    assert.equal(ph.vars.PREVIEW_SERVING, 'placeholder');
  });

  it('adds the paid-plan bindings only when asked, as create-fletch --paid does', () => {
    assert.equal(app.worker_loaders, undefined);
    const paid = slotConfig(BASE, plan, { accountId: ACCT, deploy: 'x', paid: true });
    assert.deepEqual(paid.worker_loaders, [{ binding: 'LOADER' }]);
    assert.deepEqual(paid.images, { binding: 'IMAGES' });
    assert.equal(slotConfig(BASE, plan, { accountId: ACCT, deploy: 'x', paid: true, placeholder: true }).worker_loaders, undefined);
  });

  it('refuses a base config with a key or binding a slot does not know, rather than copy it', () => {
    assert.throws(() => slotConfig({ ...BASE, d1_databases: [{ binding: 'DB', database_id: 'prod' }] }, plan, { accountId: ACCT }), /d1_databases, which a preview slot does not know/);
    assert.throws(() => slotConfig({ ...BASE, r2_buckets: [...BASE.r2_buckets, { binding: 'OTHER', bucket_name: 'prod' }] }, plan, { accountId: ACCT }), /R2 binding OTHER/);
    assert.throws(() => slotConfig({ ...BASE, exports: { ...BASE.exports, PreviewLease: { type: 'durable-object', storage: 'sqlite' } } }, plan, { accountId: ACCT }), /the slot lease's class/);
  });

  it('the agent entry and the placeholder export the classes their configs declare', () => {
    const src = (f) => readFileSync(path.join(REPO, 'scripts', 'preview-slot', f), 'utf8');
    const agentIndex = readFileSync(path.join(REPO, 'packages', 'agent', 'src', 'index.ts'), 'utf8');
    for (const c of AGENT_CLASSES) assert.match(agentIndex, new RegExp(`export \\{[^}]*\\b${c}\\b`), `the agent exports ${c}`);
    assert.match(src('app.mjs'), /export \* from '\.\.\/\.\.\/packages\/agent\/src\/index\.ts'/);
    assert.match(src('app.mjs'), /export \{ PreviewLease \}/);
    assert.match(src('placeholder.mjs'), /export \{ PreviewLease \}/);
    for (const c of AGENT_CLASSES) assert.ok(!src('placeholder.mjs').includes(c), `the placeholder does not export ${c}`);
  });

  it('the generated config is git-ignored', () => {
    assert.match(readFileSync(path.join(REPO, '.gitignore'), 'utf8'), /^packages\/agent\/wrangler\.preview\.jsonc$/m);
  });
});

describe('preview plan: the inventory guard', () => {
  const slot = (n, resources) => ({ n, name: `fletch-pv-${n}`, resources });
  const good = slot(2, [
    { kind: 'r2', name: 'fletch-pv-2-agent' },
    { kind: 'vectorize', name: 'fletch-pv-2-memory' },
    { kind: 'worker', name: 'fletch-pv-2' },
  ]);

  it('passes a slot whose every name is its own', () => {
    assertDeletable(good);
  });

  it("refuses a slot with any name not its own: another slot's, the base config's, qyvr's, or a mismatched slot name", () => {
    for (const bad of [
      slot(2, [{ kind: 'r2', name: 'fletch-pv-1-agent' }]),
      slot(2, [{ kind: 'r2', name: 'qyvr-base-agent' }]),
      slot(2, [{ kind: 'worker', name: 'qyvr-dev' }]),
      slot(2, [{ kind: 'worker', name: 'fletch-pv-20' }]),
      slot(2, [{ kind: 'd1', name: 'fletch-pv-2-db' }]),
      { ...good, name: 'fletch-pv-3' },
    ]) {
      assert.throws(() => assertDeletable(bad), /refusing to delete anything/, JSON.stringify(bad));
    }
  });

  it('deletes the Worker first, then the bucket, then the index', () => {
    assert.deepEqual(deletionOrder([...good.resources].reverse()).map((r) => r.kind), ['worker', 'r2', 'vectorize']);
  });

  it('record merges an entry into the one of the same kind and name', () => {
    const s = record(record(slot(1, []), { kind: 'r2', name: 'fletch-pv-1-agent' }), { kind: 'r2', name: 'fletch-pv-1-agent', created: true });
    assert.deepEqual(s.resources, [{ kind: 'r2', name: 'fletch-pv-1-agent', created: true }]);
  });
});

describe('preview plan: leases and credentials', () => {
  it('freeSlot is the first never-taken or expired slot', () => {
    assert.equal(freeSlot([{ n: 1, lease: { leased: true } }, { n: 2, lease: { leased: false } }]), 2);
    assert.equal(freeSlot([{ n: 1, lease: null }]), undefined);
  });

  it('gcReason takes back an expired lease or a merged branch, nothing else', () => {
    const merged = new Set(['h-merged']);
    assert.equal(gcReason({ expiresAt: 10, branchHash: 'h' }, merged, 10), 'its lease expired');
    assert.equal(gcReason({ expiresAt: 20, branchHash: 'h-merged' }, merged, 10), 'its branch merged');
    assert.equal(gcReason({ expiresAt: 20, branchHash: 'h' }, merged, 10), null);
    assert.equal(gcReason({ expiresAt: null }, merged, 10), null);
  });

  it('authMode is the token in a cloud session or when asked, else the login', () => {
    assert.equal(authMode({}), 'oauth');
    assert.equal(authMode({ CLAUDE_CODE_REMOTE: 'true' }), 'token');
    assert.equal(authMode({ FLETCH_PREVIEW_AUTH: 'token' }), 'token');
    assert.equal(authMode({ CLAUDE_CODE_REMOTE: 'true', FLETCH_PREVIEW_AUTH: 'oauth' }), 'oauth');
  });

  it('wranglerEnv drops every token on the login, and needs one, for the pool account, on the token', () => {
    const login = wranglerEnv({ CLOUDFLARE_API_TOKEN: 't', CLAUDE_CODE_OAUTH_TOKEN: 'c', PATH: '/bin' }, 'oauth', ACCT);
    assert.equal(login.CLOUDFLARE_API_TOKEN, undefined);
    assert.equal(login.CLAUDE_CODE_OAUTH_TOKEN, undefined);
    assert.equal(login.CLOUDFLARE_ACCOUNT_ID, ACCT);
    assert.equal(wranglerEnv({ CLOUDFLARE_API_TOKEN: 'placeholder' }, 'token', ACCT).CLOUDFLARE_API_TOKEN, 'placeholder');
    assert.throws(() => wranglerEnv({}, 'token', ACCT), /needs CLOUDFLARE_API_TOKEN/);
    assert.throws(() => wranglerEnv({ CLOUDFLARE_API_TOKEN: 't', CLOUDFLARE_ACCOUNT_ID: 'b'.repeat(32) }, 'token', ACCT), /not the pool's account/);
  });
});

describe("preview plan: reading wrangler's output", () => {
  it('jsonOut finds the JSON between banners and notices', () => {
    assert.deepEqual(jsonOut(' ⛅️ wrangler\n───\n[\n  { "name": "x" }\n]\nnotice\n'), [{ name: 'x' }]);
    assert.deepEqual(jsonOut('[{"a":1}]'), [{ a: 1 }]);
    assert.throws(() => jsonOut('nothing'), /no JSON/);
  });

  it('r2Names reads the bucket list', () => {
    assert.deepEqual(r2Names('name:           a\ncreation_date:  x\n\nname:           b\n'), ['a', 'b']);
  });

  it("workerTag reads the deploy entry of wrangler's output file, and nothing else", () => {
    const tag = 'ab'.repeat(16);
    assert.equal(workerTag(`{"type":"wrangler-session"}\nnot json\n{"type":"deploy","worker_tag":"${tag}"}\n`), tag);
    assert.equal(workerTag(`{"type":"version-upload","worker_tag":"${tag}"}\n`), null);
    assert.equal(workerTag('{"type":"deploy","worker_tag":"nope"}\n'), null);
  });
});
