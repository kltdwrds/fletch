import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { beforeEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { selfHost } from './self-host.mjs';
import { NAME_RE, parseSelfHostArgs, SELF_HOST_CONFIG, SELF_HOST_VAR_KEYS, secretsToMint, selfHostConfig, selfHostEnv, setupLink } from './self-host-plan.mjs';
import { fakeAccount } from './preview-fakes.mjs';

// `pnpm self-host` (scripts/self-host.mjs, scripts/self-host-plan.mjs): the arguments and their refusals, the deploy's
// config from the agent's real base config, and whole runs against a fake account answering wrangler's calls
// (scripts/preview-fakes.mjs). These hold D-0021 (paid-plan bindings only with --paid), D-0022 (a deploy from this
// checkout on the owner's wrangler login) and D-0023 (the setup token is minted once and its link printed once).
const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const { experimental_readRawConfig } = createRequire(path.join(REPO, 'package.json'))('wrangler');
const BASE_PATH = path.join(REPO, 'packages', 'agent', 'wrangler.jsonc');
const BASE = experimental_readRawConfig({ config: BASE_PATH }).rawConfig;
const SUB = 'example-sub';
const ACCT = 'a'.repeat(32);
const EMAIL = 'sam@solo-sam.example';
const OTHER = 'pat@solo-sam.example';
const APP = `https://sam.${SUB}.workers.dev`;

const args = (...extra) => ['--name', 'sam', '--owner-email', EMAIL, ...extra];
const refusal = (argv) => parseSelfHostArgs(argv).refusal?.code;

describe('self-host: arguments', () => {
  it('reads the name, the owner, the account, --paid and the model vars', () => {
    assert.deepEqual(parseSelfHostArgs(args('--account-id', ACCT, '--paid', '--var', 'AI_GATEWAY_ID=gw', '--var', 'CHAT_PROVIDER=meta')), {
      name: 'sam',
      ownerEmail: EMAIL,
      accountId: ACCT,
      paid: true,
      vars: { AI_GATEWAY_ID: 'gw', CHAT_PROVIDER: 'meta' },
    });
    assert.deepEqual(parseSelfHostArgs(args()), { name: 'sam', ownerEmail: EMAIL, accountId: undefined, paid: false, vars: {} });
  });

  it('refuses a name that is not a tenant id, by name', () => {
    assert.equal(NAME_RE.source, '^[a-z][a-z0-9-]{1,30}$');
    for (const name of ['Sam', 's', '1sam', 'sam_x', 'a'.repeat(32)]) assert.equal(refusal(['--name', name, '--owner-email', EMAIL]), 'SELF_HOST_NAME_INVALID', name);
    assert.equal(refusal(['--owner-email', EMAIL]), 'SELF_HOST_NAME_INVALID');
  });

  it('refuses an owner email without exactly one @, by name', () => {
    for (const email of ['sam', 'sam@', '@x.example', `${EMAIL}@x`, 'sam @x.example']) assert.equal(refusal(['--name', 'sam', '--owner-email', email]), 'SELF_HOST_EMAIL_INVALID', email);
    assert.equal(refusal(['--name', 'sam']), 'SELF_HOST_EMAIL_INVALID');
  });

  it('refuses any var but the two model vars, CHAT_HEDGE among them, and a pair without =', () => {
    assert.deepEqual(SELF_HOST_VAR_KEYS, ['AI_GATEWAY_ID', 'CHAT_PROVIDER']);
    const hedge = parseSelfHostArgs(args('--var', 'CHAT_HEDGE=off')).refusal;
    assert.equal(hedge.code, 'SELF_HOST_VAR_UNKNOWN');
    assert.match(hedge.reason, /CHAT_HEDGE/);
    for (const v of ['TENANT_ID=x', 'OWNER_EMAIL=x', 'MASTER_KEY=k', 'CHAT_PROVIDER', '=meta']) assert.equal(refusal(args('--var', v)), 'SELF_HOST_VAR_UNKNOWN', v);
  });

  it("refuses a preview slot's name, which would adopt the slot's Worker, bucket and index", () => {
    for (const name of ['fletch-pv-3', 'fletch-pv-a-b']) assert.equal(refusal(['--name', name, '--owner-email', EMAIL]), 'SELF_HOST_NAME_RESERVED', name);
    assert.equal(parseSelfHostArgs(['--name', 'fletch-pvx', '--owner-email', EMAIL]).name, 'fletch-pvx');
  });

  it('refuses a model var the agent would ignore: an unknown provider, meta without a gateway, an empty gateway', () => {
    for (const v of [['CHAT_PROVIDER=openai'], ['CHAT_PROVIDER=Meta', 'AI_GATEWAY_ID=gw'], ['CHAT_PROVIDER=meta'], ['CHAT_PROVIDER=meta', 'AI_GATEWAY_ID= '], ['AI_GATEWAY_ID=']]) {
      const r = parseSelfHostArgs(args(...v.flatMap((x) => ['--var', x]))).refusal;
      assert.equal(r?.code, 'SELF_HOST_VAR_INVALID', v.join(' '));
    }
    assert.match(parseSelfHostArgs(args('--var', 'CHAT_PROVIDER=meta')).refusal.reason, /AI_GATEWAY_ID/);
    assert.deepEqual(parseSelfHostArgs(args('--var', 'CHAT_PROVIDER=workers-ai')).vars, { CHAT_PROVIDER: 'workers-ai' });
    assert.deepEqual(parseSelfHostArgs(args('--var', 'AI_GATEWAY_ID=gw')).vars, { AI_GATEWAY_ID: 'gw' });
  });

  it('refuses an account id that is not 32 hex, and an option it does not know', () => {
    assert.equal(refusal(args('--account-id', 'abc')), 'SELF_HOST_ACCOUNT_INVALID');
    assert.equal(refusal(args('--token', 'x')), 'SELF_HOST_ARG_UNKNOWN');
    assert.equal(refusal(args('--name')), 'SELF_HOST_ARG_UNKNOWN');
  });

  it('the command refuses on stderr with its code and exit 1 before it runs wrangler', () => {
    const r = spawnSync(process.execPath, [path.join(REPO, 'scripts', 'self-host.mjs'), ...args('--var', 'CHAT_HEDGE=off')], { encoding: 'utf8', env: { PATH: process.env.PATH } });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /^self-host: SELF_HOST_VAR_UNKNOWN: .*CHAT_HEDGE/);
    assert.equal(r.stdout, '');
  });
});

describe('self-host: the environment wrangler runs in', () => {
  const env = {
    PATH: '/bin',
    HOME: '/h',
    CLOUDFLARE_API_TOKEN: 't',
    CLOUDFLARE_API_KEY: 'k',
    CLOUDFLARE_EMAIL: 'e',
    CLOUDFLARE_ACCOUNT_ID: 'b'.repeat(32),
    CF_API_TOKEN: 't',
    CF_API_KEY: 'k',
    CF_EMAIL: 'e',
    CF_ACCOUNT_ID: 'b'.repeat(32),
    CLAUDE_CODE_OAUTH_TOKEN: 'o',
  };

  it("carries no credential and no account but --account-id's, so wrangler runs on the owner's own login", () => {
    const out = selfHostEnv(env, undefined);
    for (const k of Object.keys(env).filter((k) => !['PATH', 'HOME'].includes(k))) assert.equal(out[k], undefined, k);
    assert.deepEqual([out.PATH, out.HOME], ['/bin', '/h']);
    assert.equal(selfHostEnv(env, ACCT).CLOUDFLARE_ACCOUNT_ID, ACCT);
    assert.equal(env.CLOUDFLARE_API_KEY, 'k');
  });
});

describe('self-host: the deploy config', () => {
  const opts = { name: 'sam', ownerEmail: EMAIL, paid: false, vars: {} };
  const c = selfHostConfig(BASE, opts);

  it("runs the agent from this checkout on the deploy's own bucket, index and tenant, for its owner, on workers.dev", () => {
    assert.equal(c.name, 'sam');
    assert.equal(c.main, 'src/index.ts');
    assert.equal(c.workers_dev, true);
    assert.equal(c.account_id, undefined);
    assert.equal(selfHostConfig(BASE, { ...opts, accountId: ACCT }).account_id, ACCT);
    assert.deepEqual(c.r2_buckets, [{ binding: 'AGENT_BUCKET', bucket_name: 'sam-agent' }]);
    assert.deepEqual(c.vectorize, [{ binding: 'MEMORY_INDEX', index_name: 'sam-memory' }]);
    // The base config's model vars carry without a --var: chat on Muse Spark through the gateway qyvr.
    assert.deepEqual(c.vars, { TENANT_ID: 'sam', TENANT_SHAPE: 'standalone', QYVR_ENV: 'self-host', OWNER_EMAIL: EMAIL, AI_GATEWAY_ID: 'qyvr', CHAT_PROVIDER: 'meta' });
    assert.deepEqual([c.durable_objects, c.exports, c.ai, c.compatibility_date], [BASE.durable_objects, BASE.exports, BASE.ai, BASE.compatibility_date]);
  });

  it('lays only the model vars given over the base vars', () => {
    const v = selfHostConfig(BASE, { ...opts, vars: { AI_GATEWAY_ID: 'gw', CHAT_PROVIDER: 'meta' } }).vars;
    assert.deepEqual(v, { TENANT_ID: 'sam', TENANT_SHAPE: 'standalone', QYVR_ENV: 'self-host', OWNER_EMAIL: EMAIL, AI_GATEWAY_ID: 'gw', CHAT_PROVIDER: 'meta' });
    assert.deepEqual(selfHostConfig(BASE, { ...opts, vars: { CHAT_PROVIDER: 'workers-ai' } }).vars, { ...c.vars, CHAT_PROVIDER: 'workers-ai' });
    assert.throws(() => selfHostConfig(BASE, { ...opts, vars: { CHAT_HEDGE: 'off' } }), /CHAT_HEDGE/);
  });

  it('holds D-0021: the paid-plan bindings exactly with --paid, and none without', () => {
    const paid = selfHostConfig(BASE, { ...opts, paid: true });
    assert.deepEqual(paid.worker_loaders, [{ binding: 'LOADER' }]);
    assert.deepEqual(paid.images, { binding: 'IMAGES' });
    assert.equal(c.worker_loaders, undefined);
    assert.equal(c.images, undefined);
    assert.ok(!JSON.stringify(c).includes('LOADER') && !JSON.stringify(c).includes('IMAGES'));
  });

  it("names no key outside the agent's config but its name, account and workers.dev, and none of the base's resources", () => {
    const allowed = new Set([...Object.keys(BASE), 'name', 'account_id', 'workers_dev']);
    assert.deepEqual(Object.keys(selfHostConfig(BASE, { ...opts, accountId: ACCT })).filter((k) => !allowed.has(k)), []);
    for (const n of ['qyvr-base-agent', 'qyvr-base-memory']) assert.ok(!JSON.stringify(c).includes(n), n);
    assert.throws(() => selfHostConfig({ ...BASE, d1_databases: [{ binding: 'DB', database_id: 'prod' }] }, opts), /d1_databases, which a self-host deploy does not know/);
  });

  it('mints only the secrets the Worker lacks, and links the setup token to /login', () => {
    assert.deepEqual(secretsToMint([]), ['MASTER_KEY', 'SETUP_TOKEN']);
    assert.deepEqual(secretsToMint(['MASTER_KEY']), ['SETUP_TOKEN']);
    assert.deepEqual(secretsToMint(['MASTER_KEY', 'SETUP_TOKEN', 'OTHER']), []);
    assert.equal(setupLink(APP, 'tok'), `${APP}/login?setup=tok`);
  });
});

describe('self-host: a run', () => {
  let acct;
  let lines;
  const ctx = (extra = {}) => ({
    root: REPO,
    run: acct.run,
    readRaw: () => BASE,
    read: (file) => acct.configs.get(file) ?? null,
    write: (file, text) => acct.configs.set(file, text),
    log: (l) => lines.push(l),
    ...extra,
  });
  const opts = parseSelfHostArgs(args());
  const since = (i) => acct.calls.slice(i);
  const CONFIG_FILE = path.join(REPO, 'packages', 'agent', SELF_HOST_CONFIG);

  beforeEach(() => {
    acct = fakeAccount({ subdomain: SUB, slotsByWorker: new Map() });
    lines = [];
  });

  it('makes the bucket and the index, deploys the generated config, sets both secrets in one write, and prints the setup link once', async () => {
    const r = await selfHost(ctx(), opts);
    assert.deepEqual(r, { ok: true, url: APP });
    assert.ok(acct.r2.has('sam-agent'));
    assert.ok(acct.vectorize.has('sam-memory'));
    assert.ok(acct.calls.includes('vectorize create sam-memory --dimensions 768 --metric cosine'));
    assert.deepEqual(acct.deployed.map((d) => [d.name, d.main]), [['sam', 'src/index.ts']]);
    assert.ok(acct.calls.includes(`deploy -c ${SELF_HOST_CONFIG}`));
    const written = acct.configs.get(path.join(REPO, 'packages', 'agent', SELF_HOST_CONFIG));
    assert.match(written, /^\/\/ Written by scripts\/self-host\.mjs/);
    assert.equal(acct.calls.filter((c) => c.startsWith('secret bulk')).length, 1);
    const secrets = acct.secrets.get('sam');
    assert.deepEqual(Object.keys(secrets).sort(), ['MASTER_KEY', 'SETUP_TOKEN']);
    for (const v of Object.values(secrets)) assert.match(v, /^[A-Za-z0-9_-]{43}$/);
    const out = lines.join('\n');
    assert.ok(lines.includes(`fletch is deployed: ${APP}`));
    // D-0023: the minted token is printed in the one link line and nowhere else; the master key never.
    assert.deepEqual(lines.filter((l) => l.includes(secrets.SETUP_TOKEN)), [setupLink(APP, secrets.SETUP_TOKEN)]);
    assert.ok(!out.includes(secrets.MASTER_KEY));
  });

  it('holds D-0022 and D-0023: a second run redeploys the code, makes nothing, sets no secret and prints no setup link', async () => {
    await selfHost(ctx(), opts);
    const before = acct.calls.length;
    lines = [];
    const r = await selfHost(ctx(), opts);
    assert.deepEqual(r, { ok: true, url: APP });
    assert.ok(since(before).includes(`deploy -c ${SELF_HOST_CONFIG}`));
    assert.ok(!since(before).some((c) => /^(r2 bucket create|vectorize create|secret bulk)/.test(c)), since(before).join('\n'));
    assert.ok(!lines.join('\n').includes('?setup='));
    assert.ok(lines.includes(`fletch is deployed: ${APP}`));
  });

  it('keeps a bucket or index that already exists, and mints only the missing secret', async () => {
    acct.r2.set('sam-agent', 3);
    acct.vectorize.add('sam-memory');
    acct.workers.add('sam');
    acct.secrets.set('sam', { MASTER_KEY: 'kept' });
    await selfHost(ctx(), opts);
    assert.ok(!acct.calls.some((c) => /^(r2 bucket create|vectorize create)/.test(c)));
    assert.equal(acct.secrets.get('sam').MASTER_KEY, 'kept');
    assert.ok(lines.some((l) => l.includes('?setup=')));
  });

  it('refuses SELF_HOST_NOT_LOGGED_IN when wrangler has no login, before anything else', async () => {
    acct.fail.push('whoami');
    const r = await selfHost(ctx(), opts);
    assert.equal(r.code, 'SELF_HOST_NOT_LOGGED_IN');
    assert.match(r.reason, /wrangler login/);
    assert.deepEqual(acct.calls, ['whoami --json']);
    assert.equal(acct.configs.has(CONFIG_FILE), false);
  });

  it('refuses SELF_HOST_OWNER_CHANGE when the deploy was made for another owner, naming both, before it writes or calls anything', async () => {
    await selfHost(ctx(), opts);
    const written = acct.configs.get(CONFIG_FILE);
    const before = acct.calls.length;
    const r = await selfHost(ctx(), parseSelfHostArgs(['--name', 'sam', '--owner-email', OTHER]));
    assert.equal(r.code, 'SELF_HOST_OWNER_CHANGE');
    assert.ok(r.reason.includes(EMAIL) && r.reason.includes(OTHER), r.reason);
    assert.deepEqual(since(before), []);
    assert.equal(acct.configs.get(CONFIG_FILE), written);
    // The same owner, however it is spelled, is no change; another deploy's config guards nothing here.
    assert.equal((await selfHost(ctx(), parseSelfHostArgs(['--name', 'sam', '--owner-email', EMAIL.toUpperCase()]))).ok, true);
    assert.equal((await selfHost(ctx(), parseSelfHostArgs(['--name', 'pat', '--owner-email', OTHER]))).ok, true);
  });

  it('refuses SELF_HOST_CONFIG_INVALID for a base config it cannot derive from, or an earlier config that is not JSON, before any call', async () => {
    const bad = await selfHost(ctx({ readRaw: () => ({ ...BASE, d1_databases: [{ binding: 'DB', database_id: 'prod' }] }) }), opts);
    assert.equal(bad.code, 'SELF_HOST_CONFIG_INVALID');
    assert.match(bad.reason, /d1_databases/);
    acct.configs.set(CONFIG_FILE, '// half\n{ "name": ');
    assert.equal((await selfHost(ctx(), opts)).code, 'SELF_HOST_CONFIG_INVALID');
    assert.deepEqual(acct.calls, []);
  });

  it('keeps a bucket another run made between the listing and its own create', async () => {
    const race = (a, o) => {
      if (a.join(' ') === 'r2 bucket create sam-agent') {
        acct.calls.push(a.join(' '));
        acct.r2.set('sam-agent', 0);
        return { status: 1, out: 'The bucket you tried to create already exists [code: 10004]' };
      }
      return acct.run(a, o);
    };
    const r = await selfHost(ctx({ run: race }), opts);
    assert.deepEqual(r, { ok: true, url: APP });
    assert.ok(lines.includes('R2 bucket sam-agent: already there, kept.'));
  });

  it("refuses SELF_HOST_INDEX_SHAPE for an existing index the agent's embeddings do not fit, before it writes or deploys", async () => {
    for (const shape of [{ dimensions: 1024, metric: 'cosine' }, { dimensions: 768, metric: 'euclidean' }]) {
      acct = fakeAccount({ subdomain: SUB, slotsByWorker: new Map() });
      acct.vectorize.add('sam-memory');
      acct.indexShapes.set('sam-memory', shape);
      const r = await selfHost(ctx(), opts);
      assert.equal(r.code, 'SELF_HOST_INDEX_SHAPE', JSON.stringify(shape));
      assert.match(r.reason, /768 and cosine/);
      assert.deepEqual(acct.deployed, []);
      assert.equal(acct.configs.has(CONFIG_FILE), false);
    }
  });

  it('refuses SELF_HOST_DEPLOY_FAILED with wrangler\'s last lines when the deploy fails, and sets no secret', async () => {
    acct.fail.push('deploy');
    const r = await selfHost(ctx(), opts);
    assert.equal(r.code, 'SELF_HOST_DEPLOY_FAILED');
    assert.match(r.reason, /it failed \[code: 10000\]/);
    assert.ok(!acct.calls.some((c) => c.startsWith('secret')));
    acct = fakeAccount({ subdomain: SUB, slotsByWorker: new Map() });
    acct.fail.push('r2 bucket create');
    assert.equal((await selfHost(ctx(), opts)).code, 'SELF_HOST_DEPLOY_FAILED');
  });

  it("reads the URL from wrangler's printed triggers when its output file names none, and refuses without one before any secret", async () => {
    const noFile = (args, o = {}) => acct.run(args, { ...o, extraEnv: {} });
    assert.deepEqual(await selfHost(ctx({ run: noFile }), opts), { ok: true, url: APP });
    acct = fakeAccount({ subdomain: SUB, slotsByWorker: new Map() });
    const silent = (args, o = {}) => (args[0] === 'deploy' ? { ...acct.run(args, { ...o, extraEnv: {} }), out: 'Uploaded sam\n' } : acct.run(args, o));
    const r = await selfHost(ctx({ run: silent }), opts);
    assert.equal(r.code, 'SELF_HOST_DEPLOY_FAILED');
    assert.match(r.reason, /workers\.dev URL/);
    assert.ok(!acct.calls.some((c) => c.startsWith('secret')));
  });
});
