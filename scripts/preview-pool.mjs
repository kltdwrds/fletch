// The pool side of `pnpm preview` (docs/preview.md): running wrangler, the account as wrangler shows it, the committed
// inventory, deploying a slot's Worker, and `provision` and `deprovision`, which run on Kyle's wrangler login and are
// the only commands that make or delete a Cloudflare resource. The leases are scripts/preview.mjs; the names, configs
// and the deletion guard are scripts/preview-plan.mjs. Ported from qyvr's scripts/preview.mjs.
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  assertDeletable,
  baseNames,
  configText,
  dataResources,
  deletionOrder,
  entryOf,
  forget,
  isPreviewName,
  jsonOut,
  MEMORY_INDEX,
  newInventory,
  newSlot,
  noSuchWorker,
  r2Names,
  record,
  slotConfig,
  slotOf,
  slotPlan,
  subdomainIn,
  withoutSlot,
  withSlot,
  workerTag,
} from './preview-plan.mjs';

/** The generated config's name, beside the agent's wrangler.jsonc (git-ignored). */
export const CONFIG = 'wrangler.preview.jsonc';
/** The pool's inventory, committed: names, ids and Worker tags, never a secret and never the workers.dev subdomain. */
export const INVENTORY = path.join('scripts', 'preview-pool.json');
export const agentDir = (root) => path.join(root, 'packages', 'agent');

/** The last lines of a command's output: enough to say why it failed. */
export const tailOf = (out, n = 25) => out.trimEnd().split('\n').slice(-n).join('\n');

/** Runs the checkout's wrangler: `{status, out}`, or the status alone when `inherit` streams it to the terminal. */
export function wranglerRunner(root, env) {
  const bin = path.join(root, 'node_modules', '.bin', 'wrangler');
  if (!existsSync(bin)) throw new Error('preview: wrangler is not installed here; run `pnpm install` first');
  return (args, { cwd = root, input, inherit = false, extraEnv = {} } = {}) => {
    const r = spawnSync(bin, args, { cwd, env: { ...env, ...extraEnv }, input, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: inherit ? ['pipe', 'inherit', 'inherit'] : 'pipe' });
    if (r.error) throw new Error(`preview: could not run wrangler: ${r.error.message}`);
    return { status: r.status ?? 1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
  };
}

/** The account as wrangler sees it, over a runner. Only provisioning lists, makes and deletes. */
export function account(run) {
  const ok = (r, what) => {
    if (r.status !== 0) throw new Error(`preview: ${what} failed:\n${tailOf(r.out)}`);
    return r.out;
  };
  return {
    ok,
    listed() {
      return {
        r2: r2Names(ok(run(['r2', 'bucket', 'list']), 'listing R2 buckets')),
        vectorize: jsonOut(ok(run(['vectorize', 'list', '--json']), 'listing Vectorize indexes')).map((i) => i.name),
      };
    },
    has: (listed, kind, name) => listed[kind].includes(name),
    workerExists(name) {
      const r = run(['deployments', 'list', '--name', name, '--json']);
      if (r.status === 0) return true;
      if (noSuchWorker(r.out)) return false;
      throw new Error(`preview: could not tell whether Worker ${name} exists:\n${tailOf(r.out)}`);
    },
    create(kind, name) {
      if (!isPreviewName(name)) throw new Error(`preview: refusing to make ${name}: not a preview's name`);
      if (kind === 'r2') ok(run(['r2', 'bucket', 'create', name]), `making R2 ${name}`);
      else if (kind === 'vectorize') ok(run(['vectorize', 'create', name, '--dimensions', String(MEMORY_INDEX.dimensions), '--metric', MEMORY_INDEX.metric]), `making Vectorize ${name}`);
      else throw new Error(`preview: no such kind ${kind}`);
    },
    /** A Worker's secrets set (a value) or deleted (null), on stdin, never printed. */
    secrets(worker, values) {
      if (!isPreviewName(worker)) throw new Error(`preview: refusing to touch ${worker}'s secrets: not a preview's`);
      ok(run(['secret', 'bulk', '--name', worker], { input: JSON.stringify(values) }), `setting ${worker}'s secrets`);
    },
    secretNames(worker) {
      return jsonOut(ok(run(['secret', 'list', '--name', worker, '--format', 'json']), `listing ${worker}'s secrets`)).map((s) => s.name);
    },
  };
}

// Files: the inventory (committed) and, in <git common dir>/fletch-previews/ (git-ignored), each worktree's lease (it
// holds the key) and the workers.dev subdomain. Each is written whole through a rename, so a crash never leaves half.

export function writeWhole(file, text, mode = 0o644) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(`${file}.tmp`, text, { mode });
  renameSync(`${file}.tmp`, file);
}

export const readJson = (file) => (existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null);
export const loadInventory = (ctx) => readJson(path.join(ctx.root, INVENTORY));
export const saveInventory = (ctx, inv) => writeWhole(path.join(ctx.root, INVENTORY), `${JSON.stringify(inv, null, 2)}\n`);
export function needInventory(ctx) {
  const inv = loadInventory(ctx);
  if (!inv || inv.slots.length === 0) throw new Error(`preview: there is no pool yet (${INVENTORY}); Kyle makes it once with \`pnpm preview provision --slots N\``);
  return inv;
}

/** The account's workers.dev subdomain: FLETCH_PREVIEW_SUBDOMAIN, else what provisioning recorded on this machine, else null. */
export const subdomainFile = (ctx) => path.join(ctx.dir, 'subdomain');
export function knownSubdomain(ctx) {
  if (ctx.env?.FLETCH_PREVIEW_SUBDOMAIN) return ctx.env.FLETCH_PREVIEW_SUBDOMAIN;
  return existsSync(subdomainFile(ctx)) ? readFileSync(subdomainFile(ctx), 'utf8').trim() || null : null;
}

/**
 * Deploys slot `n`'s Worker: the placeholder (which wipes the agent's objects) or the agent. Returns the Worker's tag
 * (the id a token policy names it by, from wrangler's output file; none on the deploy that makes the Worker), the
 * deploy's id, which the slot echoes once it serves this deploy, and the workers.dev subdomain wrangler printed.
 */
export function deploySlot(ctx, inv, n, { placeholder = false, paid = false } = {}) {
  const plan = slotPlan(n);
  const deploy = randomBytes(8).toString('hex');
  const dir = agentDir(ctx.root);
  ctx.write(path.join(dir, CONFIG), configText(slotConfig(ctx.readRaw(path.join(dir, 'wrangler.jsonc')), plan, { accountId: inv.accountId, placeholder, deploy, paid })));
  ctx.log(`preview: deploying ${plan.worker} (${placeholder ? 'placeholder' : 'this worktree'})`);
  const tmp = mkdtempSync(path.join(tmpdir(), 'fletch-preview-deploy-'));
  const out = path.join(tmp, 'out.ndjson');
  try {
    const r = ctx.run(['deploy', '-c', CONFIG], { cwd: dir, extraEnv: { WRANGLER_OUTPUT_FILE_PATH: out } });
    account(ctx.run).ok(r, `deploying ${plan.worker}`);
    return { tag: workerTag(existsSync(out) ? readFileSync(out, 'utf8') : ''), deploy, subdomain: subdomainIn(r.out, plan.worker) };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/** Whether a resource exists on the account but the inventory does not record it: someone else's, never touched. */
function refuseStranger(slot, kind, name) {
  if (!entryOf(slot, kind, name)) throw new Error(`preview: ${kind} ${name} exists on the account but the inventory does not record it; not touching it`);
}

/**
 * Makes the pool's slots 1…`slots` on Kyle's login: each slot's bucket and index (recorded before each is made, adopted
 * if a crash left it), then its placeholder Worker on workers.dev. A slot whose Worker exists is left as it is: it may be
 * leased. Records each Worker's tag, and keeps the workers.dev subdomain on this machine only.
 */
export async function provision(ctx, { slots }) {
  if (ctx.mode !== 'oauth') throw new Error("preview: provision runs on Kyle's wrangler login, never on a token");
  const raw = ctx.readRaw(path.join(agentDir(ctx.root), 'wrangler.jsonc'));
  let inv = loadInventory(ctx) ?? newInventory({ accountId: ctx.accountId });
  const taken = baseNames(raw);
  const acc = account(ctx.run);
  let listed = acc.listed();
  for (let n = 1; n <= slots; n++) {
    const plan = slotPlan(n);
    const clash = [plan.worker, ...dataResources(plan).map((r) => r.name)].filter((x) => taken.has(x));
    if (clash.length > 0) throw new Error(`preview: slot ${n} would take the base config's ${clash.join(', ')}`);
    let slot = slotOf(inv, n) ?? newSlot(plan);
    const save = (s) => {
      slot = s;
      inv = withSlot(inv, s);
      saveInventory(ctx, inv);
    };
    for (const r of dataResources(plan)) {
      if (acc.has(listed, r.kind, r.name)) refuseStranger(slot, r.kind, r.name);
      save(record(slot, r));
      if (!acc.has(listed, r.kind, r.name)) {
        ctx.log(`preview: making ${r.kind} ${r.name}`);
        acc.create(r.kind, r.name);
        listed = acc.listed();
      }
      if (!acc.has(listed, r.kind, r.name)) throw new Error(`preview: ${r.kind} ${r.name} was made but the account does not list it`);
      save(record(slot, { kind: r.kind, name: r.name, created: true }));
    }
    const exists = acc.workerExists(plan.worker);
    if (exists) refuseStranger(slot, 'worker', plan.worker);
    if (exists && entryOf(slot, 'worker', plan.worker).created) continue;
    save(record(slot, { kind: 'worker', name: plan.worker }));
    // Wrangler reads a Worker's tag before uploading, so the deploy that makes it reports none; a second deploy does.
    let d = deploySlot(ctx, inv, n, { placeholder: true });
    if (!d.tag) d = deploySlot(ctx, inv, n, { placeholder: true });
    save(record(slot, { kind: 'worker', name: plan.worker, created: true, ...(d.tag ? { tag: d.tag } : {}) }));
    if (!d.tag) ctx.log(`preview: WARNING: wrangler gave no tag for ${plan.worker}; record its id as \`tag\` in ${INVENTORY} before \`pnpm preview token\``);
    if (d.subdomain && knownSubdomain(ctx) !== d.subdomain) {
      if (ctx.env?.FLETCH_PREVIEW_SUBDOMAIN) throw new Error(`preview: FLETCH_PREVIEW_SUBDOMAIN is not the account's workers.dev subdomain, which wrangler printed for ${plan.worker}`);
      writeWhole(subdomainFile(ctx), `${d.subdomain}\n`, 0o600);
    }
  }
  return inv;
}

/**
 * Deletes one inventory entry's resource and verifies it gone by listing again. A resource already gone is done. A
 * bucket is emptied first: R2 refuses to delete one with objects in it.
 */
export async function removeOne(ctx, r) {
  if (!isPreviewName(r.name)) throw new Error(`preview: refusing to delete ${r.kind} ${r.name}: not a preview's name`);
  const acc = account(ctx.run);
  if (r.kind === 'worker') {
    if (!acc.workerExists(r.name)) return 'already gone';
    acc.ok(ctx.run(['delete', '--name', r.name, '--force']), `deleting Worker ${r.name}`);
    if (acc.workerExists(r.name)) throw new Error(`preview: Worker ${r.name} is still there after deleting it`);
    return 'deleted';
  }
  if (!acc.has(acc.listed(), r.kind, r.name)) return 'already gone';
  let said = 'deleted';
  if (r.kind === 'r2') {
    said = `deleted (${await ctx.drain(r.name)} objects emptied first)`;
    acc.ok(ctx.run(['r2', 'bucket', 'delete', r.name]), `deleting R2 ${r.name}`);
  } else if (r.kind === 'vectorize') {
    acc.ok(ctx.run(['vectorize', 'delete', r.name, '--force']), `deleting Vectorize ${r.name}`);
  } else throw new Error(`preview: no such kind ${r.kind}`);
  if (acc.has(acc.listed(), r.kind, r.name)) throw new Error(`preview: ${r.kind} ${r.name} is still there after deleting it`);
  return said;
}

/** Deletes what the inventory records for slot `n` (or every slot), on Kyle's login, after the guard. Returns the failures. */
export async function deprovision(ctx, { slot: only } = {}) {
  if (ctx.mode !== 'oauth') throw new Error("preview: deprovision runs on Kyle's wrangler login, never on a token");
  let inv = needInventory(ctx);
  const targets = inv.slots.filter((s) => only === undefined || s.n === only);
  if (targets.length === 0) throw new Error(`preview: the inventory has no slot ${only}`);
  for (const s of targets) assertDeletable(s);
  const failures = [];
  for (let slot of targets) {
    for (const r of deletionOrder(slot.resources)) {
      try {
        ctx.log(`preview: ${r.kind} ${r.name}: ${await removeOne(ctx, r)}`);
        slot = forget(slot, r.kind, r.name);
        inv = slot.resources.length === 0 ? withoutSlot(inv, slot.n) : withSlot(inv, slot);
        saveInventory(ctx, inv);
      } catch (e) {
        failures.push(`${r.kind} ${r.name}: ${e.message}`);
        ctx.log(`preview: ${r.kind} ${r.name}: FAILED: ${e.message}`);
      }
    }
  }
  return failures;
}

/** Empties a bucket through a wrangler remote binding (`getPlatformProxy`), on Kyle's login. Returns how many objects went. */
export async function drainBucket(root, accountId, bucket) {
  if (!isPreviewName(bucket)) throw new Error(`preview: refusing to empty ${bucket}: not a preview's name`);
  const dir = mkdtempSync(path.join(tmpdir(), 'fletch-preview-drain-'));
  try {
    const configPath = path.join(dir, 'wrangler.json');
    writeFileSync(configPath, JSON.stringify({ name: `${bucket}-drain`, compatibility_date: '2026-10-01', account_id: accountId, r2_buckets: [{ binding: 'B', bucket_name: bucket, remote: true }] }));
    const { getPlatformProxy } = createRequire(path.join(root, 'package.json'))('wrangler');
    const proxy = await getPlatformProxy({ configPath, persist: false });
    try {
      let n = 0;
      for (;;) {
        const page = await proxy.env.B.list({ limit: 1000 });
        if (page.objects.length === 0) return n;
        await proxy.env.B.delete(page.objects.map((o) => o.key));
        n += page.objects.length;
      }
    } finally {
      await proxy.dispose();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
