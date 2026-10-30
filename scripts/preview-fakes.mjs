// Test doubles for `pnpm preview`'s tests (scripts/preview-slot.test.mjs, scripts/preview.test.mjs): R2 and Vectorize
// in memory, a slot answering /__preview/ with the real scripts/preview-slot/ops.mjs and /health as the agent would, and
// an account answering the wrangler calls scripts/preview.mjs, scripts/preview-pool.mjs and scripts/self-host.mjs make
// (scripts/self-host.test.mjs uses it too). Not a test itself.
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { memoryLease } from './preview-slot/lease-rules.mjs';
import { ops } from './preview-slot/ops.mjs';
import { sha256Hex } from './preview-plan.mjs';

export function fakeR2() {
  const m = new Map();
  return {
    map: m,
    list: async ({ limit = 1000 } = {}) => ({ objects: [...m.keys()].slice(0, limit).map((key) => ({ key })) }),
    delete: async (keys) => {
      for (const k of [keys].flat()) m.delete(k);
    },
  };
}

/**
 * A Vectorize index in memory. A deleted vector still answers the next `lag` queries, as Cloudflare's does for seconds;
 * a query with no namespace reaches every namespace, as Cloudflare's does.
 */
export function fakeVectorize({ lag = 0 } = {}) {
  const m = new Map();
  const ghosts = new Map();
  return {
    map: m,
    describe: async () => ({ dimensions: 768 }),
    query: async (vector, { topK }) => {
      if (vector.length !== 768) throw new Error('wrong dimensions');
      const ids = [...m.keys(), ...ghosts.keys()].slice(0, topK);
      for (const [id, left] of ghosts) left <= 1 ? ghosts.delete(id) : ghosts.set(id, left - 1);
      return { matches: ids.map((id) => ({ id, score: 0.5 })) };
    },
    deleteByIds: async (ids) => {
      for (const id of ids) {
        if (m.delete(id) && lag > 0) ghosts.set(id, lag);
      }
      return { mutationId: 'm' };
    },
  };
}

/** One slot: its stores, its lease object, the agent's Durable Object state, and what its Worker is serving. */
export function fakeSlot(host, opts = {}) {
  const s = { host, AGENT_BUCKET: fakeR2(), MEMORY_INDEX: fakeVectorize(opts), lease: memoryLease(), objects: new Map(), vars: { PREVIEW_SERVING: 'placeholder', PREVIEW_DEPLOY: null, TENANT_ID: null } };
  s.env = (secrets) => ({ ...s.vars, AGENT_BUCKET: s.AGENT_BUCKET, MEMORY_INDEX: s.MEMORY_INDEX, ...secrets });
  return s;
}

/** fetch for slot hosts: /__preview/ answered by the real ops over that slot's fakes at the clock's second, /health by the agent when it serves. */
export function fakeSlotsFetch(slots, secretsOf, clock, { before } = {}) {
  return async (url, init = {}) => {
    const u = new URL(url);
    const slot = slots.get(u.host);
    if (!slot) throw new Error(`fake fetch: no host ${u.host}`);
    await before?.(u, init);
    const env = slot.env(secretsOf(u.host));
    const r = await ops(new Request(url, init), env, { lease: slot.lease, now: clock.now() });
    if (r) return r;
    if (env.PREVIEW_SERVING !== 'app') return new Response('This fletch preview slot is free.\n', { status: 503 });
    if (u.pathname === '/health') return Response.json({ ok: true, tenant: env.TENANT_ID });
    return new Response('agent', { status: 200 });
  };
}

/** The tag the fake account gives a Worker: 32 hex from its name. */
export const tagOf = (name) => sha256Hex(name).slice(0, 32);

/**
 * An account as wrangler shows it, wired to `slots` (by Worker name): a deploy sets what the slot serves, and the
 * placeholder's deploy (its config tombstones the agent's classes) deletes the agent's objects. `fail` makes every call
 * starting with one of its strings fail; `stale` makes a secrets write build on the version before the last write.
 */
export function fakeAccount({ subdomain, slotsByWorker }) {
  const s = { r2: new Map(), vectorize: new Set(), workers: new Set(), secrets: new Map(), before: new Map(), stale: false, deployed: [], calls: [], fail: [], configs: new Map() };
  const okOut = (out = 'ok') => ({ status: 0, out });
  s.run = (args, opts = {}) => {
    const line = args.join(' ');
    s.calls.push(line);
    if (s.fail.some((f) => line.startsWith(f))) return { status: 1, out: 'it failed [code: 10000]' };
    const [a, b, c] = args;
    if (line === 'r2 bucket list') return okOut([...s.r2.keys()].map((n) => `name:           ${n}\ncreation_date:  x\n`).join('\n'));
    if (line === 'vectorize list --json') return okOut(` ⛅️ wrangler\n${JSON.stringify([...s.vectorize].map((name) => ({ name })))}`);
    if (a === 'deployments') return s.workers.has(args[3]) ? okOut('[]') : { status: 1, out: 'This Worker does not exist on your account. [code: 10007]' };
    if (a === 'delete') return s.workers.delete(args[2]) ? okOut() : { status: 1, out: '[code: 10007]' };
    if (a === 'r2' && c === 'create') return s.r2.set(args[3], 0) && okOut();
    if (a === 'r2' && c === 'delete') return s.r2.get(args[3]) > 0 ? { status: 1, out: '[code: 10008]' } : s.r2.delete(args[3]) && okOut();
    if (a === 'vectorize' && b === 'create') return s.vectorize.add(c) && okOut();
    if (a === 'vectorize' && b === 'delete') return s.vectorize.delete(c) ? okOut() : { status: 1, out: 'no such' };
    if (a === 'whoami') return okOut('logged in');
    if (a === 'deploy') {
      const config = JSON.parse(s.configs.get(path.join(opts.cwd, args[2])).replace(/^\/\/.*\n/, ''));
      // Like wrangler, the tag is the one looked up before the upload: none for the deploy that makes the Worker.
      const tag = s.workers.has(config.name) ? tagOf(config.name) : null;
      s.workers.add(config.name);
      s.deployed.push({ name: config.name, main: config.main, config });
      const slot = slotsByWorker.get(config.name);
      if (slot) {
        if (Object.values(config.exports).some((e) => e.state === 'deleted')) slot.objects.clear();
        Object.assign(slot.vars, { PREVIEW_SERVING: config.vars.PREVIEW_SERVING, PREVIEW_DEPLOY: config.vars.PREVIEW_DEPLOY, TENANT_ID: config.vars.TENANT_ID });
      }
      const out = opts.extraEnv?.WRANGLER_OUTPUT_FILE_PATH;
      const url = `https://${config.name}.${subdomain}.workers.dev`;
      if (out) writeFileSync(out, `${JSON.stringify({ type: 'wrangler-session', version: 1 })}\n${JSON.stringify({ type: 'deploy', worker_name: config.name, worker_tag: tag, targets: [url] })}\n`);
      return okOut(`Uploaded ${config.name}\nDeployed ${config.name} triggers\n  ${url}\n`);
    }
    if (a === 'secret' && b === 'bulk') {
      const w = args[3];
      if (!s.workers.has(w)) return { status: 1, out: '[code: 10007]' };
      const held = { ...((s.stale ? s.before.get(w) : s.secrets.get(w)) ?? {}) };
      s.before.set(w, s.secrets.get(w) ?? {});
      for (const [k, v] of Object.entries(JSON.parse(opts.input))) {
        if (v === null) delete held[k];
        else held[k] = v;
      }
      s.secrets.set(w, held);
      return okOut();
    }
    if (a === 'secret' && b === 'list') return okOut(JSON.stringify(Object.keys(s.secrets.get(args[3]) ?? {}).map((name) => ({ name, type: 'secret_text' }))));
    throw new Error(`fake account: no answer for ${line}`);
  };
  s.drain = async (bucket) => {
    const n = s.r2.get(bucket);
    s.r2.set(bucket, 0);
    return n;
  };
  return s;
}
