// The pool of fletch preview slots (docs/preview.md): each slot's names and host; its wrangler config, derived from the
// agent's base config (packages/agent/wrangler.jsonc); the pool's inventory, the one record of what provisioning made;
// the check every deletion passes; the lease rules; and which credential wrangler runs on. No I/O: scripts/preview.mjs
// and scripts/preview-pool.mjs do the wrangler, git and file work, scripts/preview-slot/ is what a slot's Worker runs,
// and scripts/preview-plan.test.mjs tests this. Ported from qyvr's scripts/preview-plan.mjs.
import { createHash } from 'node:crypto';

/** Every preview resource's name starts with this, and nothing else on the account does. */
export const PREFIX = 'fletch-pv-';
/** How long a lease lasts unless `up` renews it, in hours. */
export const DEFAULT_TTL_HOURS = 24;
/** The most slots a pool may have. */
export const MAX_SLOTS = 20;
/** The slot's owner: the fixture person (test/fixtures/people.json), never a real address. */
export const SLOT_OWNER = 'sam@solo-sam.example';
/** The vars `pnpm preview up --var K=V` may set on a slot: how its chat reaches a model (`packages/agent/src/model/routes.ts`), nothing else. */
export const SLOT_VAR_KEYS = ['AI_GATEWAY_ID', 'CHAT_PROVIDER', 'CHAT_HEDGE'];
/** The memory index's shape: MEMORY_INDEX_CONFIG in packages/host-cloudflare/src/provision/resources.ts. */
export const MEMORY_INDEX = { dimensions: 768, metric: 'cosine' };
/** The slot Worker's entry, from packages/agent/ where its generated config is written. */
export const SLOT_MAIN = { app: '../../scripts/preview-slot/app.mjs', placeholder: '../../scripts/preview-slot/placeholder.mjs' };
/** The Durable Object a slot keeps its lease in, beside the agent's: never tombstoned, so a lease outlives a wipe. */
export const LEASE_OBJECT = { binding: 'PREVIEW_LEASE', className: 'PreviewLease' };
/** The hosts a cloud session's network allowlist needs, besides each slot's (printed by `doctor`). */
export const CLOUD_HOSTS = [
  ['api.cloudflare.com', 'every wrangler call, and `doctor`'],
  ['tail.developers.workers.dev', "wrangler tail's WebSocket"],
  ['registry.npmjs.org', 'pnpm install'],
  ['api.github.com', 'gh, for which branches merged (gc)'],
];

const NAME = /^fletch-pv-[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SUBDOMAIN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/** Whether a resource name is a preview's: the prefix, then lowercase words joined by single hyphens, at most 63 characters. */
export const isPreviewName = (name) => typeof name === 'string' && name.length <= 63 && NAME.test(name);

const digest = (text) => createHash('sha256').update(text).digest();
export const sha256Hex = (text) => digest(text).toString('hex');

/**
 * Everything slot `n` is named: its Worker, bucket and index (by binding), and its host when the account's workers.dev
 * subdomain is known. The subdomain names the account's owner, so it is never committed (docs/preview.md, Credentials).
 */
export function slotPlan(n, subdomain = null) {
  if (!Number.isInteger(n) || n < 1 || n > MAX_SLOTS) throw new Error(`preview: slot ${n} is not 1 to ${MAX_SLOTS}`);
  if (subdomain !== null && !SUBDOMAIN.test(subdomain)) throw new Error(`preview: ${subdomain} is not a workers.dev subdomain`);
  const name = `${PREFIX}${n}`;
  return {
    n,
    name,
    worker: name,
    r2: { AGENT_BUCKET: `${name}-agent` },
    vectorize: { MEMORY_INDEX: `${name}-memory` },
    host: subdomain ? `${name}.${subdomain}.workers.dev` : null,
  };
}

/** The slot's origin; refuses a plan made without the subdomain. */
export function origin(plan) {
  if (!plan.host) throw new Error('preview: the workers.dev subdomain is not known; set FLETCH_PREVIEW_SUBDOMAIN (docs/preview.md)');
  return `https://${plan.host}`;
}

/** The subdomain in a workers.dev URL wrangler printed for `worker`, or null. */
export function subdomainIn(text, worker) {
  const m = text.match(new RegExp(`https://${worker.replace(/[-.]/g, '\\$&')}\\.([a-z0-9-]+)\\.workers\\.dev\\b`));
  return m ? m[1] : null;
}

/** A worktree's lease tag: 12 hex of its root's hash. Its key is the slot Worker's secret PREVIEW_KEY_<tag>. */
export const ownerTag = (root) => digest(root).toString('hex').slice(0, 12);

/** The data resources provisioning makes for a slot, in order, each as its inventory entry names it. */
export const dataResources = (plan) => [
  ...Object.entries(plan.r2).map(([binding, name]) => ({ kind: 'r2', binding, name })),
  ...Object.entries(plan.vectorize).map(([binding, name]) => ({ kind: 'vectorize', binding, name })),
];

/**
 * Every key of the base config a slot's config is known to handle: rebound to the slot's own resource, replaced, or safe
 * to copy. Anything else (a D1, a KV namespace, a queue, a service binding…) would be copied as it is and could point a
 * slot at another deploy's resource, so it is refused until someone decides what a slot gets and adds it here.
 */
export const KNOWN_CONFIG_KEYS = new Set([
  'ai', 'compatibility_date', 'compatibility_flags', 'durable_objects', 'exports', 'main', 'name', 'observability',
  'r2_buckets', 'vars', 'vectorize',
]);

/** Each binding of `list` pointed at the slot's resource for it, by `byBinding`; a binding the slot does not have is refused. */
function rebind(list, byBinding, what, point) {
  return (list ?? []).map((b) => {
    const name = byBinding[b.binding];
    if (name === undefined) throw new Error(`preview: the agent has a ${what} binding ${b.binding} a slot does not have`);
    return point(b, name);
  });
}

/**
 * The slot Worker's config, from the agent's raw base config: the agent on the slot's own bucket and index, its own
 * tenant (the slot's name) and the fixture owner, on workers.dev, with the lease's Durable Object beside the agent's.
 * The placeholder runs the slot's ops alone: the agent's classes are `deleted` tombstones, which delete every object
 * and its storage (idempotent, and harmless for a class never made: verified 2026-10-22), so a release wipes the
 * agent's state. `deploy` is a random id the slot echoes, so a deploy is known live; `paid` adds the paid-plan bindings
 * as `create-fletch --paid` does; `vars` are the model vars of `SLOT_VAR_KEYS` (`pnpm preview up --var K=V`), so a
 * slot can run its chat on another model than the self-host default.
 */
export function slotConfig(raw, plan, { accountId, placeholder = false, deploy, paid = false, vars = {} }) {
  const unknown = Object.keys(raw).filter((k) => !KNOWN_CONFIG_KEYS.has(k));
  if (unknown.length > 0) {
    throw new Error(`preview: packages/agent/wrangler.jsonc has ${unknown.join(', ')}, which a preview slot does not know: decide what a slot gets in scripts/preview-plan.mjs`);
  }
  const strangeVars = Object.keys(vars).filter((k) => !SLOT_VAR_KEYS.includes(k));
  if (strangeVars.length > 0) throw new Error(`preview: --var takes only ${SLOT_VAR_KEYS.join(', ')}; not ${strangeVars.join(', ')}`);
  const agentClasses = Object.entries(raw.exports ?? {}).filter(([, e]) => e.type === 'durable-object').map(([c]) => c);
  if (agentClasses.includes(LEASE_OBJECT.className)) throw new Error(`preview: the agent exports ${LEASE_OBJECT.className}, the slot lease's class`);
  const lease = { name: LEASE_OBJECT.binding, class_name: LEASE_OBJECT.className };
  const out = {
    ...raw,
    name: plan.worker,
    main: placeholder ? SLOT_MAIN.placeholder : SLOT_MAIN.app,
    account_id: accountId,
    workers_dev: true,
    preview_urls: false,
    r2_buckets: rebind(raw.r2_buckets, plan.r2, 'R2', (b, name) => ({ ...b, bucket_name: name })),
    vectorize: rebind(raw.vectorize, plan.vectorize, 'Vectorize', (b, name) => ({ ...b, index_name: name })),
    durable_objects: { bindings: [...(placeholder ? [] : (raw.durable_objects?.bindings ?? [])), lease] },
    exports: {
      ...Object.fromEntries(Object.entries(raw.exports ?? {}).map(([c, e]) => [c, placeholder && e.type === 'durable-object' ? { type: 'durable-object', state: 'deleted' } : e])),
      [LEASE_OBJECT.className]: { type: 'durable-object', storage: 'sqlite' },
    },
    vars: { ...raw.vars, ...vars, TENANT_ID: plan.name, OWNER_EMAIL: SLOT_OWNER, PREVIEW_SERVING: placeholder ? 'placeholder' : 'app', PREVIEW_DEPLOY: deploy },
  };
  if (placeholder) delete out.ai;
  else if (paid) {
    out.worker_loaders = [{ binding: 'LOADER' }];
    out.images = { binding: 'IMAGES' };
  }
  return out;
}

/** A generated config as written beside the agent's (git-ignored). */
export const configText = (config) => `// Written by scripts/preview.mjs from packages/agent/wrangler.jsonc (docs/preview.md); never edit or commit it.\n${JSON.stringify(config, null, 2)}\n`;

// The inventory: scripts/preview-pool.json, committed, secret-free. A slot's entry is written before each resource is made
// and filled after, so a crash between leaves a record that `provision` adopts and `deprovision` deletes.

export const newInventory = ({ accountId }) => ({ version: 1, accountId, slots: [] });

export const slotOf = (inv, n) => inv.slots.find((s) => s.n === n);

/** The inventory with `slot` in it, in slot order. */
export const withSlot = (inv, slot) => ({ ...inv, slots: [...inv.slots.filter((s) => s.n !== slot.n), slot].sort((a, b) => a.n - b.n) });

export const withoutSlot = (inv, n) => ({ ...inv, slots: inv.slots.filter((s) => s.n !== n) });

export const newSlot = (plan) => ({ n: plan.n, name: plan.name, resources: [] });

const same = (a, b) => a.kind === b.kind && a.name === b.name;

export const entryOf = (slot, kind, name) => slot.resources.find((r) => same(r, { kind, name }));

/** The slot with `entry` recorded (merged into an existing entry of the same kind and name). */
export function record(slot, entry) {
  const found = entryOf(slot, entry.kind, entry.name);
  const resources = found ? slot.resources.map((r) => (same(r, entry) ? { ...r, ...entry } : r)) : [...slot.resources, { created: false, ...entry }];
  return { ...slot, resources };
}

export const forget = (slot, kind, name) => ({ ...slot, resources: slot.resources.filter((r) => !same(r, { kind, name })) });

/**
 * Refuses a slot any of whose names is not its own: each resource name carries the prefix and is the slot's name or
 * starts with it, and the slot's name is the one its number gives. Every deletion passes this first.
 */
export function assertDeletable(slot) {
  const bad = [];
  if (!isPreviewName(slot?.name) || slot.name !== `${PREFIX}${slot.n}`) bad.push(`slot name ${JSON.stringify(slot?.name)}`);
  for (const r of slot?.resources ?? []) {
    if (!['worker', 'r2', 'vectorize'].includes(r.kind)) bad.push(`kind ${JSON.stringify(r.kind)}`);
    if (!isPreviewName(r.name) || (r.name !== slot.name && !r.name.startsWith(`${slot.name}-`))) bad.push(`${r.kind} ${JSON.stringify(r.name)}`);
  }
  if (bad.length > 0) throw new Error(`preview: refusing to delete anything for this slot: not a preview's: ${bad.join(', ')}`);
}

/** The order `deprovision` deletes in: the Worker first (nothing writes after), then the bucket, then the index. */
export const deletionOrder = (resources) => [...resources].sort((a, b) => ['worker', 'r2', 'vectorize'].indexOf(a.kind) - ['worker', 'r2', 'vectorize'].indexOf(b.kind));

/** The base config's names, which no slot may take. */
export function baseNames(raw) {
  return new Set([raw.name, ...(raw.r2_buckets ?? []).map((b) => b.bucket_name), ...(raw.vectorize ?? []).map((v) => v.index_name)].filter(Boolean));
}

// Leases.

/** The first slot whose public lease is free (never taken, or expired), or undefined. */
export const freeSlot = (leases) => leases.find(({ lease }) => lease && !lease.leased)?.n;

/** Why `gc` takes a slot back, or null: its lease expired with its data still there, or its branch merged. */
export function gcReason(lease, mergedHashes, now) {
  if (!lease || lease.expiresAt === null) return null;
  if (lease.expiresAt <= now) return 'its lease expired';
  if (mergedHashes.has(lease.branchHash)) return 'its branch merged';
  return null;
}

/** What Kyle puts in the account-owned token form for this pool, when `pnpm preview token` cannot. */
export function tokenForm(inv) {
  const workers = inv.slots.flatMap((s) => s.resources.filter((r) => r.kind === 'worker').map((r) => r.name));
  return [
    'Manage Account > Account API Tokens > Create Token (account-owned):',
    `  Account: ${inv.accountId}`,
    '  Workers: scope "Specified Workers", role "Editor", these Workers:',
    ...workers.map((w) => `    ${w}`),
    '  Nothing else: no R2, Vectorize, Workers AI or zone permission (a slot reaches its data through its own Worker).',
  ];
}

// Credentials.

/** Which credential wrangler runs on: the scoped token in a cloud session or when asked, else wrangler's own login. */
export function authMode(env) {
  if (env.FLETCH_PREVIEW_AUTH === 'oauth') return 'oauth';
  return env.FLETCH_PREVIEW_AUTH === 'token' || env.CLAUDE_CODE_REMOTE === 'true' ? 'token' : 'oauth';
}

/** The environment wrangler runs in: on the login, no token from the environment; on the token, the environment's, for the pool's account. */
export function wranglerEnv(env, mode, accountId) {
  const out = { ...env, WRANGLER_SEND_METRICS: 'false', WRANGLER_BUILD_CONDITIONS: 'development,workerd,worker,browser' };
  if (mode === 'oauth') {
    delete out.CLOUDFLARE_API_TOKEN;
    delete out.CLAUDE_CODE_OAUTH_TOKEN;
  } else {
    if (!env.CLOUDFLARE_API_TOKEN) throw new Error('preview: token mode needs CLOUDFLARE_API_TOKEN (in a cloud session, the network secret attaches the real one)');
    if (env.CLOUDFLARE_ACCOUNT_ID && env.CLOUDFLARE_ACCOUNT_ID !== accountId) throw new Error(`preview: CLOUDFLARE_ACCOUNT_ID is not the pool's account ${accountId}`);
  }
  out.CLOUDFLARE_ACCOUNT_ID = accountId;
  return out;
}

// Reading wrangler's output.

/** The JSON a wrangler command printed, between any banner lines before it and any notice after it. */
export function jsonOut(text) {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => l.startsWith('[') || l.startsWith('{'));
  if (start < 0) throw new Error('preview: wrangler printed no JSON');
  // The JSON ends at its last line that is only a closing bracket, or on its first line when it fits on one.
  let end = start;
  for (let i = start + 1; i < lines.length; i++) if (/^[\]}]\s*$/.test(lines[i])) end = i;
  return JSON.parse(lines.slice(start, end + 1).join('\n'));
}

/** The bucket names `wrangler r2 bucket list` printed. */
export const r2Names = (text) => [...text.matchAll(/^name:\s+(\S+)\s*$/gm)].map((m) => m[1]);

/** Whether wrangler said the Worker does not exist (code 10007). */
export const noSuchWorker = (text) => /\[code: 10007\]/.test(text);

/** The tag of the Worker a deploy made, from wrangler's ndjson output: 32 hex, or null. */
export function workerTag(ndjson) {
  for (const line of ndjson.split('\n')) {
    let e;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    if (e?.type === 'deploy' && /^[0-9a-f]{32}$/.test(e.worker_tag ?? '')) return e.worker_tag;
  }
  return null;
}
