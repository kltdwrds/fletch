// The staging slot (docs/runbooks/preview.md, Staging): the one slot the inventory (scripts/preview-pool.json) marks
// `"staging": true`, which serves main for Kyle's UAT and is redeployed from main on every merge
// (.github/workflows/deploy-staging.yml). Its lease row says `staging`: no claim takes it, gc never judges it, and only
// `down --slot n --force` on Kyle's login ends it. `convert` makes a slot staging once and `deploy` redeploys it; both
// deploy the agent over what is there, and neither deploys the placeholder, resets the bucket or index, or writes
// MASTER_KEY or SETUP_TOKEN, so the owner's passkey, workspace and data stay. The lease commands are scripts/preview.mjs.
import { randomBytes } from 'node:crypto';
import { origin, ownerTag, refusal, stagingSlots } from './preview-plan.mjs';
import { account, deploySlot, needInventory } from './preview-pool.mjs';
import { dropKeys, keyAccepted, must, op, planOf, release, waitReady } from './preview.mjs';

/** How many times `convert` reads the lease before refusing, and the wait between reads: two minutes. */
export const LEASE_CODE_READS = 24;
export const LEASE_CODE_WAIT_MS = 5000;

/** The staging slot's number: the inventory must mark exactly one. */
export function stagingSlot(inv) {
  const marked = stagingSlots(inv);
  if (marked.length !== 1) throw refusal('PREVIEW_STAGING_NONE', `the inventory (scripts/preview-pool.json) marks ${marked.length} slots staging; it takes exactly one`);
  return marked[0];
}

/**
 * Staging serves committed main: the `main` branch, or a detached HEAD at the commit of refs/remotes/origin/main (a
 * worktree or cloud session sitting at origin/main after `git fetch origin +refs/heads/main:refs/remotes/origin/main`).
 * Another branch, a detached HEAD at any other commit, or changes to tracked files are refused.
 */
function fromMain(ctx, what) {
  if (ctx.branch === 'HEAD') {
    const head = ctx.headCommit();
    const originMain = ctx.originMainCommit();
    if (!head || !originMain || head !== originMain) throw refusal('PREVIEW_STAGING_NOT_MAIN', `${what} deploys main; this checkout is detached at ${head ?? 'no commit'}, not at origin/main (${originMain ?? 'not fetched'}); run \`git fetch origin +refs/heads/main:refs/remotes/origin/main\` and check out that commit`);
  } else if (ctx.branch !== 'main') throw refusal('PREVIEW_STAGING_NOT_MAIN', `${what} deploys main; this checkout is on ${ctx.branch}`);
  if (!ctx.treeClean()) throw refusal('PREVIEW_STAGING_DIRTY', `${what} deploys committed main; this checkout has changes to tracked files`);
}

const publicLease = async (ctx, plan) => must(await op(ctx, plan, 'GET', 'lease'), `reading slot ${plan.n}'s lease`);

/**
 * Waits until the slot's lease object runs deploy `id`'s code. `wrangler deploy` returning, and the Worker serving the
 * deploy (`waitReady`), do not mean the Durable Object has restarted on it: the first live conversion called `stage` on
 * an object still running code without it and got Cloudflare's 500. Refuses with PREVIEW_DEPLOY_NOT_SERVING after
 * LEASE_CODE_READS reads; returns how many reads it took.
 */
export async function waitLeaseCode(ctx, plan, id) {
  let last = '';
  for (let i = 1; i <= LEASE_CODE_READS; i++) {
    const r = await op(ctx, plan, 'GET', 'lease').catch((e) => ({ status: 0, body: { error: { message: e.message } } }));
    if (r.status === 200 && r.body?.leaseDeploy === id) {
      ctx.log(`preview: slot ${plan.n}: its lease object runs deploy ${id} (read ${i} of at most ${LEASE_CODE_READS})`);
      return i;
    }
    last = r.status === 200 ? `its lease object runs ${r.body?.leaseDeploy ? `deploy ${r.body.leaseDeploy}` : 'code that names no deploy (older than this check)'}` : `the lease read answered ${r.status}: ${r.body?.error?.message ?? JSON.stringify(r.body).slice(0, 120)}`;
    ctx.log(`preview: slot ${plan.n}: waiting for its lease object to run deploy ${id} (read ${i} of ${LEASE_CODE_READS}: ${last})`);
    if (i < LEASE_CODE_READS) await ctx.sleep(LEASE_CODE_WAIT_MS);
  }
  throw refusal('PREVIEW_DEPLOY_NOT_SERVING', `slot ${plan.n}'s lease object did not run deploy ${id} after ${LEASE_CODE_READS} reads ${LEASE_CODE_WAIT_MS / 1000} s apart; last: ${last}. The deploy is in place, but no key was set and the lease is not marked staging; run \`pnpm preview staging convert\` again`);
}

/**
 * Makes the inventory's staging slot staging, once, on Kyle's login from a clean main checkout, keeping what it holds:
 * 1. deploys main's agent to it (the Worker running there may predate the staging op): a deploy keeps every secret,
 *    every Durable Object, the bucket and the index; then waits until the slot serves it and its lease object runs it;
 * 2. sets a key of this checkout's, alone in its secrets write, so MASTER_KEY and SETUP_TOKEN are not touched;
 * 3. marks the lease staging, a compare-and-set on the tag it read, so a lease taken meanwhile is never taken over;
 * 4. deletes every PREVIEW_KEY_* (the last holder's and this one): nobody holds the staging lease.
 * A slot that was free (its secrets rotated by a release, so nobody knows its setup token) gets a new SETUP_TOKEN, and
 * only then; `setupToken` is returned for its first passkey. Converting a staging slot again changes nothing.
 */
export async function convert(ctx, { paid = false, vars = {} } = {}) {
  if (ctx.mode !== 'oauth') throw refusal('PREVIEW_STAGING_LOGIN', "`staging convert` runs on Kyle's wrangler login, never on a token");
  fromMain(ctx, '`staging convert`');
  const inv = needInventory(ctx);
  const n = stagingSlot(inv);
  const plan = planOf(ctx, n);
  const before = await publicLease(ctx, plan);
  if (before.staging) {
    ctx.log(`preview: slot ${n} is staging already; nothing to convert (\`pnpm preview staging deploy\` redeploys it)`);
    return { plan, already: true, setupToken: null };
  }
  ctx.log(`preview: slot ${n}: deploying main over what it holds (its secrets, objects, bucket and index stay)`);
  const d = deploySlot(ctx, inv, n, { paid, vars });
  await waitReady(ctx, plan, d.deploy);
  await waitLeaseCode(ctx, plan, d.deploy);
  const auth = { key: randomBytes(32).toString('hex'), tag: ownerTag(ctx.root) };
  const acc = account(ctx.run);
  const setupToken = before.expiresAt === null ? randomBytes(32).toString('base64url') : null;
  acc.secrets(plan.worker, { [`PREVIEW_KEY_${auth.tag}`]: auth.key, ...(setupToken ? { SETUP_TOKEN: setupToken } : {}) });
  try {
    if (!(await keyAccepted(ctx, plan, auth))) throw new Error(`preview: slot ${n} did not take the converter's key`);
    const full = must(await op(ctx, plan, 'GET', 'lease', auth), 'reading the lease');
    must(await op(ctx, plan, 'POST', 'staging', { ...auth, body: { expectTag: full.tag } }), `marking slot ${n} staging`);
    ctx.log(`preview: slot ${n} is staging; it was ${full.owner ? `held by ${full.owner}` : 'free'}`);
  } catch (e) {
    acc.secrets(plan.worker, { [`PREVIEW_KEY_${auth.tag}`]: null });
    throw e;
  }
  dropKeys(ctx, plan);
  return { plan, already: false, setupToken };
}

/**
 * Redeploys main to the staging slot (CI on every merge, or by hand): only after its lease says staging, never another
 * slot, and nothing but a deploy of the agent, so its secrets, objects, bucket and index stay. Fails, never falls back.
 */
export async function deployStaging(ctx, { paid = false, vars = {} } = {}) {
  fromMain(ctx, '`staging deploy`');
  const inv = needInventory(ctx);
  const n = stagingSlot(inv);
  const plan = planOf(ctx, n);
  const lease = await publicLease(ctx, plan);
  if (!lease.staging) throw refusal('PREVIEW_STAGING_NOT_CONVERTED', `slot ${n}'s lease is not staging yet; on Kyle's login, \`pnpm preview staging convert\` from a clean main checkout converts it once`);
  const d = deploySlot(ctx, inv, n, { paid, vars });
  await waitReady(ctx, plan, d.deploy);
  return { plan, deploy: d.deploy };
}

/**
 * `down --slot n --force`: unstages the staging slot and releases it as `down` does (the placeholder, new secrets, the
 * bucket and index emptied, every key gone): its data is wiped. Kyle's login only; without `--force` it is refused.
 * The inventory still marks the slot staging afterwards, so no branch takes it until that mark is removed in a PR.
 */
export async function unstage(ctx, n, { force = false } = {}) {
  const inv = needInventory(ctx);
  if (!stagingSlots(inv).includes(n)) throw new Error(`preview: \`down --slot ${n}\` is for the staging slot only; a worktree releases its own lease with \`pnpm preview down\``);
  if (!force || ctx.mode !== 'oauth') throw refusal('PREVIEW_SLOT_STAGING', `slot ${n} is the staging slot; \`down\` releases it only with --force on Kyle's login, and that wipes its data`);
  const plan = planOf(ctx, n);
  const auth = { key: randomBytes(32).toString('hex'), tag: ownerTag(ctx.root) };
  account(ctx.run).secrets(plan.worker, { [`PREVIEW_KEY_${auth.tag}`]: auth.key });
  if (!(await keyAccepted(ctx, plan, auth))) throw new Error(`preview: slot ${n} did not take the key`);
  const full = must(await op(ctx, plan, 'GET', 'lease', auth), 'reading the lease');
  await release(ctx, inv, plan, auth, { force: true, expectTag: full.tag, unstage: true });
  return plan;
}

/** `pnpm preview staging <convert|deploy|status>`. */
export async function stagingCommand(ctx, sub, opts) {
  if (sub === 'convert') {
    const { plan, already, setupToken } = await convert(ctx, opts);
    if (already) return;
    ctx.log(`preview: slot ${plan.n} is the staging slot\n  app    ${origin(plan)}${setupToken ? `\n  setup  ${origin(plan)}/login?setup=${setupToken} (the slot was free, so it has a new setup token)` : ''}\n  every push to main now redeploys it (.github/workflows/deploy-staging.yml)`);
  } else if (sub === 'deploy') {
    const { plan, deploy } = await deployStaging(ctx, opts);
    ctx.log(`preview: slot ${plan.n} (staging) serves main, deploy ${deploy}`);
  } else if (sub === 'status') {
    const plan = planOf(ctx, stagingSlot(needInventory(ctx)));
    const lease = await publicLease(ctx, plan);
    const health = await ctx.fetch(`${origin(plan)}/health`).then(async (r) => `${r.status} ${await r.text()}`, (e) => `no answer: ${e.message}`);
    ctx.log(`preview: slot ${plan.n}: ${lease.staging ? 'staging' : 'marked staging in the inventory, NOT converted yet'}\n  serving ${lease.serving} (deploy ${lease.deploy})\n  app     ${origin(plan)}: /health ${health}`);
  } else {
    throw new Error('usage: pnpm preview staging <convert|deploy|status> [--paid] [--var K=V]...');
  }
}
