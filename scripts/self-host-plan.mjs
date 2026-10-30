// The pure half of `pnpm self-host` (docs/runbooks/self-host.md): its arguments and the refusals each is checked with,
// the deploy's wrangler config derived from the agent's base config through the `deployConfig` a preview slot's shares
// (scripts/preview-plan.mjs), the environment wrangler runs in, the owner a previous run deployed for, the shape the
// memory index must have, which secrets a run mints, and the setup link. No I/O: scripts/self-host.mjs runs wrangler,
// and scripts/self-host.test.mjs tests both.
import { deployConfig, MEMORY_INDEX, PREFIX, SECRETS, wranglerEnv } from './preview-plan.mjs';

/** A deploy's name, which is also its tenant id: the rule `TENANT_ID` in packages/host-cloudflare/src/keys.ts holds. */
export const NAME_RE = /^[a-z][a-z0-9-]{1,30}$/;
/** An owner's address: exactly one @, something on each side, no whitespace. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+$/;
const ACCOUNT_RE = /^[0-9a-f]{32}$/;
/** The vars `--var K=V` may set: how the agent's chat reaches a model (packages/agent/src/model/), nothing else. */
export const SELF_HOST_VAR_KEYS = ['AI_GATEWAY_ID', 'CHAT_PROVIDER'];
/** The chat providers `--var CHAT_PROVIDER=` takes: Workers AI, or `meta` through the gateway's custom provider. */
export const SELF_HOST_CHAT_PROVIDERS = ['workers-ai', 'meta'];
/** The generated config, beside the agent's wrangler.jsonc and git-ignored: it holds the account id and the owner's email. */
export const SELF_HOST_CONFIG = 'wrangler.self-host.jsonc';
/** Every variable wrangler would take a credential or an account from instead of the owner's login (and its legacy CF_ names). */
const CREDENTIAL_VARS = ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_API_KEY', 'CLOUDFLARE_EMAIL', 'CLOUDFLARE_ACCOUNT_ID', 'CF_API_TOKEN', 'CF_API_KEY', 'CF_EMAIL', 'CF_ACCOUNT_ID', 'CLAUDE_CODE_OAUTH_TOKEN'];

export const USAGE = 'usage: pnpm self-host --name <name> --owner-email <email> [--account-id <32 hex>] [--paid] [--var AI_GATEWAY_ID=<id>] [--var CHAT_PROVIDER=meta]';

const refuse = (code, reason) => ({ refusal: { code, reason } });

/**
 * The command line as `{ name, ownerEmail, accountId, paid, vars }`, or `{ refusal: { code, reason } }` for the first
 * thing wrong with it. Nothing here reaches wrangler or the account.
 */
export function parseSelfHostArgs(argv) {
  const values = {};
  const pairs = [];
  let paid = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--paid') paid = true;
    else if (['--name', '--owner-email', '--account-id', '--var'].includes(a)) {
      const v = argv[++i];
      if (v === undefined || v.startsWith('--')) return refuse('SELF_HOST_ARG_UNKNOWN', `${a} needs a value; ${USAGE}`);
      if (a === '--var') pairs.push(v);
      else values[a.slice(2)] = v.trim();
    } else return refuse('SELF_HOST_ARG_UNKNOWN', `${a} is not an option; ${USAGE}`);
  }
  const name = values.name ?? '';
  if (!NAME_RE.test(name)) return refuse('SELF_HOST_NAME_INVALID', `the name "${name}" must be 2 to 31 characters of a-z, 0-9 and -, starting with a letter: it names the Worker, its bucket and index, and the tenant`);
  if (name.startsWith(PREFIX)) return refuse('SELF_HOST_NAME_RESERVED', `names starting with ${PREFIX} are the preview pool's slots (scripts/preview.mjs); a self-host deploy would take over a slot's Worker, bucket and index. Pick another name`);
  const ownerEmail = values['owner-email'] ?? '';
  if (!EMAIL_RE.test(ownerEmail)) return refuse('SELF_HOST_EMAIL_INVALID', ownerEmail ? `"${ownerEmail}" is not an email address` : "--owner-email is required: it names the one account that can sign in");
  const accountId = values['account-id'];
  if (accountId !== undefined && !ACCOUNT_RE.test(accountId)) return refuse('SELF_HOST_ACCOUNT_INVALID', 'the Cloudflare account id is 32 hexadecimal characters (`pnpm exec wrangler whoami` lists yours)');
  const vars = {};
  for (const pair of pairs) {
    const at = pair.indexOf('=');
    const key = at < 1 ? pair : pair.slice(0, at);
    if (at < 1 || !SELF_HOST_VAR_KEYS.includes(key)) return refuse('SELF_HOST_VAR_UNKNOWN', `--var takes K=V with K one of ${SELF_HOST_VAR_KEYS.join(', ')}; not ${JSON.stringify(pair)}`);
    vars[key] = pair.slice(at + 1);
  }
  const invalid = modelVarsProblem(vars);
  if (invalid) return refuse('SELF_HOST_VAR_INVALID', invalid);
  return { name, ownerEmail, accountId, paid, vars };
}

/**
 * What is wrong with the model vars, or null. The agent falls back to Workers AI on a value it does not know
 * (packages/agent/src/model/routes.ts); this refuses earlier, so a typo is named instead of silently ignored.
 */
function modelVarsProblem(vars) {
  if ('AI_GATEWAY_ID' in vars && vars.AI_GATEWAY_ID.trim() === '') return 'AI_GATEWAY_ID may not be empty: give the gateway id, or leave the --var out';
  if ('CHAT_PROVIDER' in vars) {
    if (!SELF_HOST_CHAT_PROVIDERS.includes(vars.CHAT_PROVIDER)) return `CHAT_PROVIDER is one of ${SELF_HOST_CHAT_PROVIDERS.join(', ')}; not ${JSON.stringify(vars.CHAT_PROVIDER)}`;
    if (vars.CHAT_PROVIDER === 'meta' && !vars.AI_GATEWAY_ID?.trim()) return 'CHAT_PROVIDER=meta is reached only through an AI Gateway: add --var AI_GATEWAY_ID=<gateway id>';
  }
  return null;
}

/**
 * The deploy's config from the agent's raw base config: the agent from this checkout (`main` is relative to
 * packages/agent/, where the config is written) as Worker `name`, on its own bucket `<name>-agent` and index
 * `<name>-memory`, its own tenant and owner, the model vars given, the account when one was named, and the paid-plan
 * bindings only with `paid` (D-0021).
 */
export function selfHostConfig(base, { name, accountId, ownerEmail, paid = false, vars = {} }) {
  const strange = Object.keys(vars).filter((k) => !SELF_HOST_VAR_KEYS.includes(k));
  if (strange.length > 0) throw new Error(`self-host: --var takes only ${SELF_HOST_VAR_KEYS.join(', ')}; not ${strange.join(', ')}`);
  const config = deployConfig(base, {
    name,
    r2: { AGENT_BUCKET: `${name}-agent` },
    vectorize: { MEMORY_INDEX: `${name}-memory` },
    vars: { TENANT_ID: name, TENANT_SHAPE: 'standalone', QYVR_ENV: 'self-host', OWNER_EMAIL: ownerEmail, ...vars },
    paid,
    label: 'self-host',
    what: 'a self-host deploy',
  });
  config.main = 'src/index.ts';
  if (accountId) config.account_id = accountId;
  return config;
}

/**
 * The environment wrangler runs in for a self-host run: the owner's own login and nothing else. Every credential and
 * account variable is removed, so the account is the login's own or the one `--account-id` names.
 */
export function selfHostEnv(env, accountId) {
  const clean = { ...env };
  for (const k of CREDENTIAL_VARS) delete clean[k];
  return wranglerEnv(clean, 'oauth', accountId);
}

const normalEmail = (e) => String(e ?? '').trim().toLowerCase();

/**
 * The owner a previous run deployed `name` for, read from the generated config's text (null when there is none, or
 * when it is another deploy's), and whether it differs from `ownerEmail`. Throws on a config that is not JSON.
 */
export function priorOwner(text, name, ownerEmail) {
  if (text == null) return null;
  const prior = JSON.parse(text.replace(/^\s*\/\/.*$/gm, ''));
  if (prior?.name !== name || prior.vars?.OWNER_EMAIL == null) return null;
  const owner = normalEmail(prior.vars.OWNER_EMAIL);
  return { owner, changed: owner !== normalEmail(ownerEmail) };
}

/** What is wrong with an existing memory index's shape (as `wrangler vectorize get --json` prints it), or null. */
export function indexShapeProblem(index) {
  const dimensions = Number(index?.config?.dimensions);
  const metric = index?.config?.metric;
  if (dimensions === MEMORY_INDEX.dimensions && metric === MEMORY_INDEX.metric) return null;
  return `it has ${Number.isFinite(dimensions) ? dimensions : 'unknown'} dimensions and metric ${metric ?? 'unknown'}, and the agent's embeddings need ${MEMORY_INDEX.dimensions} and ${MEMORY_INDEX.metric}`;
}

/** The deploy secrets the Worker does not hold yet; a run sets only these, so a second run rotates nothing (D-0023). */
export const secretsToMint = (existingNames) => SECRETS.filter((n) => !existingNames.includes(n));

/** The link that registers the first passkey (D-0023): printed only by the run that minted the token. */
export const setupLink = (url, token) => `${url}/login?setup=${token}`;
