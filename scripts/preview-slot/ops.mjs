// What a fletch preview slot's Worker answers at /__preview/, before the agent or the placeholder sees the request
// (docs/preview.md): its lease, a claim of it, and a reset of the slot's bucket and memory index. It works through the
// slot's own bindings, so the scoped token that deploys a slot needs no R2 or Vectorize permission. A caller proves it
// may by a key: the secret PREVIEW_KEY_<tag> it set on this Worker. The lease (./lease.mjs) says which tag owns the
// slot. The agent's Durable Objects are wiped by the placeholder's deploy, not here. The agent never imports this file.
import { fullLease, MAX_TTL_SECONDS, publicLease } from './lease-rules.mjs';

/** The most bytes a request body may carry. */
export const MAX_BODY = 64 * 1024;
/** How many objects one reset call deletes before answering `done: false`, inside a Worker's subrequest budget. */
export const RESET_BUDGET = 400;
/** The most vectors one Vectorize query returns without values or metadata. */
export const VECTOR_PAGE = 100;
const TAG = /^[a-z0-9]{6,32}$/;

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
const refuse = (status, code, message) => json(status, { error: { code, message } });

/** Equal strings in time that does not depend on where they differ. */
function sameText(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function sha256Hex(text) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const TOO_LARGE = Symbol('too large');

/** The body as parsed JSON; TOO_LARGE past MAX_BODY, undefined when it is not JSON. */
async function bodyOf(request) {
  if (Number(request.headers.get('content-length') ?? 0) > MAX_BODY) return TOO_LARGE;
  const text = await request.text();
  if (text.length > MAX_BODY) return TOO_LARGE;
  try {
    return JSON.parse(text || '{}');
  } catch {
    return undefined;
  }
}

/** The tag a request's key proves, or null: the key must equal this Worker's secret PREVIEW_KEY_<tag>. */
function caller(request, env) {
  const tag = request.headers.get('x-preview-tag') ?? '';
  const key = request.headers.get('x-preview-key') ?? '';
  if (!TAG.test(tag) || key.length < 32) return null;
  return sameText(env[`PREVIEW_KEY_${tag}`], key) ? tag : null;
}

/**
 * Empties the bucket, then the index, up to RESET_BUDGET deletions; true when both are empty. The index is read by one
 * query with no namespace (a namespace is a filter, so this reaches all of them) for the vectors nearest a unit vector:
 * any vector is near enough. A deletion takes seconds to show, so a vector deleted by this call still counts until a
 * later call's query no longer returns it.
 */
export async function emptyStores(env) {
  let budget = RESET_BUDGET;
  while (budget > 0) {
    const page = await env.AGENT_BUCKET.list({ limit: Math.min(1000, budget) });
    if (page.objects.length === 0) break;
    await env.AGENT_BUCKET.delete(page.objects.map((o) => o.key));
    budget -= page.objects.length;
  }
  if (budget <= 0) return false;
  const d = await env.MEMORY_INDEX.describe();
  const dims = d.dimensions ?? d.config?.dimensions;
  const probe = Array.from({ length: dims }, (_, i) => (i === 0 ? 1 : 0));
  const { matches } = await env.MEMORY_INDEX.query(probe, { topK: VECTOR_PAGE, returnValues: false, returnMetadata: 'none' });
  if (matches.length === 0) return true;
  await env.MEMORY_INDEX.deleteByIds(matches.map((m) => m.id));
  return false;
}

/**
 * The answer to a /__preview/ request, or null for any other request. `lease` is the slot's lease store (the Durable
 * Object's stub, or the tests' memoryLease); `now` is seconds.
 */
export async function ops(request, env, { lease: store, now = Math.floor(Date.now() / 1000) }) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith('/__preview/')) return null;
  const lease = await store.read();
  const tag = caller(request, env);
  const holds = Boolean(tag && lease && lease.expiresAt > now && lease.tag === tag);
  const serving = { serving: env.PREVIEW_SERVING ?? null, deploy: env.PREVIEW_DEPLOY ?? null };

  if (request.method === 'GET' && url.pathname === '/__preview/lease') return json(200, { ...(tag ? fullLease(lease, now) : publicLease(lease, now)), ...serving });
  if (!tag) return refuse(401, 'unauthorized', 'no key this slot holds');
  if (request.method !== 'POST') return refuse(404, 'not_found', 'no such preview op');
  const body = await bodyOf(request);
  if (body === TOO_LARGE) return refuse(413, 'too_large', `a body is at most ${MAX_BODY} bytes`);
  if (body === undefined || typeof body !== 'object' || Array.isArray(body) || body === null) return refuse(400, 'invalid', 'send a JSON object');

  if (url.pathname === '/__preview/claim') {
    const ttl = Number(body.ttlSeconds);
    if (typeof body.branch !== 'string' || typeof body.owner !== 'string' || body.owner.length > 200 || !(ttl > 0 && ttl <= MAX_TTL_SECONDS)) return refuse(400, 'invalid', 'send { branch, owner, ttlSeconds }');
    const r = await store.claim({ tag, branchHash: await sha256Hex(body.branch), owner: body.owner, ttlSeconds: ttl }, now);
    if (r.conflict) return json(409, { error: { code: 'conflict', message: 'another session holds this slot' }, lease: fullLease(lease, now) });
    return json(200, { ...fullLease(r.lease, now), fresh: r.fresh });
  }

  if (url.pathname === '/__preview/reset') {
    // The holder resets its own slot; gc resets one whose lease it judged over, only while that lease is still the one it judged.
    const forced = body.force === true && typeof body.expectTag === 'string' && lease?.tag === body.expectTag;
    if (!holds && !forced) return refuse(409, 'conflict', 'this slot is not yours to reset, or its lease changed');
    if (!(await emptyStores(env))) return json(200, { done: false });
    // A fresh lease resets what the last one left and keeps itself; a release ends the lease it reset.
    if (holds && body.keepLease === true) return json(200, { done: true });
    await store.end(forced ? { force: true, expectTag: body.expectTag } : { tag }, now);
    return json(200, { done: true });
  }
  return refuse(404, 'not_found', 'no such preview op');
}
