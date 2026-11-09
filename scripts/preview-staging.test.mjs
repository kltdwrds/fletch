import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { down, gc, loadLease, up } from './preview.mjs';
import { fakeAccount, fakeSlot, fakeSlotsFetch } from './preview-fakes.mjs';
import { leaseLabel, SECRETS, sha256Hex, slotPlan, stagingSlots } from './preview-plan.mjs';
import { loadInventory, provision, saveInventory } from './preview-pool.mjs';
import { convert, deployStaging, LEASE_CODE_READS, LEASE_CODE_WAIT_MS, stagingSlot, unstage } from './preview-staging.mjs';

// The staging slot (scripts/preview-staging.mjs) against the fakes of scripts/preview-fakes.mjs: converting slot 1 in
// place keeps its data and secrets, a staging deploy never rotates them, and no lease command takes, releases or wipes it.
const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const { experimental_readRawConfig } = createRequire(path.join(REPO, 'package.json'))('wrangler');
const readRaw = () => experimental_readRawConfig({ config: path.join(REPO, 'packages', 'agent', 'wrangler.jsonc') }).rawConfig;
const SUB = 'example-sub';

let repo;
let acct;
let slots;
let clock;
let admin;
let merged;

function worktree(name, extra = {}) {
  const root = path.join(repo, 'worktrees', name);
  mkdirSync(path.join(root, 'scripts'), { recursive: true });
  const byHost = new Map([...slots.values()].map((s) => [s.host, s]));
  const ctx = {
    root,
    mode: 'oauth',
    env: { FLETCH_PREVIEW_SUBDOMAIN: SUB },
    accountId: 'a'.repeat(32),
    dir: path.join(repo, 'git-common', 'fletch-previews'),
    branch: `claude/${name}`,
    owner: `test ${name}`,
    treeClean: () => true,
    run: acct.run,
    drain: acct.drain,
    mergedHashes: () => merged,
    readRaw,
    write: (file, text) => acct.configs.set(file, text),
    fetch: fakeSlotsFetch(byHost, (host) => acct.secrets.get(host.split('.')[0]) ?? {}, clock),
    sleep: async () => {},
    now: () => clock.t * 1000,
    log: () => {},
    ...extra,
  };
  if (admin) saveInventory(ctx, loadInventory(admin));
  return ctx;
}

/** Slot 1 marked staging in the committed inventory, as this change commits it. */
const markStaging = () => {
  const inv = loadInventory(admin);
  saveInventory(admin, { ...inv, slots: inv.slots.map((s) => (s.n === 1 ? { ...s, staging: true } : s)) });
};
const main = (extra = {}) => worktree('main', { branch: 'main', ...extra });
const slot1 = () => slots.get('fletch-pv-1');
const lease = async (ctx, n) => (await ctx.fetch(`https://${slotPlan(n, SUB).host}/__preview/lease`)).json();
const deploys = () => acct.deployed.map((d) => `${d.name} ${d.config.vars.PREVIEW_SERVING}`);
/** Kyle's workspace on slot 1: an agent object, a file and a memory. */
const use = () => {
  slot1().objects.set('Person:kyle', 'passkey and workspace');
  slot1().AGENT_BUCKET.map.set('files/a', 'x');
  slot1().MEMORY_INDEX.map.set('v1', { namespace: 'person' });
};
const intact = () => slot1().objects.size === 1 && slot1().AGENT_BUCKET.map.size === 1 && slot1().MEMORY_INDEX.map.size === 1;
const rejectsWith = (p, code) => assert.rejects(p, (e) => e.code === code || assert.fail(`expected ${code}, got ${e.code}: ${e.message}`));

/** Slot 1 as it is today: leased by a branch that has since merged, holding Kyle's data. Returns that worktree. */
async function heldByMergedBranch() {
  const old = worktree('ledgers-night-end-2');
  await up(old, { slot: 1 });
  use();
  merged = new Set([sha256Hex('claude/ledgers-night-end-2')]);
  markStaging();
  saveInventory(old, loadInventory(admin));
  return old;
}

beforeEach(async () => {
  repo = mkdtempSync(path.join(tmpdir(), 'fletch-staging-test-'));
  slots = new Map([1, 2, 3].map((n) => [`fletch-pv-${n}`, fakeSlot(slotPlan(n, SUB).host)]));
  acct = fakeAccount({ subdomain: SUB, slotsByWorker: slots });
  clock = { t: 1_000_000, now: () => clock.t };
  admin = undefined;
  merged = new Set();
  const a = worktree('admin', { env: {} });
  await provision(a, { slots: 3 });
  admin = a;
});

afterEach(() => rmSync(repo, { recursive: true, force: true }));

describe('staging: the inventory', () => {
  it('the committed inventory marks slot 1, and only slot 1, staging', () => {
    const inv = loadInventory({ root: REPO });
    assert.deepEqual(stagingSlots(inv), [1]);
    assert.equal(stagingSlot(inv), 1);
  });

  it('refuses an inventory marking no slot, or two', () => {
    const inv = loadInventory(admin);
    assert.throws(() => stagingSlot(inv), { code: 'PREVIEW_STAGING_NONE' });
    assert.throws(() => stagingSlot({ ...inv, slots: inv.slots.map((s) => ({ ...s, staging: true })) }), { code: 'PREVIEW_STAGING_NONE' });
  });
});

describe('staging: converting slot 1 in place', () => {
  it("takes over the merged branch's lease and keeps the data, MASTER_KEY and SETUP_TOKEN; no placeholder, no reset, no key left", async () => {
    await heldByMergedBranch();
    const secrets = { ...acct.secrets.get('fletch-pv-1') };
    const before = deploys().length;
    const r = await convert(main());
    assert.equal(r.setupToken, null, 'a slot in use keeps its setup token');
    assert.ok(intact(), "Kyle's objects, files and memories are still there");
    const after = acct.secrets.get('fletch-pv-1');
    for (const k of SECRETS) assert.equal(after[k], secrets[k], `${k} is kept`);
    assert.deepEqual(Object.keys(after).sort(), [...SECRETS].sort(), 'every PREVIEW_KEY_* is gone');
    assert.deepEqual(deploys().slice(before), ['fletch-pv-1 app'], 'one deploy of main, never the placeholder');
    const l = await lease(main(), 1);
    assert.equal(l.staging, true);
    assert.equal(l.leased, true);
    assert.equal(l.branchHash, null);
  });

  it('refuses a token, a branch other than main, and a checkout with changes; a second run changes nothing', async () => {
    await heldByMergedBranch();
    await rejectsWith(convert(main({ mode: 'token' })), 'PREVIEW_STAGING_LOGIN');
    await rejectsWith(convert(main({ branch: 'claude/x' })), 'PREVIEW_STAGING_NOT_MAIN');
    await rejectsWith(convert(main({ treeClean: () => false })), 'PREVIEW_STAGING_DIRTY');
    assert.equal((await lease(main(), 1)).staging, undefined, 'nothing was converted');
    await convert(main());
    const calls = acct.calls.length;
    assert.equal((await convert(main())).already, true);
    assert.deepEqual(acct.calls.slice(calls), []);
  });

  it('a free slot (secrets rotated by its release) gets a new SETUP_TOKEN and keeps its MASTER_KEY', async () => {
    markStaging();
    const before = { ...acct.secrets.get('fletch-pv-1') };
    const { setupToken } = await convert(main());
    assert.ok(setupToken);
    assert.equal(acct.secrets.get('fletch-pv-1').SETUP_TOKEN, setupToken);
    assert.equal(acct.secrets.get('fletch-pv-1').MASTER_KEY, before.MASTER_KEY);
  });
});

/**
 * Slot 1's lease object as Cloudflare ran it on the first live conversion: still on the code from before the deploy
 * (no deploy id, and `stage` answering 500 as a missing RPC method does) for the first `stale` lease reads after the
 * next deploy.
 */
function laggingLeaseObject(stale) {
  let reads = 0;
  let lagging = false;
  const s = slot1();
  const was = s.vars.PREVIEW_DEPLOY;
  s.leaseCode = () => {
    if (s.vars.PREVIEW_DEPLOY === was) return was;
    reads++;
    lagging = reads <= stale;
    return lagging ? null : s.vars.PREVIEW_DEPLOY;
  };
  const stage = s.lease.stage;
  s.lease.stage = async (...a) => {
    if (lagging) throw new Error('500: the lease object has no stage method');
    return stage(...a);
  };
  return { reads: () => reads };
}

describe('staging: convert waits for the lease object to run the new deploy', () => {
  it('reads the lease until its object runs the deploy wrangler made, then marks it staging; no sleep but the injected one', async () => {
    await heldByMergedBranch();
    const lag = laggingLeaseObject(3);
    const slept = [];
    const lines = [];
    await convert(main({ sleep: async (ms) => slept.push(ms), log: (l) => lines.push(l) }));
    const deploy = slot1().vars.PREVIEW_DEPLOY;
    assert.equal((await lease(main(), 1)).staging, true);
    // waitReady's own lease read is the first stale one; the wait reads the other two, then the fresh one.
    assert.ok(lag.reads() > 3, 'the object ran the new deploy only after three stale reads');
    assert.deepEqual(slept, [LEASE_CODE_WAIT_MS, LEASE_CODE_WAIT_MS], 'one wait after each stale read');
    assert.equal(lines.filter((l) => l.includes(`waiting for its lease object to run deploy ${deploy} (read`) && l.includes('code that names no deploy')).length, 2, lines.join('\n'));
    assert.ok(lines.some((l) => l.includes(`runs deploy ${deploy} (read 3 of at most ${LEASE_CODE_READS})`)), lines.join('\n'));
    assert.ok(intact());
  });

  it('refuses with PREVIEW_DEPLOY_NOT_SERVING when the object never runs it: no key set, the lease not marked, the data kept', async () => {
    await heldByMergedBranch();
    laggingLeaseObject(Number.POSITIVE_INFINITY);
    const secrets = { ...acct.secrets.get('fletch-pv-1') };
    const slept = [];
    const err = await convert(main({ sleep: async (ms) => slept.push(ms) })).catch((e) => e);
    assert.equal(err.code, 'PREVIEW_DEPLOY_NOT_SERVING', err.message);
    const deploy = slot1().vars.PREVIEW_DEPLOY;
    assert.match(err.message, new RegExp(`did not run deploy ${deploy} after ${LEASE_CODE_READS} reads`));
    assert.match(err.message, /code that names no deploy/);
    assert.equal(slept.length, LEASE_CODE_READS - 1, 'bounded: no wait after the last read');
    assert.deepEqual(acct.secrets.get('fletch-pv-1'), secrets, 'no PREVIEW_KEY_* was set, nothing rotated');
    assert.equal((await lease(main(), 1)).staging, undefined);
    assert.ok(intact());
  });

  it('a lease read reports the deploy its object runs, apart from the one the Worker serves', async () => {
    await heldByMergedBranch();
    slot1().leaseCode = () => 'older';
    const l = await lease(main(), 1);
    assert.equal(l.leaseDeploy, 'older');
    assert.notEqual(l.deploy, 'older');
  });
});

describe('staging: the deploy on merge', () => {
  it('refuses a slot whose lease is not staging yet, deploying nothing', async () => {
    await heldByMergedBranch();
    const before = deploys().length;
    await rejectsWith(deployStaging(main({ mode: 'token' })), 'PREVIEW_STAGING_NOT_CONVERTED');
    assert.equal(deploys().length, before);
  });

  it('redeploys main on the token, never rotating MASTER_KEY or SETUP_TOKEN, wiping nothing, touching no other slot', async () => {
    await heldByMergedBranch();
    await convert(main());
    const secrets = { ...acct.secrets.get('fletch-pv-1') };
    const calls = acct.calls.length;
    const { plan } = await deployStaging(main({ mode: 'token' }));
    assert.equal(plan.n, 1);
    assert.deepEqual(acct.secrets.get('fletch-pv-1'), secrets);
    assert.ok(intact());
    const made = acct.calls.slice(calls);
    assert.ok(!made.some((c) => c.startsWith('secret')), made.join('\n'));
    assert.equal(made.filter((c) => c.startsWith('deploy')).length, 1);
    assert.deepEqual(acct.deployed.at(-1).name, 'fletch-pv-1');
    assert.equal(acct.deployed.at(-1).config.vars.PREVIEW_SERVING, 'app');
  });

  it('takes a detached HEAD at origin/main (a worktree or cloud session), and refuses one at any other commit or unfetched', async () => {
    const AT = 'c'.repeat(40);
    const detached = (head, originMain, extra = {}) => main({ branch: 'HEAD', headCommit: () => head, originMainCommit: () => originMain, ...extra });
    await heldByMergedBranch();
    await rejectsWith(convert(detached('d'.repeat(40), AT)), 'PREVIEW_STAGING_NOT_MAIN');
    await rejectsWith(convert(detached(AT, null)), 'PREVIEW_STAGING_NOT_MAIN');
    await assert.rejects(convert(detached('d'.repeat(40), AT)), /detached at d+, not at origin\/main/);
    await rejectsWith(convert(detached(AT, AT, { treeClean: () => false })), 'PREVIEW_STAGING_DIRTY');
    assert.equal((await lease(main(), 1)).staging, undefined, 'nothing was converted');
    await convert(detached(AT, AT));
    assert.equal((await lease(main(), 1)).staging, true);
    const before = deploys().length;
    await rejectsWith(deployStaging(detached('d'.repeat(40), AT, { mode: 'token' })), 'PREVIEW_STAGING_NOT_MAIN');
    assert.equal(deploys().length, before);
    await deployStaging(detached(AT, AT, { mode: 'token' }));
    assert.equal(deploys().length, before + 1);
    assert.ok(intact());
  });

  it('refuses a branch other than main and a checkout with changes', async () => {
    await heldByMergedBranch();
    await convert(main());
    await rejectsWith(deployStaging(main({ branch: 'claude/x' })), 'PREVIEW_STAGING_NOT_MAIN');
    await rejectsWith(deployStaging(main({ treeClean: () => false })), 'PREVIEW_STAGING_DIRTY');
  });
});

describe('staging: the lease commands leave it alone', () => {
  it('gc never releases it: not when its old branch merged, not past any expiry, and --force is refused', async () => {
    await heldByMergedBranch();
    const g = worktree('gc');
    assert.deepEqual(await gc(g), [], 'skipped by the inventory mark even before the conversion');
    assert.ok(intact());
    await convert(main());
    clock.t += 365 * 86400;
    assert.deepEqual(await gc(g), []);
    await rejectsWith(gc(g, { force: true, slot: 1 }), 'PREVIEW_SLOT_STAGING');
    assert.ok(intact());
    assert.equal((await lease(g, 1)).staging, true);
  });

  it("gc on an inventory without the mark still never judges a staging lease (code that predates it reads it as live)", async () => {
    await heldByMergedBranch();
    await convert(main());
    const inv = loadInventory(admin);
    const unmarked = worktree('older', {});
    saveInventory(unmarked, { ...inv, slots: inv.slots.map((s) => ({ ...s, staging: undefined })) });
    clock.t += 365 * 86400;
    merged = new Set([sha256Hex('claude/ledgers-night-end-2'), null]);
    assert.deepEqual(await gc(unmarked), []);
    assert.ok(intact());
  });

  it('up from a branch refuses it with --slot, and otherwise takes another slot', async () => {
    await heldByMergedBranch();
    await convert(main());
    await rejectsWith(up(worktree('a'), { slot: 1 }), 'PREVIEW_SLOT_STAGING');
    assert.equal((await up(worktree('b'))).plan.n, 2);
    assert.equal((await up(worktree('c'))).plan.n, 3);
    await assert.rejects(up(worktree('d')), /no slot is free/);
    assert.ok(intact());
  });

  it("up from the worktree whose lease file names the staging slot lets the file go and takes another, never slot 1", async () => {
    const old = await heldByMergedBranch();
    await convert(main());
    assert.equal((await up(old)).plan.n, 2);
    assert.equal(loadLease(old).slot, 2);
    assert.ok(intact());
  });

  it("down from that worktree refuses with the code, lets its stale lease file go, and leaves the slot", async () => {
    const old = await heldByMergedBranch();
    await convert(main());
    const before = deploys().length;
    await rejectsWith(down(old), 'PREVIEW_SLOT_STAGING');
    assert.equal(loadLease(old), null);
    assert.equal(deploys().length, before);
    assert.ok(intact());
  });

  it('down --slot 1 refuses without --force and on a token; with --force on the login it unstages and wipes it', async () => {
    await heldByMergedBranch();
    await convert(main());
    const k = main();
    await rejectsWith(unstage(k, 1), 'PREVIEW_SLOT_STAGING');
    await rejectsWith(unstage({ ...k, mode: 'token' }, 1, { force: true }), 'PREVIEW_SLOT_STAGING');
    assert.ok(intact());
    await assert.rejects(unstage(k, 2, { force: true }), /for the staging slot only/);
    const secrets = { ...acct.secrets.get('fletch-pv-1') };
    await unstage(k, 1, { force: true });
    assert.ok(slot1().objects.size === 0 && slot1().AGENT_BUCKET.map.size === 0 && slot1().MEMORY_INDEX.map.size === 0);
    assert.notEqual(acct.secrets.get('fletch-pv-1').MASTER_KEY, secrets.MASTER_KEY);
    const l = await lease(k, 1);
    assert.deepEqual([l.leased, l.staging], [false, undefined]);
  });

  it('list labels it staging, and a marked slot not yet converted says so', async () => {
    await heldByMergedBranch();
    assert.match(leaseLabel(await lease(main(), 1), { staging: true }), /^staging, not converted yet: leased until /);
    await convert(main());
    assert.match(leaseLabel(await lease(main(), 1), { staging: true }), /^staging \(main, deployed on merge; serving app\)$/);
    assert.equal(leaseLabel(await lease(main(), 2)), 'free');
  });
});
