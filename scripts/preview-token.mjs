// `pnpm preview token` (Kyle's Mac): makes, or brings back into line, the account-owned token a cloud session's fletch
// previews run on: Workers Editor ("Individual Workers Editor") on exactly the pool's slot Workers, nothing else
// (docs/preview.md). It runs on an admin token read from qyvr's git-ignored .env (a token with Account > Account API
// Tokens > Edit, and nothing more), writes the new token's value to that .env, and never prints either value. Before it
// reports success it reads the stored policy back and tries the new token: it must read every slot Worker, and neither
// qyvr's production Workers nor the account's R2, Vectorize or D1. Ported from qyvr's scripts/preview-token.mjs, whose
// token (`qyvr-preview-slots`) this never touches.
//
// Cloudflare does not document the resource key for one Worker in a token policy. The key is the permission group's
// own scope and the Worker's tag (recorded in the inventory), under the account: that shape worked live for qyvr
// (2026-10-14) and for fletch's spike (2026-10-22). The other shapes and `--template <token id>` (a dashboard token for
// one slot Worker, whose key is copied with the Worker swapped) are fallbacks. A shape the API refuses creates nothing;
// one it takes but that fails the live check is deleted (only a token this run created).
import { readFileSync, writeFileSync } from 'node:fs';

export const TOKEN_NAME = 'fletch-preview-slots';
export const ADMIN_ENV = 'CF_TOKENS_ADMIN';
export const VALUE_ENV = 'FLETCH_PREVIEW_CLOUDFLARE_API_TOKEN';
/** Workers the new token must not reach: qyvr.dev production's. */
export const PRODUCTION_WORKERS = ['qyvr-dev', 'qyvr-identity'];
/** Account resources the new token must not list: a slot reaches its own only through its Worker's bindings. */
export const DENIED_PATHS = { r2: 'r2/buckets', vectorize: 'vectorize/v2/indexes', d1: 'd1/database' };
const API = 'https://api.cloudflare.com/client/v4';
const ACCOUNT_SCOPES = new Set(['com.cloudflare.api.account', 'com.cloudflare.api.account.zone', 'com.cloudflare.api.user']);

/** `NAME=value` lines; quotes around a value dropped. */
export function parseEnv(text) {
  const out = {};
  for (const line of text.split('\n')) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (m) out[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return out;
}

/** The text with `name` set to `value`: its line replaced, or one appended. */
export function setEnv(text, name, value) {
  const line = `${name}=${value}`;
  const re = new RegExp(`^${name}=.*$`, 'm');
  if (re.test(text)) return text.replace(re, () => line);
  return `${text}${text === '' || text.endsWith('\n') ? '' : '\n'}${line}\n`;
}

/** The slot Workers the inventory records: `{ name, tag }`, the tag being the id Cloudflare lists. */
export function slotWorkers(inv) {
  const workers = inv.slots.flatMap((s) => s.resources.filter((r) => r.kind === 'worker').map(({ name, tag }) => ({ name, tag })));
  if (workers.length === 0) throw new Error('preview token: the inventory records no slot Worker; run `pnpm preview provision --slots N` first');
  const missing = workers.filter((w) => !/^[0-9a-f]{32}$/.test(w.tag ?? '')).map((w) => w.name);
  if (missing.length > 0) throw new Error(`preview token: the inventory records no tag for ${missing.join(', ')}; add each Worker's id (the dashboard's, or the API's \`tag\`) as \`tag\``);
  return workers;
}

/** The one permission group that grants Workers Editor on a single Worker, and its per-Worker scope. */
export function editorGroup(groups, id) {
  const perWorker = (g) => (g.scopes ?? []).filter((s) => !ACCOUNT_SCOPES.has(s) && /worker/i.test(s));
  const hits = id ? groups.filter((g) => g.id === id) : groups.filter((g) => /editor/i.test(g.name) && perWorker(g).length > 0);
  if (hits.length === 1 && perWorker(hits[0]).length === 1) return { id: hits[0].id, name: hits[0].name, scope: perWorker(hits[0])[0] };
  const near = groups.filter((g) => /worker/i.test(g.name) || (g.scopes ?? []).some((s) => /worker/i.test(s)));
  throw new Error(
    `preview token: ${hits.length === 0 ? 'no' : 'more than one'} permission group grants Editor on one Worker; pass --group <id>. Candidates:\n` +
      near.map((g) => `  ${g.id}  ${g.name}  [${(g.scopes ?? []).join(', ')}]`).join('\n'),
  );
}

/** The resource shapes to try for the Workers, most likely first: each maps the Workers to policy resources. */
export function resourceShapes(scope, accountId) {
  const flat = (key) => (workers) => Object.fromEntries(workers.map((w) => [key(w), '*']));
  return [
    { label: `account { ${scope}.<tag> }`, resources: (ws) => ({ [`com.cloudflare.api.account.${accountId}`]: flat((w) => `${scope}.${w.tag}`)(ws) }) },
    { label: `${scope}.<tag>`, resources: flat((w) => `${scope}.${w.tag}`) },
    { label: `${scope}.<account>_<tag>`, resources: flat((w) => `${scope}.${accountId}_${w.tag}`) },
  ];
}

/** A shape copied from a token scoped to one slot Worker: every key naming that Worker, with the Worker swapped. */
export function shapeFromTemplate(template, workers) {
  const keys = (r, path = []) => Object.entries(r).flatMap(([k, v]) => (typeof v === 'string' ? [[...path, k]] : keys(v, [...path, k])));
  const all = template.policies.flatMap((p) => keys(p.resources));
  const ids = workers.flatMap((w) => [
    ['tag', w.tag],
    ['name', w.name],
  ]);
  const hit = ids.find(([, v]) => all.some((path) => path.at(-1).endsWith(v)));
  const leaf = hit && all.find((path) => path.at(-1).endsWith(hit[1]));
  if (!leaf) throw new Error(`preview token: the template token names none of ${workers.map((w) => w.name).join(', ')}`);
  const [field, value] = hit;
  const prefix = leaf.at(-1).slice(0, -value.length);
  return {
    label: `template ${template.id}: ${[...leaf.slice(0, -1), `${prefix}<${field}>`].join(' { ')}`,
    resources: (ws) => {
      const inner = Object.fromEntries(ws.map((w) => [`${prefix}${w[field]}`, '*']));
      return leaf.slice(0, -1).reduceRight((acc, k) => ({ [k]: acc }), inner);
    },
  };
}

const sortDeep = (v) => (typeof v === 'object' && v ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortDeep(v[k])])) : v);
/** Whether two resource maps are the same, nesting included. */
const sameResources = (a, b) => JSON.stringify(sortDeep(a)) === JSON.stringify(sortDeep(b));

/** A client for Cloudflare's API on one token. Errors carry the API's codes; the token is never in one. */
export function cfClient(fetchFn, token) {
  return async (method, path, body) => {
    const res = await fetchFn(`${API}/${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await res.json().catch(() => ({}));
    if (!json.success) {
      const e = new Error(`${method} ${path} -> ${res.status} ${(json.errors ?? []).map((x) => `${x.code} ${x.message}`).join('; ')}`);
      e.status = res.status;
      throw e;
    }
    return json.result;
  };
}

/**
 * What the new token reaches, as HTTP statuses: each slot Worker's settings (must be 200), and production's Workers and
 * the account's buckets, indexes and databases (must not be). A fresh token takes a few seconds to work everywhere, so a
 * slot check is retried.
 */
export async function liveCheck(fetchFn, accountId, token, names, { sleep, tries = 6 } = {}) {
  const status = async (path) => (await fetchFn(`${API}/accounts/${accountId}/${path}`, { headers: { authorization: `Bearer ${token}` } })).status;
  const slots = {};
  for (const n of names) {
    for (let i = 0; i < tries; i++) {
      slots[n] = await status(`workers/scripts/${n}/settings`);
      if (slots[n] === 200) break;
      await sleep(2000 * (i + 1));
    }
  }
  const denied = {};
  for (const n of PRODUCTION_WORKERS) denied[n] = await status(`workers/scripts/${n}/settings`);
  for (const [what, path] of Object.entries(DENIED_PATHS)) denied[what] = await status(path);
  const problems = [
    ...Object.entries(slots)
      .filter(([, s]) => s !== 200)
      .map(([n, s]) => `cannot read slot Worker ${n} (${s})`),
    ...Object.entries(denied)
      .filter(([, s]) => s === 200)
      .map(([n]) => `reaches ${n in DENIED_PATHS ? `the account's ${n}` : `production Worker ${n}`}`),
  ];
  return { slots, denied, problems };
}

/**
 * Makes or updates the token. `envFile` is qyvr's .env; `log` never sees a token value.
 * Returns what it did: `{ id, created, shape, check }`.
 */
export async function ensureToken({ inv, envFile, fetchFn, log, sleep, adminEnv = ADMIN_ENV, groupId, templateId, read = readFileSync, write = writeFileSync }) {
  const envText = read(envFile, 'utf8');
  const env = parseEnv(envText);
  const admin = env[adminEnv];
  if (!admin) {
    throw new Error(
      `preview token: no ${adminEnv} in ${envFile}. Make an account-owned token with only Account > Account API Tokens > Edit ` +
        `(Manage Account > Account API Tokens), add it there as ${adminEnv}=…, and run this again.`,
    );
  }
  const cf = cfClient(fetchFn, admin);
  const base = `accounts/${inv.accountId}/tokens`;
  const workers = slotWorkers(inv);
  const names = workers.map((w) => w.name);
  const group = editorGroup(await cf('GET', `${base}/permission_groups?per_page=1000`), groupId);
  log(`preview token: permission group ${group.name} (${group.id}), scope ${group.scope}`);
  const shapes = templateId ? [shapeFromTemplate(await cf('GET', `${base}/${templateId}`), workers)] : resourceShapes(group.scope, inv.accountId);
  const existing = (await cf('GET', `${base}?per_page=100`)).find((t) => t.name === TOKEN_NAME);
  if (existing && !env[VALUE_ENV]) {
    throw new Error(`preview token: ${TOKEN_NAME} (${existing.id}) exists but ${envFile} has no ${VALUE_ENV}; delete the token in the dashboard, or roll its value there and add it, then run this again`);
  }
  const failures = [];
  for (const shape of shapes) {
    const resources = shape.resources(workers);
    const body = { name: TOKEN_NAME, policies: [{ effect: 'allow', resources, permission_groups: [{ id: group.id }] }] };
    let id;
    let value;
    let created = false;
    try {
      if (existing) {
        await cf('PUT', `${base}/${existing.id}`, { ...body, status: 'active' });
        id = existing.id;
        value = env[VALUE_ENV];
      } else {
        ({ id, value } = await cf('POST', base, body));
        created = true;
      }
    } catch (e) {
      failures.push(`${shape.label}: refused (${e.message})`);
      continue;
    }
    const stored = await cf('GET', `${base}/${id}`);
    const policy = stored.policies.length === 1 ? stored.policies[0] : null;
    const exact = policy && policy.effect === 'allow' && sameResources(policy.resources, resources) && policy.permission_groups.length === 1 && policy.permission_groups[0].id === group.id;
    const check = exact ? await liveCheck(fetchFn, inv.accountId, value, names, { sleep }) : { problems: ['the stored policy is not the one sent'] };
    if (check.problems.length === 0) {
      if (created) write(envFile, setEnv(envText, VALUE_ENV, value));
      log(`preview token: ${created ? 'created' : 'updated'} ${TOKEN_NAME} (${id}), resources ${shape.label}`);
      log(`preview token: reads ${names.join(', ')}; refused on ${Object.entries(check.denied).map(([n, s]) => `${n} (${s})`).join(', ')}`);
      log(created ? `preview token: its value is ${VALUE_ENV} in ${envFile}` : `preview token: its value is unchanged (${VALUE_ENV})`);
      return { id, created, shape: shape.label, check };
    }
    failures.push(`${shape.label}: ${check.problems.join('; ')}`);
    if (created) await cf('DELETE', `${base}/${id}`);
  }
  throw new Error(`preview token: no resource shape worked (nothing kept):\n- ${failures.join('\n- ')}\nMake a token in the dashboard for one slot Worker (Specified Workers, Editor) and pass --template <its id>.`);
}
