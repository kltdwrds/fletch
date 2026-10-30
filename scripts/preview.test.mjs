import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { down, gc, loadLease, mergedBranchHashes, parseFlags, tokenChecks, up, varFlags } from './preview.mjs';
import { fakeAccount, fakeSlot, fakeSlotsFetch, tagOf } from './preview-fakes.mjs';
import { ownerTag, SECRETS, sha256Hex, slotPlan } from './preview-plan.mjs';
import { deprovision, INVENTORY, loadInventory, provision, saveInventory, subdomainFile } from './preview-pool.mjs';

// `pnpm preview`'s commands against fakes: an account answering the wrangler calls, and slots answering /__preview/ with
// the real ops (scripts/preview-fakes.mjs). The agent's base config is the real one.
const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const { experimental_readRawConfig } = createRequire(path.join(REPO, 'package.json'))('wrangler');
const readRaw = () => experimental_readRawConfig({ config: path.join(REPO, 'packages', 'agent', 'wrangler.jsonc') }).rawConfig;
const SUB = 'example-sub';
const ACCT = 'a'.repeat(32);

let repo;
let acct;
let slots;
let clock;
let fetchHook;
let admin;
let merged;

/** A worktree's context: its own root and lease, the repository's inventory (under `repo`), the account and the slots. */
function worktree(name, extra = {}) {
  const root = path.join(repo, 'worktrees', name);
  mkdirSync(path.join(root, 'scripts'), { recursive: true });
  const byHost = new Map([...slots.values()].map((s) => [s.host, s]));
  const ctx = {
    root,
    mode: 'oauth',
    env: { FLETCH_PREVIEW_SUBDOMAIN: SUB },
    accountId: ACCT,
    dir: path.join(repo, 'git-common', 'fletch-previews'),
    branch: `claude/${name}`,
    owner: `test ${name}`,
    run: acct.run,
    drain: acct.drain,
    mergedHashes: () => merged,
    readRaw,
    write: (file, text) => acct.configs.set(file, text),
    fetch: fakeSlotsFetch(byHost, (host) => acct.secrets.get(host.split('.')[0]) ?? {}, clock, { before: (u, init) => fetchHook?.(u, init) }),
    sleep: async () => {},
    now: () => clock.t * 1000,
    log: () => {},
    ...extra,
  };
  if (admin) saveInventory(ctx, loadInventory(admin));
  return ctx;
}

beforeEach(async () => {
  repo = mkdtempSync(path.join(tmpdir(), 'fletch-preview-test-'));
  slots = new Map([1, 2].map((n) => [`fletch-pv-${n}`, fakeSlot(slotPlan(n, SUB).host)]));
  acct = fakeAccount({ subdomain: SUB, slotsByWorker: slots });
  clock = { t: 1_000_000, now: () => clock.t };
  fetchHook = undefined;
  admin = undefined;
  merged = new Set();
  const a = worktree('admin', { env: {} });
  await provision(a, { slots: 2 });
  admin = a;
});

afterEach(() => rmSync(repo, { recursive: true, force: true }));

const lease = async (ctx, n) => (await ctx.fetch(`https://${slotPlan(n, SUB).host}/__preview/lease`)).json();
const deploys = () => acct.deployed.map((d) => `${d.name} ${d.config.vars.PREVIEW_SERVING}`);
/** What a lease leaves behind: the agent's objects, a bucket object and a vector. */
const use = (n) => {
  const s = slots.get(`fletch-pv-${n}`);
  s.objects.set('Person:sam', 'memories');
  s.AGENT_BUCKET.map.set('files/a', 'x');
  s.MEMORY_INDEX.map.set('v1', { namespace: 'person' });
};
const empty = (n) => {
  const s = slots.get(`fletch-pv-${n}`);
  return s.objects.size === 0 && s.AGENT_BUCKET.map.size === 0 && s.MEMORY_INDEX.map.size === 0;
};

describe('preview pool', () => {
  it('makes each slot a bucket, an index and a placeholder Worker on workers.dev, records the tags, and keeps the subdomain out of the inventory', () => {
    const inv = loadInventory(admin);
    assert.equal(inv.accountId, ACCT);
    for (const s of inv.slots) {
      assert.deepEqual(s.resources.map((r) => [r.kind, r.name, r.created]), [
        ['r2', `${s.name}-agent`, true],
        ['vectorize', `${s.name}-memory`, true],
        ['worker', s.name, true],
      ]);
      assert.equal(s.resources[2].tag, tagOf(s.name));
    }
    assert.deepEqual(deploys(), ['fletch-pv-1 placeholder', 'fletch-pv-1 placeholder', 'fletch-pv-2 placeholder', 'fletch-pv-2 placeholder']);
    assert.ok(acct.calls.includes('vectorize create fletch-pv-1-memory --dimensions 768 --metric cosine'));
    assert.ok(!readFileSync(path.join(admin.root, INVENTORY), 'utf8').includes(SUB));
    assert.equal(readFileSync(subdomainFile(admin), 'utf8').trim(), SUB);
  });

  it('is idempotent, and never redeploys a slot that exists (it may be leased)', async () => {
    const before = acct.calls.length;
    await provision(admin, { slots: 2 });
    assert.ok(!acct.calls.slice(before).some((c) => /^(r2 bucket create|vectorize create|deploy )/.test(c)), acct.calls.slice(before).join('\n'));
  });

  it('refuses a resource with a slot name the inventory does not record, a token, and a subdomain that is not the account\'s', async () => {
    acct.vectorize.add('fletch-pv-3-memory');
    await assert.rejects(provision(admin, { slots: 3 }), /vectorize fletch-pv-3-memory exists on the account but the inventory does not record it/);
    assert.ok(acct.vectorize.has('fletch-pv-3-memory'));
    await assert.rejects(provision({ ...admin, mode: 'token' }, { slots: 1 }), /never on a token/);
    acct.vectorize.delete('fletch-pv-3-memory');
    slots.set('fletch-pv-4', fakeSlot(slotPlan(4, SUB).host));
    await assert.rejects(provision({ ...admin, env: { FLETCH_PREVIEW_SUBDOMAIN: 'other' } }, { slots: 4 }), /not the account's workers.dev subdomain/);
  });

  it('deprovision deletes what the inventory records, emptying the bucket first, and only on the login', async () => {
    acct.r2.set('fletch-pv-1-agent', 3);
    await assert.rejects(deprovision({ ...admin, mode: 'token' }), /never on a token/);
    assert.deepEqual(await deprovision(admin, { slot: 1 }), []);
    assert.ok(!acct.workers.has('fletch-pv-1') && !acct.r2.has('fletch-pv-1-agent') && !acct.vectorize.has('fletch-pv-1-memory'));
    assert.deepEqual(loadInventory(admin).slots.map((s) => s.n), [2]);
    assert.ok(acct.workers.has('fletch-pv-2'));
  });

  it('deprovision deletes nothing when any name is not a preview\'s, and keeps a failed entry for another run', async () => {
    const inv = loadInventory(admin);
    saveInventory(admin, { ...inv, slots: [{ ...inv.slots[0], resources: [...inv.slots[0].resources, { kind: 'r2', name: 'qyvr-app-blobs' }] }, inv.slots[1]] });
    await assert.rejects(deprovision(admin), /refusing to delete anything/);
    assert.ok(acct.workers.has('fletch-pv-1'));
    saveInventory(admin, inv);
    acct.fail = ['vectorize delete fletch-pv-2-memory'];
    const failures = await deprovision(admin);
    assert.equal(failures.length, 1);
    assert.deepEqual(loadInventory(admin).slots.map((s) => s.resources.map((r) => r.name)), [['fletch-pv-2-memory']]);
  });
});

describe('a lease', () => {
  it('takes a free slot, wipes what the last lease left, gives it fresh secrets and deploys the working tree', async () => {
    use(1);
    const a = worktree('a');
    const { plan, setupToken } = await up(a);
    assert.equal(plan.n, 1);
    assert.ok(empty(1), 'the agent objects, bucket and index of the last lease are gone');
    const tag = ownerTag(a.root);
    const secrets = acct.secrets.get('fletch-pv-1');
    assert.deepEqual(Object.keys(secrets).sort(), [...SECRETS, `PREVIEW_KEY_${tag}`].sort());
    assert.equal(secrets.SETUP_TOKEN, setupToken);
    assert.equal(loadLease(a).setupToken, setupToken);
    assert.deepEqual(deploys().slice(-2), ['fletch-pv-1 placeholder', 'fletch-pv-1 app']);
    const app = acct.deployed.at(-1).config;
    assert.equal(app.vars.TENANT_ID, 'fletch-pv-1');
    assert.equal(slots.get('fletch-pv-1').vars.PREVIEW_SERVING, 'app');
    assert.equal((await lease(a, 1)).branchHash, sha256Hex('claude/a'));
  });

  it('a second worktree takes the next slot, and a third finds none free', async () => {
    await up(worktree('a'));
    assert.equal((await up(worktree('b'))).plan.n, 2);
    await assert.rejects(up(worktree('c')), /no slot is free/);
    await assert.rejects(up(worktree('d'), { slot: 1 }), /slot 1 is leased/);
  });

  it('a second up renews the lease and redeploys, keeping the data and the secrets', async () => {
    const a = worktree('a');
    const first = await up(a);
    use(1);
    const secrets = { ...acct.secrets.get('fletch-pv-1') };
    clock.t += 3600;
    const again = await up(a, { ttlHours: 48 });
    assert.equal(again.setupToken, first.setupToken);
    assert.deepEqual(acct.secrets.get('fletch-pv-1'), secrets);
    assert.ok(!empty(1), 'a renewal wipes nothing');
    assert.deepEqual(deploys().slice(-1), ['fletch-pv-1 app']);
    assert.equal((await lease(a, 1)).expiresAt, clock.t + 48 * 3600);
  });

  it('keeps its key when a secrets write builds on a stale version', async () => {
    acct.stale = true;
    const a = worktree('a');
    await up(a);
    assert.ok(acct.secrets.get('fletch-pv-1')[`PREVIEW_KEY_${ownerTag(a.root)}`]);
  });

  it('tries the next slot when another session wins the race for the first', async () => {
    const b = worktree('b');
    let raced = false;
    fetchHook = async (u, init) => {
      if (!raced && u.pathname === '/__preview/claim' && u.host.startsWith('fletch-pv-1.')) {
        raced = true;
        fetchHook = undefined;
        await up(b, { slot: 1 });
      }
      void init;
    };
    const a = worktree('a');
    assert.equal((await up(a)).plan.n, 2);
    assert.ok(!acct.secrets.get('fletch-pv-1')[`PREVIEW_KEY_${ownerTag(a.root)}`], 'the losing key is taken back');
  });

  it('down puts the slot back: placeholder, agent objects deleted, bucket and index emptied, new secrets, no keys, lease ended', async () => {
    const a = worktree('a');
    const { setupToken } = await up(a);
    use(1);
    await down(a);
    assert.ok(empty(1));
    assert.equal(slots.get('fletch-pv-1').vars.PREVIEW_SERVING, 'placeholder');
    const secrets = acct.secrets.get('fletch-pv-1');
    assert.deepEqual(Object.keys(secrets).sort(), [...SECRETS].sort());
    assert.notEqual(secrets.SETUP_TOKEN, setupToken);
    assert.equal(loadLease(a), null);
    assert.equal((await lease(a, 1)).leased, false);
    assert.equal((await up(worktree('b'))).plan.n, 1, 'the slot is free again');
  });

  it('down after gc took the slot back lets go of the lease file without touching the slot', async () => {
    const a = worktree('a');
    await up(a);
    clock.t += 25 * 3600;
    assert.deepEqual(await gc(worktree('gc')), []);
    const b = worktree('b');
    await up(b);
    const before = deploys().length;
    await down(a);
    assert.equal(loadLease(a), null);
    assert.equal(deploys().length, before);
    assert.equal((await lease(b, 1)).leased, true);
  });

  it('down keeps the lease file while the slot is still leased to this branch but does not take the key yet', async () => {
    const a = worktree('a');
    await up(a);
    const secrets = acct.secrets.get('fletch-pv-1');
    acct.secrets.set('fletch-pv-1', Object.fromEntries(Object.entries(secrets).filter(([k]) => !k.startsWith('PREVIEW_KEY_'))));
    await assert.rejects(down(a), /lease file is kept/);
    assert.ok(existsSync(path.join(a.dir, `lease-${ownerTag(a.root)}.json`)));
  });

  it('refuses every lease command while the workers.dev subdomain is unknown', async () => {
    await assert.rejects(up(worktree('a', { env: {}, dir: path.join(repo, 'elsewhere') })), /FLETCH_PREVIEW_SUBDOMAIN/);
  });
});

describe('gc', () => {
  it('takes back an expired lease and a merged branch, leaving live ones; --dry-run only says', async () => {
    const a = worktree('a');
    const b = worktree('b');
    await up(a);
    await up(b);
    use(1);
    merged = new Set([sha256Hex('claude/b')]);
    const g = worktree('gc');
    await gc(g, { dryRun: true });
    assert.equal((await lease(g, 2)).leased, true);
    assert.deepEqual(await gc(g), []);
    assert.equal((await lease(g, 2)).leased, false);
    assert.equal((await lease(g, 1)).leased, true, 'a live, unmerged lease stays');
    assert.ok(!empty(1));
    clock.t += 25 * 3600;
    assert.deepEqual(await gc(g), []);
    assert.equal((await lease(g, 1)).expiresAt, null);
    assert.ok(empty(1));
    assert.deepEqual(Object.keys(acct.secrets.get('fletch-pv-1')).sort(), [...SECRETS].sort());
  });

  it('--force takes back one live lease, on the login only', async () => {
    await up(worktree('a'));
    const g = worktree('gc');
    await assert.rejects(gc({ ...g, mode: 'token' }, { force: true, slot: 1 }), /Kyle's login only/);
    await assert.rejects(gc(g, { force: true }), /--slot n/);
    assert.deepEqual(await gc(g, { force: true, slot: 1 }), []);
    assert.equal((await lease(g, 1)).leased, false);
  });
});

describe("gc's merged branches", () => {
  it('reads one branch a line with colour off, and judges by expiry only, saying so, when gh fails or answers garbled', () => {
    let seen;
    const gh = (stdout, status = 0) => (cmd, args, opts) => {
      seen = { args, env: opts.env };
      return { status, stdout };
    };
    assert.deepEqual(mergedBranchHashes('/r', () => {}, gh('claude/a\nmain\n')), new Set([sha256Hex('claude/a'), sha256Hex('main')]));
    assert.equal(seen.env.NO_COLOR, '1');
    assert.ok(seen.args.includes('--jq'));
    for (const bad of [gh('', 1), gh('\u001b[1;37m[\u001b[m\n')]) {
      const logs = [];
      assert.deepEqual(mergedBranchHashes('/r', (l) => logs.push(l), bad), new Set());
      assert.match(logs[0], /judging by expiry only/);
    }
  });
});

describe('up --var', () => {
  it('collects every --var pair, keeps the other flags, and refuses a pair that is not K=V', () => {
    const { flags } = parseFlags(['--var', 'CHAT_PROVIDER=meta', '--paid', '--var', 'CHAT_HEDGE=off', '--ttl', '2']);
    assert.deepEqual(flags, { var: ['CHAT_PROVIDER=meta', 'CHAT_HEDGE=off'], paid: true, ttl: '2' });
    assert.deepEqual(varFlags(flags.var), { CHAT_PROVIDER: 'meta', CHAT_HEDGE: 'off' });
    assert.deepEqual(varFlags(undefined), {});
    assert.throws(() => varFlags(['CHAT_HEDGE']), /--var takes K=V/);
    assert.throws(() => varFlags(['=off']), /--var takes K=V/);
  });
});

describe('doctor', () => {
  it('tokenChecks sends the token on stdin, never on the command line', () => {
    const seen = [];
    const curl = (args, input) => {
      seen.push({ args, input });
      return { status: 0, stdout: '200' };
    };
    const t = tokenChecks(ACCT, { CLOUDFLARE_API_TOKEN: 'secret-value' }, curl);
    assert.deepEqual([t.bare, t.header], ['200', '200']);
    assert.ok(seen.every((c) => !c.args.join(' ').includes('secret-value')));
    assert.match(seen[1].input, /Authorization: Bearer secret-value/);
    assert.equal(tokenChecks(ACCT, {}, curl).header, 'not tried (no CLOUDFLARE_API_TOKEN)');
  });
});
