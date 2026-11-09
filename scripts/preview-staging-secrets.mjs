// `pnpm preview staging secrets` (Kyle's Mac, on his 1Password and gh logins): the one command that gives the staging
// workflow (.github/workflows/deploy-staging.yml) its credentials. It reads the Cloudflare admin token from 1Password,
// mints (or rolls) `fletch-staging-deploy`, an account-owned token that may edit the staging slot's Worker and nothing
// else, reads its policy back and tries it, stores its value in 1Password, sets the three repository secrets the
// workflow reads, and dispatches the workflow (docs/runbooks/preview.md, Staging). No value is ever printed, written to
// disk, put in a child's environment or passed as an argument: a value reaches `op` and `gh` on stdin alone, and the
// Cloudflare API in the one Authorization header that needs it. What it prints is names, ids and refusal codes.
//
// Every outside call goes through `io`: `io.exec(file, args, { input })` for `op` and `gh`, and `io.fetch` for the
// Cloudflare API and the slot's public lease, so the tests (scripts/preview-staging-secrets.test.mjs) plant each failure.
import { spawnSync } from 'node:child_process';
import { origin, refusal, slotPlan } from './preview-plan.mjs';
import { cfClient, editorGroup, liveCheck, resourceShapes, slotWorkers } from './preview-token.mjs';

export const TOKEN_NAME = 'fletch-staging-deploy';
export const ADMIN_REF = 'op://qyvr-prod/Cloudflare admin/credential';
export const VAULT = 'qyvr-staging';
export const ITEM = `Cloudflare ${TOKEN_NAME}`;
export const ITEM_REF = `op://${VAULT}/${ITEM}/credential`;
export const REPO = 'kltdwrds/fletch';
export const WORKFLOW = 'deploy-staging.yml';
/** The repository secrets deploy-staging.yml reads. */
export const SECRET_NAMES = ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID', 'FLETCH_PREVIEW_SUBDOMAIN'];

/** The real io: `op` and `gh` with no shell, a value only ever on stdin, and the global fetch. */
export const realIo = {
  exec: (file, args, { input } = {}) => {
    const r = spawnSync(file, args, { input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    return { status: r.error ? 127 : r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
  },
  fetch: (...a) => fetch(...a),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
};

const sortDeep = (v) => (typeof v === 'object' && v ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortDeep(v[k])])) : v);
const same = (a, b) => JSON.stringify(sortDeep(a)) === JSON.stringify(sortDeep(b));

/** A command's failure without its output: stderr may echo what it was given. */
function must(io, file, args, opts, code, what) {
  const r = io.exec(file, args, opts);
  if (r.status !== 0) throw refusal(code, `${what} failed (\`${file} ${args.slice(0, 2).join(' ')}\` exited ${r.status})`);
  return r.stdout;
}

/** The policy is exactly one allow on the staging Worker through the one Editor group, or it is refused. */
export function policyExact(stored, resources, groupId) {
  const p = stored?.policies?.length === 1 ? stored.policies[0] : null;
  return Boolean(p && p.effect === 'allow' && same(p.resources, resources) && p.permission_groups?.length === 1 && p.permission_groups[0].id === groupId);
}

/** Stores the value as the item's `credential`: created if missing, else edited; the JSON goes on stdin. */
function store(io, value) {
  const got = io.exec('op', ['item', 'get', ITEM, '--vault', VAULT, '--format', 'json']);
  const fields = [{ id: 'credential', label: 'credential', type: 'CONCEALED', purpose: 'PASSWORD', value }];
  if (got.status === 0) {
    const item = JSON.parse(got.stdout);
    const kept = (item.fields ?? []).filter((f) => f.id !== 'credential' && f.label !== 'credential');
    must(io, 'op', ['item', 'edit', item.id, '--vault', VAULT, '--format', 'json'], { input: JSON.stringify({ ...item, fields: [...kept, ...fields] }) }, 'PREVIEW_SECRETS_OP_WRITE', `editing ${ITEM}`);
    return 'edited';
  }
  const template = { title: ITEM, category: 'API_CREDENTIAL', fields };
  must(io, 'op', ['item', 'create', '--vault', VAULT, '--format', 'json'], { input: JSON.stringify(template) }, 'PREVIEW_SECRETS_OP_WRITE', `creating ${ITEM}`);
  return 'created';
}

/**
 * Runs the whole sequence. `inv` is the inventory, `subdomain` the account's workers.dev subdomain. Returns what it did
 * (`{ token: { id, name, created }, stored, secrets, run }`); every line it logs is names and ids.
 */
export async function stagingSecrets({ inv, subdomain, io = realIo, log }) {
  must(io, 'op', ['whoami'], {}, 'PREVIEW_SECRETS_OP_LOGIN', '1Password is not signed in: run `op signin`; checking it');
  must(io, 'gh', ['auth', 'status'], {}, 'PREVIEW_SECRETS_GH_LOGIN', 'gh is not logged in: run `gh auth login`; checking it');
  if (!subdomain) throw refusal('PREVIEW_SECRETS_SUBDOMAIN', 'the workers.dev subdomain is not known here; set FLETCH_PREVIEW_SUBDOMAIN or run on the Mac that provisioned the pool');
  const staging = inv.slots.filter((s) => s.staging === true);
  if (staging.length !== 1) throw refusal('PREVIEW_STAGING_NONE', `the inventory marks ${staging.length} slots staging; it takes exactly one`);
  const plan = slotPlan(staging[0].n, subdomain);
  const lease = await io.fetch(`${origin(plan)}/__preview/lease`).then(
    async (r) => (r.status === 200 ? r.json() : null),
    () => null,
  );
  if (!lease?.staging) throw refusal('PREVIEW_STAGING_NOT_CONVERTED', `slot ${plan.n}'s lease is not staging (or did not answer); run \`pnpm preview staging convert\` first`);

  const worker = slotWorkers({ slots: staging })[0];
  const others = slotWorkers({ slots: inv.slots.filter((s) => s.staging !== true) }).map((w) => w.name);
  const admin = must(io, 'op', ['read', '--no-newline', ADMIN_REF], {}, 'PREVIEW_SECRETS_OP_READ', `reading ${ADMIN_REF}`).trim();
  if (!admin) throw refusal('PREVIEW_SECRETS_OP_READ', `${ADMIN_REF} is empty`);
  const cf = cfClient(io.fetch, admin);
  const base = `accounts/${inv.accountId}/tokens`;
  const group = editorGroup(await cf('GET', `${base}/permission_groups?per_page=1000`));
  const resources = resourceShapes(group.scope, inv.accountId)[0].resources([worker]);
  const body = { name: TOKEN_NAME, policies: [{ effect: 'allow', resources, permission_groups: [{ id: group.id }] }] };
  const existing = (await cf('GET', `${base}?per_page=100`)).find((t) => t.name === TOKEN_NAME);
  let id;
  let value;
  if (existing) {
    id = existing.id;
    await cf('PUT', `${base}/${id}`, { ...body, status: 'active' });
    value = await cf('PUT', `${base}/${id}/value`, {});
  } else ({ id, value } = await cf('POST', base, body));
  const drop = async () => {
    if (!existing) await cf('DELETE', `${base}/${id}`);
  };
  if (typeof value !== 'string' || value === '') throw refusal('PREVIEW_SECRETS_NO_VALUE', `Cloudflare returned no value for ${TOKEN_NAME} (${id})`);
  if (!policyExact(await cf('GET', `${base}/${id}`), resources, group.id)) {
    await drop();
    throw refusal('PREVIEW_SECRETS_POLICY_WIDE', `${TOKEN_NAME} (${id})'s stored policy is not exactly Editor on ${worker.name}${existing ? '; the token is left as stored, roll or delete it in the dashboard' : '; the token was deleted'}`);
  }
  const check = await liveCheck(io.fetch, inv.accountId, value, [worker.name], { sleep: io.sleep });
  for (const n of others) {
    const s = (await io.fetch(`https://api.cloudflare.com/client/v4/accounts/${inv.accountId}/workers/scripts/${n}/settings`, { headers: { authorization: `Bearer ${value}` } })).status;
    if (s === 200) check.problems.push(`reaches slot Worker ${n}`);
  }
  if (check.problems.length > 0) {
    await drop();
    throw refusal('PREVIEW_SECRETS_POLICY_WIDE', `${TOKEN_NAME} (${id}) ${check.problems.join('; ')}`);
  }
  log(`preview: ${existing ? 'rolled' : 'created'} ${TOKEN_NAME} (${id}): ${group.name} on ${worker.name} alone; refused on ${[...others, ...Object.keys(check.denied)].join(', ')}`);

  const stored = store(io, value);
  log(`preview: ${stored} ${ITEM_REF}`);
  const values = { CLOUDFLARE_API_TOKEN: value, CLOUDFLARE_ACCOUNT_ID: inv.accountId, FLETCH_PREVIEW_SUBDOMAIN: subdomain };
  for (const name of SECRET_NAMES) must(io, 'gh', ['secret', 'set', name, '--repo', REPO, '--app', 'actions'], { input: values[name] }, 'PREVIEW_SECRETS_GH_WRITE', `setting ${name}`);
  log(`preview: set ${SECRET_NAMES.join(', ')} on ${REPO} (Actions)`);
  must(io, 'gh', ['workflow', 'run', WORKFLOW, '--ref', 'main', '--repo', REPO], {}, 'PREVIEW_SECRETS_GH_DISPATCH', `dispatching ${WORKFLOW}`);
  const listed = io.exec('gh', ['run', 'list', '--workflow', WORKFLOW, '--repo', REPO, '--event', 'workflow_dispatch', '--limit', '1', '--json', 'databaseId,url']);
  const run = listed.status === 0 ? (JSON.parse(listed.stdout || '[]')[0] ?? null) : null;
  log(`preview: dispatched ${WORKFLOW} on main${run ? `: run ${run.databaseId} ${run.url}` : ' (its run is not listed yet: `gh run list --workflow deploy-staging.yml`)'}`);
  return { token: { id, name: TOKEN_NAME, created: !existing }, stored: ITEM_REF, secrets: SECRET_NAMES, run };
}
