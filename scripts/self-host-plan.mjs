// The pure half of `pnpm self-host` (docs/runbooks/self-host.md): its arguments and the refusals each is checked with,
// the deploy's wrangler config derived from the agent's base config through the `deployConfig` a preview slot's shares
// (scripts/preview-plan.mjs), which secrets a run mints, and the setup link. No I/O: scripts/self-host.mjs runs
// wrangler, and scripts/self-host.test.mjs tests both.
import { deployConfig, SECRETS } from './preview-plan.mjs';

/** A deploy's name, which is also its tenant id: the rule `TENANT_ID` in packages/host-cloudflare/src/keys.ts holds. */
export const NAME_RE = /^[a-z][a-z0-9-]{1,30}$/;
/** An owner's address: exactly one @, something on each side, no whitespace. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+$/;
const ACCOUNT_RE = /^[0-9a-f]{32}$/;
/** The vars `--var K=V` may set: how the agent's chat reaches a model (packages/agent/src/model/), nothing else. */
export const SELF_HOST_VAR_KEYS = ['AI_GATEWAY_ID', 'CHAT_PROVIDER'];
/** The generated config, beside the agent's wrangler.jsonc and git-ignored: it holds the account id and the owner's email. */
export const SELF_HOST_CONFIG = 'wrangler.self-host.jsonc';

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
  return { name, ownerEmail, accountId, paid, vars };
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

/** The deploy secrets the Worker does not hold yet; a run sets only these, so a second run rotates nothing (D-0023). */
export const secretsToMint = (existingNames) => SECRETS.filter((n) => !existingNames.includes(n));

/** The link that registers the first passkey (D-0023): printed only by the run that minted the token. */
export const setupLink = (url, token) => `${url}/login?setup=${token}`;
