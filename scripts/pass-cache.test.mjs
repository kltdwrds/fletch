import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { CACHEABLE_STEPS, cacheKey, enabled, lookup, record } from './lib/pass-cache.ts';

const dirs = [];
const fresh = () => {
  const d = mkdtempSync(path.join(tmpdir(), 'pass-cache-'));
  dirs.push(d);
  return d;
};
after(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
const base = { tree: 'aaa', step: 1, id: 'M15.5', versions: { node: 'v24.0.0' } };

describe('pass cache', () => {
  it('is opt-in: off unless ACCEPT_PASS_CACHE=1', () => {
    assert.equal(enabled({}), false);
    assert.equal(enabled({ ACCEPT_PASS_CACHE: '0' }), false);
    assert.equal(enabled({ ACCEPT_PASS_CACHE: '1' }), true);
  });

  it('hits on the same tree, step, id and versions', () => {
    const dir = fresh();
    record(dir, base, '3 projects');
    assert.equal(lookup(dir, base), '3 projects');
  });

  it('misses when the tree, step, id or a tool version changes', () => {
    const dir = fresh();
    record(dir, base, 'ok');
    for (const changed of [{ tree: 'bbb' }, { step: 2 }, { id: 'M15.6' }, { versions: { node: 'v25.0.0' } }]) {
      assert.equal(lookup(dir, { ...base, ...changed }), null, JSON.stringify(changed));
    }
  });

  it('never stores or serves a step whose result is not a function of the tree', () => {
    const dir = fresh();
    for (const step of [3, 8, 11, 12]) {
      assert.ok(!CACHEABLE_STEPS.has(step));
      record(dir, { ...base, step }, 'ok');
      assert.equal(lookup(dir, { ...base, step }), null);
    }
  });

  it('keys are distinct per input', () => {
    assert.notEqual(cacheKey(base), cacheKey({ ...base, tree: 'x' }));
  });

  it('accept.ts consults the cache only behind the opt-in', () => {
    const src = readFileSync(new URL('./accept.ts', import.meta.url), 'utf8');
    assert.match(src, /passCacheOn\(\) \? lookup\(/);
    assert.match(src, /passCacheOn\(\) && hit === null && outcome\.ok\) record\(/);
  });
});
