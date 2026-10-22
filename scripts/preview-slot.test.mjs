import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { sha256Hex } from './preview-plan.mjs';
import { fakeSlot } from './preview-fakes.mjs';
import { decideClaim, MAX_TTL_SECONDS, mayEnd } from './preview-slot/lease-rules.mjs';
import { MAX_BODY, ops, RESET_BUDGET } from './preview-slot/ops.mjs';

// A slot Worker's /__preview/ ops (scripts/preview-slot/ops.mjs) over fakes: the lease rules, the key, and the reset of
// the slot's bucket and index through its own bindings.
const HOST = 'fletch-pv-1.example-sub.workers.dev';
const KEY_A = 'a'.repeat(64);
const KEY_B = 'b'.repeat(64);
let slot;
let now;

const call = async (method, name, { tag, key, body, raw, secrets = { PREVIEW_KEY_aaaaaa: KEY_A, PREVIEW_KEY_bbbbbb: KEY_B } } = {}) => {
  const headers = { 'content-type': 'application/json' };
  if (tag) Object.assign(headers, { 'x-preview-tag': tag, 'x-preview-key': key });
  const r = await ops(new Request(`https://${HOST}/__preview/${name}`, { method, headers, body: raw ?? (body === undefined ? undefined : JSON.stringify(body)) }), slot.env(secrets), { lease: slot.lease, now });
  return { status: r.status, body: await r.json() };
};
const A = { tag: 'aaaaaa', key: KEY_A };
const B = { tag: 'bbbbbb', key: KEY_B };
const claim = (who, extra = {}) => call('POST', 'claim', { ...who, body: { branch: 'claude/x', owner: 'test', ttlSeconds: 3600, ...extra } });

beforeEach(() => {
  slot = fakeSlot(HOST);
  now = 1_000_000;
});

describe('preview slot ops: the lease', () => {
  it('answers only /__preview/, leaving every other path to the agent', async () => {
    assert.equal(await ops(new Request(`https://${HOST}/health`), slot.env({}), { lease: slot.lease, now }), null);
  });

  it('shows the public lease to anyone, naming the branch only by its hash, and the whole lease to a key holder', async () => {
    assert.deepEqual((await call('GET', 'lease')).body, { leased: false, expiresAt: null, branchHash: null, serving: 'placeholder', deploy: null });
    await claim(A);
    const pub = (await call('GET', 'lease')).body;
    assert.deepEqual(pub, { leased: true, expiresAt: now + 3600, branchHash: sha256Hex('claude/x'), serving: 'placeholder', deploy: null });
    assert.ok(!JSON.stringify(pub).includes('claude/x'));
    const full = (await call('GET', 'lease', A)).body;
    assert.equal(full.tag, 'aaaaaa');
    assert.equal(full.owner, 'test');
  });

  it('refuses every op without a key the slot holds', async () => {
    assert.equal((await claim({})).status, 401);
    assert.equal((await claim({ tag: 'aaaaaa', key: KEY_B })).status, 401);
    assert.equal((await claim({ tag: 'aaaaaa', key: 'short' })).status, 401);
    assert.equal((await claim({ tag: 'cccccc', key: KEY_A })).status, 401, 'a tag with no secret holds nothing');
    assert.equal((await call('POST', 'reset', { body: {} })).status, 401);
  });

  it('takes a free slot fresh, renews it for its holder, refuses another while live, and lets another take it once expired', async () => {
    const first = await claim(A);
    assert.equal(first.status, 200);
    assert.equal(first.body.fresh, true);
    now += 100;
    const renewed = await claim(A, { ttlSeconds: 7200 });
    assert.equal(renewed.body.fresh, false);
    assert.equal(renewed.body.leasedAt, 1_000_000);
    assert.equal(renewed.body.expiresAt, now + 7200);
    const taken = await claim(B);
    assert.equal(taken.status, 409);
    assert.equal(taken.body.lease.tag, 'aaaaaa');
    now += 7200;
    const after = await claim(B);
    assert.equal(after.status, 200);
    assert.equal(after.body.fresh, true);
  });

  it('refuses a claim with no branch or owner, or a lease longer than a week', async () => {
    assert.equal((await claim(A, { ttlSeconds: MAX_TTL_SECONDS + 1 })).status, 400);
    assert.equal((await claim(A, { ttlSeconds: 0 })).status, 400);
    assert.equal((await claim(A, { branch: undefined })).status, 400);
    assert.equal((await claim(A, { owner: 'x'.repeat(201) })).status, 400);
  });

  it('refuses a body past the limit, and one that is not a JSON object', async () => {
    assert.equal((await call('POST', 'claim', { ...A, raw: JSON.stringify({ pad: 'x'.repeat(MAX_BODY) }) })).status, 413);
    assert.equal((await call('POST', 'claim', { ...A, raw: 'nope' })).status, 400);
    assert.equal((await call('POST', 'claim', { ...A, raw: '[1]' })).status, 400);
    assert.equal((await call('POST', 'claim', { ...A, raw: 'null' })).status, 400);
  });

  it('the lease rules: a claim is a compare-and-set, and only the holder, or gc naming the judged tag, ends it', () => {
    const held = { tag: 'a', expiresAt: 20, leasedAt: 1 };
    assert.deepEqual(decideClaim(held, { tag: 'b', ttlSeconds: 5 }, 10), { conflict: true });
    assert.equal(decideClaim(held, { tag: 'b', ttlSeconds: 5 }, 20).fresh, true);
    assert.equal(mayEnd(held, { tag: 'a' }, 10), true);
    assert.equal(mayEnd(held, { tag: 'b' }, 10), false);
    assert.equal(mayEnd(held, { tag: 'a' }, 20), false, 'an expired lease is gc\'s to end');
    assert.equal(mayEnd(held, { force: true, expectTag: 'a' }, 30), true);
    assert.equal(mayEnd(held, { force: true, expectTag: 'b' }, 30), false);
  });
});

describe('preview slot ops: the reset', () => {
  const fill = (objects, vectors) => {
    for (let i = 0; i < objects; i++) slot.AGENT_BUCKET.map.set(`o${i}`, 'x');
    for (let i = 0; i < vectors; i++) slot.MEMORY_INDEX.map.set(`v${i}`, { namespace: `ns${i % 3}` });
  };

  it("empties the holder's bucket and every namespace of its index, then ends the lease", async () => {
    await claim(A);
    fill(3, 5);
    const r = await call('POST', 'reset', { ...A, body: {} });
    assert.deepEqual(r.body, { done: false }, 'the index is read again before it counts as empty');
    assert.deepEqual((await call('POST', 'reset', { ...A, body: {} })).body, { done: true });
    assert.equal(slot.AGENT_BUCKET.map.size, 0);
    assert.equal(slot.MEMORY_INDEX.map.size, 0);
    assert.equal((await call('GET', 'lease')).body.leased, false);
  });

  it('keeps the lease with keepLease (a fresh lease clearing what the last left)', async () => {
    await claim(A);
    fill(1, 0);
    assert.deepEqual((await call('POST', 'reset', { ...A, body: { keepLease: true } })).body, { done: true });
    assert.equal((await call('GET', 'lease', A)).body.tag, 'aaaaaa');
  });

  it('answers done: false past its budget, and while deleted vectors still show', async () => {
    slot = fakeSlot(HOST, { lag: 2 });
    await claim(A);
    fill(RESET_BUDGET + 5, 2);
    assert.deepEqual((await call('POST', 'reset', { ...A, body: {} })).body, { done: false });
    assert.equal(slot.AGENT_BUCKET.map.size, 5);
    const answers = [];
    while (answers.at(-1) !== true && answers.length < 10) answers.push((await call('POST', 'reset', { ...A, body: {} })).body.done);
    assert.deepEqual(answers, [false, false, false, true], 'two calls after the vectors went, while they still showed');
  });

  it("refuses to reset a slot that is not the caller's, unless gc forces it naming the tag it judged", async () => {
    await claim(A);
    fill(1, 0);
    assert.equal((await call('POST', 'reset', { ...B, body: {} })).status, 409);
    assert.equal((await call('POST', 'reset', { ...B, body: { force: true, expectTag: 'zzzzzz' } })).status, 409);
    assert.equal(slot.AGENT_BUCKET.map.size, 1);
    assert.deepEqual((await call('POST', 'reset', { ...B, body: { force: true, expectTag: 'aaaaaa' } })).body, { done: true });
    assert.equal((await call('GET', 'lease')).body.expiresAt, null);
  });
});
