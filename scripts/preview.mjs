#!/usr/bin/env node
// `pnpm preview`: a pool of fletch slots on Cloudflare, each the agent from a worktree on its own Worker, bucket, memory
// index and workers.dev host (docs/preview.md). `provision` and `deprovision` (scripts/preview-pool.mjs) make and delete
// the pool on Kyle's login, and are the only commands that create or delete a resource. Every other command works on a
// lease of one slot through a token that may deploy only the slot Workers: the slot's own Worker resets its bucket and
// index through its bindings (scripts/preview-slot/ops.mjs), and its placeholder's deploy wipes the agent's Durable
// Objects. Nothing prints a Cloudflare token; only `token` (scripts/preview-token.mjs) reads one, from .env.
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { authMode, CLOUD_HOSTS, DEFAULT_TTL_HOURS, freeSlot, gcReason, mintSecrets, origin, ownerTag, PREFIX, SECRETS, sha256Hex, slotPlan, tokenForm, wranglerEnv } from './preview-plan.mjs';
import { agentDir, CONFIG, account, deploySlot, deprovision, drainBucket, INVENTORY, knownSubdomain, needInventory, provision, readJson, tailOf, wranglerRunner, writeWhole } from './preview-pool.mjs';

/** The account a new pool is made on unless `provision --account` names another (D-0008); an inventory names its own. */
export const ACCOUNT_ID = '62b4c5143baaabf42b828a0d7a6b272e';

const USAGE = `usage: pnpm preview <command>
  up [--slot n] [--ttl hours] [--paid] [--var K=V]...   lease a slot (or renew this worktree's) and deploy the working tree to it; --var sets a model var (AI_GATEWAY_ID, CHAT_PROVIDER, CHAT_HEDGE)
  status                  this worktree's lease and what its slot answers
  tail                    wrangler tail on its slot's Worker
  down                    release its slot: placeholder (the agent's objects deleted), new secrets, bucket and index emptied
  gc [--dry-run] [--slot n] [--force]   release every slot whose lease expired or whose branch merged; --force (Kyle's login) one live lease
  list                    every slot and its lease
  doctor                  which credential is in use, whether the network takes it, each slot, the hosts to allow
  provision --slots N [--account id]   (Kyle's login) make the pool's slots, on this account for a new pool; idempotent
  deprovision [--slot n]  (Kyle's login) delete what the inventory records for one slot, or all
  token [--template id] [--group id] [--env-file path] [--admin-env NAME]   (Kyle's Mac) make or update the slot Workers' token`;

// Leases: through the slot Worker's /__preview/ ops, authorised by this worktree's key, kept in a git-ignored lease
// file in <git common dir>/fletch-previews/ with the slot's setup token.

export const leasePath = (ctx) => path.join(ctx.dir, `lease-${ownerTag(ctx.root)}.json`);
export const loadLease = (ctx) => readJson(leasePath(ctx));
export const saveLease = (ctx, lease) => writeWhole(leasePath(ctx), `${JSON.stringify(lease, null, 2)}\n`, 0o600);
export const dropLease = (ctx) => rmSync(leasePath(ctx), { force: true });

/** Slot `n` with its host: the subdomain must be known (FLETCH_PREVIEW_SUBDOMAIN, or provisioning on this machine). */
export function planOf(ctx, n) {
  const sub = knownSubdomain(ctx);
  if (!sub) throw new Error("preview: the account's workers.dev subdomain is not known here; set FLETCH_PREVIEW_SUBDOMAIN (docs/preview.md, Credentials)");
  return slotPlan(n, sub);
}

/** One op on a slot: `{status, body}`. A keyed call that gets 401 tries again: a key set seconds ago reaches the slot's locations unevenly. */
export async function op(ctx, plan, method, name, opts = {}) {
  for (let i = 0; ; i++) {
    const r = await opOnce(ctx, plan, method, name, opts);
    if (!(opts.key && r.status === 401 && i < 4)) return r;
    ctx.log(`preview: ${name} answered 401 (the key may not have reached every location yet); retrying in ${2 * (i + 1)} s`);
    await ctx.sleep(2000 * (i + 1));
  }
}

async function opOnce(ctx, plan, method, name, { key, tag, body } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (key) Object.assign(headers, { 'x-preview-tag': tag, 'x-preview-key': key });
  const r = await ctx.fetch(`${origin(plan)}/__preview/${name}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  try {
    return { status: r.status, body: JSON.parse(text) };
  } catch {
    return { status: r.status, body: { error: { code: 'not_json', message: text.slice(0, 200) } } };
  }
}

const must = (r, what) => {
  if (r.status !== 200) throw new Error(`preview: ${what} failed (${r.status}): ${r.body?.error?.message ?? JSON.stringify(r.body)}`);
  return r.body;
};

/** Waits until the slot's Worker accepts a key just set (a secret takes seconds to reach every location). */
async function keyAccepted(ctx, plan, auth) {
  for (let i = 0; i < 30; i++) {
    const r = await op(ctx, plan, 'GET', 'lease', auth);
    if (r.status === 200 && 'owner' in r.body) return true;
    await ctx.sleep(2000);
  }
  return false;
}

/** Empties the slot's bucket and index, as many calls as it takes: a deleted vector shows for seconds after. */
async function resetAll(ctx, plan, auth, body) {
  for (let i = 0; i < 120; i++) {
    if (must(await op(ctx, plan, 'POST', 'reset', { ...auth, body }), 'resetting the slot').done) return;
    await ctx.sleep(2000);
  }
  throw new Error('preview: the slot still had data after 120 reset calls');
}

/**
 * Gives the slot's Worker new secrets (a new lease's, or a released slot's), so nothing the last holder set carries over.
 * The session's key goes in the same write: a `secret bulk` builds on the Worker's latest version, which can lag a write
 * made seconds before, so a key set in its own write can vanish (qyvr, 2026-10-14). Returns the new setup token.
 */
async function rotate(ctx, plan, auth) {
  const values = mintSecrets(SECRETS);
  account(ctx.run).secrets(plan.worker, { ...values, [`PREVIEW_KEY_${auth.tag}`]: auth.key });
  if (!(await keyAccepted(ctx, plan, auth))) throw new Error(`preview: slot ${plan.n} stopped taking this session's key after its secrets rotated`);
  return values.SETUP_TOKEN;
}

/** Deletes every PREVIEW_KEY_* the slot's Worker holds: this session's, and any a crashed one left. */
function dropKeys(ctx, plan) {
  const acc = account(ctx.run);
  const keys = acc.secretNames(plan.worker).filter((n) => n.startsWith('PREVIEW_KEY_'));
  if (keys.length > 0) acc.secrets(plan.worker, Object.fromEntries(keys.map((k) => [k, null])));
}

const claimBody = (ctx, ttlHours) => ({ branch: ctx.branch, owner: ctx.owner, ttlSeconds: ttlHours * 3600 });

/** Claims a free slot for this worktree: its own key recorded, then set, then one claim; a lost race tries the next. */
async function claimSlot(ctx, inv, { slot: wanted, ttlHours }) {
  const tag = ownerTag(ctx.root);
  const leases = [];
  for (const n of wanted ? [wanted] : inv.slots.map((s) => s.n)) leases.push({ n, lease: (await op(ctx, planOf(ctx, n), 'GET', 'lease')).body });
  for (const { n, lease } of leases) {
    if (lease?.leased !== false) continue;
    const plan = planOf(ctx, n);
    const auth = { key: randomBytes(32).toString('hex'), tag };
    saveLease(ctx, { slot: n, ...auth, branch: ctx.branch, root: ctx.root, state: 'claiming' });
    account(ctx.run).secrets(plan.worker, { [`PREVIEW_KEY_${tag}`]: auth.key });
    const r = (await keyAccepted(ctx, plan, auth)) ? await op(ctx, plan, 'POST', 'claim', { ...auth, body: claimBody(ctx, ttlHours) }) : { status: 401 };
    if (r.status === 200) {
      saveLease(ctx, { slot: n, ...auth, branch: ctx.branch, root: ctx.root, state: 'held' });
      return { plan, auth, fresh: r.body.fresh };
    }
    ctx.log(`preview: slot ${n} went to another session; trying the next`);
    account(ctx.run).secrets(plan.worker, { [`PREVIEW_KEY_${tag}`]: null });
    dropLease(ctx);
  }
  if (wanted && freeSlot(leases) === undefined) throw new Error(`preview: slot ${wanted} is leased; \`pnpm preview list\` shows the leases`);
  throw new Error('preview: no slot is free; `pnpm preview list` shows the leases, and `pnpm preview gc` takes back merged and expired ones');
}

/** Waits until the slot serves deploy `id` and the agent answers /health for the slot's tenant. */
export async function waitReady(ctx, plan, id) {
  let last = '';
  for (let i = 0; i < 60; i++) {
    const r = await opOnce(ctx, plan, 'GET', 'lease').catch((e) => ({ status: 0, body: { error: { message: e.message } } }));
    last = `${r.status} ${JSON.stringify(r.body).slice(0, 120)}`;
    if (r.body?.deploy === id && r.body?.serving === 'app') {
      const h = await ctx.fetch(`${origin(plan)}/health`).then(async (x) => ({ status: x.status, body: await x.json().catch(() => null) }), (e) => ({ status: 0, body: e.message }));
      if (h.status === 200 && h.body?.tenant === plan.name) return;
      last = `/health ${h.status} ${JSON.stringify(h.body).slice(0, 120)}`;
    }
    await ctx.sleep(5000);
  }
  throw new Error(`preview: ${origin(plan)} did not serve this deploy within five minutes; last: ${last}`);
}

/**
 * Leases a slot for this worktree (or renews its lease) and deploys the working tree to it. A new lease first wipes what
 * the last left (the placeholder's deploy deletes the agent's objects; the ops empty the bucket and index) and gets new
 * secrets. Returns the plan and the setup token for the slot's first passkey.
 */
export async function up(ctx, { slot, ttlHours = DEFAULT_TTL_HOURS, paid = false, vars = {} } = {}) {
  const inv = needInventory(ctx);
  const held = loadLease(ctx);
  let claim;
  if (held?.state === 'held') {
    const plan = planOf(ctx, held.slot);
    const auth = { key: held.key, tag: held.tag };
    const r = await op(ctx, plan, 'POST', 'claim', { ...auth, body: claimBody(ctx, ttlHours) });
    if (r.status !== 200) {
      dropLease(ctx);
      throw new Error(`preview: this worktree's lease on slot ${held.slot} is gone (${r.status}); run \`pnpm preview up\` again for another`);
    }
    claim = { plan, auth, fresh: r.body.fresh };
  } else {
    if (held) dropLease(ctx);
    claim = await claimSlot(ctx, inv, { slot, ttlHours });
  }
  const { plan, auth } = claim;
  if (claim.fresh) {
    ctx.log(`preview: slot ${plan.n} is this worktree's; clearing what the last lease left`);
    deploySlot(ctx, inv, plan.n, { placeholder: true });
    await resetAll(ctx, plan, auth, { keepLease: true });
    const setupToken = await rotate(ctx, plan, auth);
    saveLease(ctx, { ...loadLease(ctx), setupToken });
  }
  const d = deploySlot(ctx, inv, plan.n, { paid, vars });
  await waitReady(ctx, plan, d.deploy);
  return { plan, setupToken: loadLease(ctx).setupToken };
}

/** Puts a slot back as provisioning left it: the placeholder (the agent's objects deleted), new secrets, its bucket and index emptied, its lease ended, its keys gone. */
async function release(ctx, inv, plan, auth, resetBody) {
  deploySlot(ctx, inv, plan.n, { placeholder: true });
  await rotate(ctx, plan, auth);
  await resetAll(ctx, plan, auth, resetBody);
  dropKeys(ctx, plan);
}

const dropConfig = (ctx) => rmSync(path.join(agentDir(ctx.root), CONFIG), { force: true });

/** Releases this worktree's slot. */
export async function down(ctx) {
  const inv = needInventory(ctx);
  const held = loadLease(ctx);
  if (!held) throw new Error('preview: this worktree holds no slot');
  const plan = planOf(ctx, held.slot);
  const auth = { key: held.key, tag: held.tag };
  // Renewed first: a lease that lapsed is still this worktree's to reset while nobody else has taken it.
  const r = await op(ctx, plan, 'POST', 'claim', { ...auth, body: { ...claimBody(ctx, 1), branch: held.branch ?? ctx.branch } });
  if (r.status === 401) {
    // The slot does not take this worktree's key. If its public lease is free, or another branch's, the lease is gone
    // (released by gc, or taken over), and so is the key. Only a lease read that succeeded can say so.
    const read = await op(ctx, plan, 'GET', 'lease');
    const pub = read.status === 200 ? read.body : null;
    if (pub && (!pub.leased || pub.branchHash !== sha256Hex(held.branch ?? ctx.branch))) {
      ctx.log(`preview: slot ${held.slot} is ${pub.leased ? "another branch's" : 'free'} now and does not take this worktree's key; this worktree's lease is gone`);
      dropLease(ctx);
      dropConfig(ctx);
      return plan;
    }
    // Still leased to this branch: the key may yet arrive, and the lease file keeps the only copy of it.
    throw new Error(`preview: slot ${held.slot} does not take this worktree's key (401); the lease file is kept, so run \`pnpm preview down\` again, or on Kyle's login \`pnpm preview gc --slot ${held.slot} --force\``);
  }
  if (r.status === 200) await release(ctx, inv, plan, auth, {});
  else ctx.log(`preview: slot ${held.slot} is no longer this worktree's (${r.status}); leaving it to its holder`);
  dropLease(ctx);
  dropConfig(ctx);
  return plan;
}

/**
 * The sha256 of each merged PR's head branch, by gh, one name a line with colour off (a shell that forces colour made
 * gh's JSON unparseable, 2026-10-22); empty, with a warning, when gh cannot say.
 */
export function mergedBranchHashes(root, log = console.error, spawn = spawnSync) {
  const env = { ...process.env, NO_COLOR: '1', CLICOLOR_FORCE: '0' };
  delete env.GH_FORCE_TTY;
  const r = spawn('gh', ['pr', 'list', '--state', 'merged', '--limit', '300', '--json', 'headRefName', '--jq', '.[].headRefName'], { cwd: root, encoding: 'utf8', env });
  const names = r.status === 0 ? r.stdout.split('\n').map((l) => l.trim()).filter(Boolean) : null;
  if (!names || names.some((n) => !/^[\w./-]+$/.test(n))) {
    log('preview: gh could not list merged PRs; judging by expiry only');
    return new Set();
  }
  return new Set(names.map(sha256Hex));
}

/** Releases every slot whose lease expired or whose branch merged; the lease is re-read, and the reset is conditional on it. */
export async function gc(ctx, { dryRun = false, slot: only, force = false } = {}) {
  if (force && (ctx.mode !== 'oauth' || !only)) throw new Error("preview: `gc --force` takes back one live lease (`--slot n`), on Kyle's login only");
  const inv = needInventory(ctx);
  const merged = ctx.mergedHashes();
  const now = Math.floor(ctx.now() / 1000);
  const tag = ownerTag(ctx.root);
  const failures = [];
  for (const s of inv.slots.filter((x) => !only || x.n === only)) {
    const plan = planOf(ctx, s.n);
    try {
      const lease = must(await op(ctx, plan, 'GET', 'lease'), `reading slot ${s.n}'s lease`);
      const reason = gcReason(lease, merged, now) ?? (force && lease.expiresAt ? 'forced (--force)' : null);
      if (!reason) {
        ctx.log(`preview: slot ${s.n}: ${lease.leased ? `leased until ${new Date(lease.expiresAt * 1000).toISOString()}` : 'free'}`);
        continue;
      }
      ctx.log(`preview: slot ${s.n}: ${dryRun ? 'would take back' : 'taking back'}: ${reason}`);
      if (dryRun) continue;
      const mine = loadLease(ctx);
      const auth = { key: mine?.slot === s.n ? mine.key : randomBytes(32).toString('hex'), tag };
      account(ctx.run).secrets(plan.worker, { [`PREVIEW_KEY_${tag}`]: auth.key });
      if (!(await keyAccepted(ctx, plan, auth))) throw new Error("the slot did not take gc's key");
      const full = must(await op(ctx, plan, 'GET', 'lease', auth), 'reading the lease');
      if (full.expiresAt !== lease.expiresAt || full.branchHash !== lease.branchHash) {
        ctx.log(`preview: slot ${s.n}: its lease changed meanwhile; leaving it`);
        continue;
      }
      await release(ctx, inv, plan, auth, { force: true, expectTag: full.tag });
      if (mine?.slot === s.n) dropLease(ctx);
    } catch (e) {
      failures.push(`slot ${s.n}: ${e.message}`);
      ctx.log(`preview: slot ${s.n}: FAILED: ${e.message}`);
    }
  }
  return failures;
}

/**
 * `curl` of Cloudflare's token check with no Authorization header and with the environment's: which one the network takes.
 * The token goes to curl on stdin, never on a command line, and is never printed.
 */
export function tokenChecks(accountId, env, curl = (args, input) => spawnSync('curl', args, { input, encoding: 'utf8' })) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/tokens/verify`;
  const base = ['-s', '-o', '/dev/null', '-w', '%{http_code}', '--max-time', '20'];
  const bare = curl([...base, url]);
  const withHeader = env.CLOUDFLARE_API_TOKEN ? curl([...base, '-K', '-', url], `header = "Authorization: Bearer ${env.CLOUDFLARE_API_TOKEN}"\n`) : null;
  const code = (r) => (r === null ? 'not tried (no CLOUDFLARE_API_TOKEN)' : r.status === 0 ? r.stdout.trim() : `curl failed: ${(r.stderr ?? '').trim()}`);
  return { url, bare: code(bare), header: code(withHeader) };
}

async function doctor(ctx, inv, accountId) {
  const log = ctx.log;
  log(`preview: credential: ${ctx.mode === 'token' ? 'CLOUDFLARE_API_TOKEN (token mode)' : "wrangler's own login (CLOUDFLARE_API_TOKEN and CLAUDE_CODE_OAUTH_TOKEN unset for it)"}`);
  log(`preview: account ${accountId}, pool ${inv ? `${inv.slots.length} slots` : 'not provisioned'}`);
  if (ctx.mode === 'token') {
    const t = tokenChecks(accountId, process.env);
    log(`preview: ${t.url}\n  with no Authorization header: ${t.bare}\n  with the environment's header: ${t.header}`);
    log('  200 with no header: the network attaches the token itself. 200 only with the header: it takes, or replaces, the one sent.');
  } else {
    const who = ctx.run(['whoami']);
    log(`preview: wrangler whoami: ${who.status === 0 ? 'logged in' : `FAILED\n${tailOf(who.out, 5)}`}`);
  }
  const sub = knownSubdomain(ctx);
  log(`preview: workers.dev subdomain: ${sub ?? 'NOT KNOWN: set FLETCH_PREVIEW_SUBDOMAIN'}`);
  if (sub) {
    for (const s of inv?.slots ?? []) {
      const plan = slotPlan(s.n, sub);
      const r = await opOnce(ctx, plan, 'GET', 'lease').catch((e) => ({ status: e.message, body: {} }));
      log(`preview: slot ${s.n} ${plan.host}: ${r.status}${r.body?.serving ? ` (${r.body.serving})` : ''}`);
    }
  }
  log('preview: hosts a cloud session must reach:');
  for (const [h, why] of [...CLOUD_HOSTS, [`${PREFIX}*.${sub ?? '<subdomain>'}.workers.dev`, 'the slots']]) log(`  ${h}  (${why})`);
}

/** git's answer, or null. */
const git = (cwd, args) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : null;
};

export function parseFlags(args) {
  const flags = {};
  const rest = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--var') flags.var = [...(flags.var ?? []), args[++i]];
    else if (['--account', '--slot', '--slots', '--ttl', '--template', '--group', '--admin-env', '--env-file'].includes(a)) flags[a.slice(2)] = args[++i];
    else if (a.startsWith('--')) flags[a.slice(2)] = true;
    else rest.push(a);
  }
  return { flags, rest };
}

/** `--var K=V` pairs as an object; a pair without `=` or with an empty key is refused. */
export function varFlags(pairs = []) {
  const out = {};
  for (const pair of pairs) {
    const i = (pair ?? '').indexOf('=');
    if (i < 1) throw new Error(`preview: --var takes K=V, not ${JSON.stringify(pair)}`);
    out[pair.slice(0, i)] = pair.slice(i + 1);
  }
  return out;
}

const intFlag = (v, what) => {
  if (v === undefined) return undefined;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1) throw new Error(`preview: --${what} takes a whole number`);
  return n;
};

async function main(argv) {
  const [command, ...args] = argv;
  const { flags, rest } = parseFlags(args);
  const top = git(process.cwd(), ['rev-parse', '--show-toplevel']);
  const common = git(process.cwd(), ['rev-parse', '--path-format=absolute', '--git-common-dir']);
  if (!top || !common) throw new Error('preview: run it inside the fletch repository');
  const root = realpathSync(top);
  const { experimental_readRawConfig } = createRequire(path.join(root, 'package.json'))('wrangler');
  const readRaw = (config) => experimental_readRawConfig({ config }).rawConfig;
  const mode = authMode(process.env);
  const inv = readJson(path.join(root, INVENTORY));
  if (flags.account !== undefined && (command !== 'provision' || inv?.accountId || !/^[0-9a-f]{32}$/.test(flags.account))) throw new Error('preview: --account <32 hex> names the account of a new pool, on `provision` only; an inventory keeps its own');
  const accountId = inv?.accountId ?? flags.account ?? ACCOUNT_ID;
  const env = wranglerEnv(process.env, mode, accountId);
  // getPlatformProxy (deprovision's bucket drain) runs in this process: on the login, it too must not see a token.
  if (mode === 'oauth') {
    delete process.env.CLOUDFLARE_API_TOKEN;
    delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
  }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const branch = git(root, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const ctx = {
    root,
    mode,
    env: process.env,
    accountId,
    dir: path.join(common, 'fletch-previews'),
    branch,
    owner: `${process.env.CLAUDE_CODE_REMOTE === 'true' ? 'cloud' : 'local'} ${path.basename(root)} ${branch}`,
    run: wranglerRunner(root, env),
    drain: (bucket) => drainBucket(root, accountId, bucket),
    mergedHashes: () => mergedBranchHashes(root),
    readRaw,
    write: (file, text) => writeFileSync(file, text, { mode: 0o600 }),
    fetch,
    sleep,
    now: Date.now,
    log: console.log,
  };
  const held = () => {
    const l = loadLease(ctx);
    needInventory(ctx);
    if (l?.state !== 'held') throw new Error('preview: this worktree holds no slot; `pnpm preview up` leases one');
    return { lease: l, plan: planOf(ctx, l.slot), auth: { key: l.key, tag: l.tag } };
  };
  const setupLink = (plan, token) => (token ? `${origin(plan)}/login?setup=${token}` : 'already used by this lease (or not kept)');
  if (command === 'up') {
    const vars = varFlags(flags.var);
    const { plan, setupToken } = await up(ctx, { slot: intFlag(flags.slot, 'slot'), ttlHours: intFlag(flags.ttl, 'ttl') ?? DEFAULT_TTL_HOURS, paid: flags.paid === true, vars });
    const model = Object.keys(vars).length ? `\n  model  ${Object.entries(vars).map(([k, v]) => `${k}=${v}`).join(' ')}` : '';
    console.log(`preview: slot ${plan.n} serves this worktree\n  app    ${origin(plan)}\n  setup  ${setupLink(plan, setupToken)}\n  owner  the fixture person, tenant ${plan.name}${model}\n  release it with \`pnpm preview down\` before this branch's PR merges`);
  } else if (command === 'status') {
    const { lease, plan, auth } = held();
    const full = (await op(ctx, plan, 'GET', 'lease', auth)).body;
    const health = await fetch(`${origin(plan)}/health`).then(async (r) => `${r.status} ${await r.text()}`, (e) => `no answer: ${e.message}`);
    const mine = full.tag === lease.tag && full.leased;
    console.log(`preview: slot ${lease.slot} (${lease.branch})\n  lease   ${mine ? `this worktree's until ${new Date(full.expiresAt * 1000).toISOString()}` : "NOT this worktree's any more"}\n  serving ${full.serving}\n  app     ${origin(plan)}: /health ${health}\n  setup   ${setupLink(plan, lease.setupToken)}`);
  } else if (command === 'tail') {
    const { plan } = held();
    process.exitCode = ctx.run(['tail', plan.worker, '--format', 'pretty', ...rest], { inherit: true }).status;
  } else if (command === 'down') {
    console.log(`preview: slot ${(await down(ctx)).n} released`);
  } else if (command === 'gc') {
    const failures = await gc(ctx, { dryRun: flags['dry-run'] === true, slot: intFlag(flags.slot, 'slot'), force: flags.force === true });
    if (failures.length > 0) throw new Error(`preview: gc left ${failures.length}:\n- ${failures.join('\n- ')}`);
  } else if (command === 'list') {
    const pool = needInventory(ctx);
    const mine = loadLease(ctx);
    for (const s of pool.slots) {
      const plan = planOf(ctx, s.n);
      const l = await op(ctx, plan, 'GET', 'lease').then(
        (r) => r.body,
        (e) => ({ error: { message: e.message } }),
      );
      const what = l.error ? `no answer: ${l.error.message}` : l.leased ? `leased until ${new Date(l.expiresAt * 1000).toISOString()}` : l.expiresAt ? 'expired, its data still there (gc takes it back)' : 'free';
      console.log(`slot ${s.n}  ${plan.host}  ${what}${mine?.slot === s.n ? '  (this worktree)' : ''}`);
    }
  } else if (command === 'doctor') {
    await doctor(ctx, inv, accountId);
  } else if (command === 'provision') {
    const slots = intFlag(flags.slots, 'slots');
    if (!slots) throw new Error('usage: pnpm preview provision --slots N');
    const pool = await provision(ctx, { slots });
    console.log(`preview: the pool has ${pool.slots.length} slots (${INVENTORY}); commit it. Then \`pnpm preview token\` adds any new Workers to the token (its value is unchanged), or by hand:\n${tokenForm(pool).join('\n')}`);
  } else if (command === 'deprovision') {
    const failures = await deprovision(ctx, { slot: intFlag(flags.slot, 'slot') });
    if (failures.length > 0) throw new Error(`preview: ${failures.length} left; the inventory keeps them for another run:\n- ${failures.join('\n- ')}`);
  } else if (command === 'token') {
    if (mode === 'token') throw new Error("preview: `token` runs on Kyle's Mac, with the admin token in qyvr's .env");
    const { ensureToken } = await import('./preview-token.mjs');
    await ensureToken({
      inv: needInventory(ctx),
      envFile: typeof flags['env-file'] === 'string' ? flags['env-file'] : path.join(homedir(), 'Development', 'qyvr', '.env'),
      fetchFn: fetch,
      log: console.log,
      sleep,
      adminEnv: typeof flags['admin-env'] === 'string' ? flags['admin-env'] : undefined,
      groupId: flags.group,
      templateId: flags.template,
    });
  } else {
    console.error(USAGE);
    process.exitCode = 2;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  });
}
