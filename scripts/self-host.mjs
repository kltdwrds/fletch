#!/usr/bin/env node
// `pnpm self-host`: fletch on the owner's own Cloudflare account, deployed from this checkout on their own wrangler
// login (docs/runbooks/self-host.md, D-0022). No API token is read or handled: wrangler runs with every credential and
// account variable removed from its environment (`selfHostEnv`). In order, and refusing by name before anything is made:
//   1. the arguments (scripts/self-host-plan.mjs) and the deploy's config from packages/agent/wrangler.jsonc
//      (SELF_HOST_CONFIG_INVALID), and the owner a previous run deployed this name for (SELF_HOST_OWNER_CHANGE);
//   2. `wrangler whoami --json` (SELF_HOST_NOT_LOGGED_IN);
//   3. the R2 bucket `<name>-agent` and the Vectorize index `<name>-memory`, each made only when the account lacks it,
//      an existing index kept only with the agent's shape (SELF_HOST_INDEX_SHAPE);
//   4. packages/agent/wrangler.self-host.jsonc written and `wrangler deploy` from there, the URL read from wrangler's
//      output file (SELF_HOST_DEPLOY_FAILED, with wrangler's last lines, for any failed wrangler step);
//   5. MASTER_KEY and SETUP_TOKEN set only when the Worker lacks them, in one `wrangler secret bulk` on stdin, and the
//      setup link printed only by the run that minted the token (D-0023). A second run redeploys and sets nothing.
// It reads the account and runs wrangler through scripts/preview-pool.mjs's helpers, as `pnpm preview` does.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { configText, jsonOut, mintSecrets, subdomainIn, workersDevTarget } from './preview-plan.mjs';
import { account, agentDir, deployWith, tailOf, wranglerRunner } from './preview-pool.mjs';
import { indexShapeProblem, parseSelfHostArgs, priorOwner, SELF_HOST_CONFIG, secretsToMint, selfHostConfig, selfHostEnv, setupLink } from './self-host-plan.mjs';

const refuse = (code, reason) => ({ ok: false, code, reason });

/**
 * One run for `opts` (parsed arguments) over `ctx`: `root` (the checkout), `run` (a wrangler runner), `readRaw` (the
 * base config's raw reader), `read` (a file's text, or null when there is none), `write` (a file writer) and `log`.
 * Returns `{ ok: true, url }` or `{ ok: false, code, reason }`. Never logs a secret but the setup link, once.
 */
export async function selfHost(ctx, opts) {
  const { name } = opts;
  const dir = agentDir(ctx.root);
  const configFile = path.join(dir, SELF_HOST_CONFIG);
  let config;
  try {
    config = selfHostConfig(ctx.readRaw(path.join(dir, 'wrangler.jsonc')), opts);
  } catch (e) {
    return refuse('SELF_HOST_CONFIG_INVALID', `packages/agent/wrangler.jsonc cannot become a self-host config: ${e.message}`);
  }
  let prior;
  try {
    prior = priorOwner(ctx.read(configFile), name, opts.ownerEmail);
  } catch (e) {
    return refuse('SELF_HOST_CONFIG_INVALID', `packages/agent/${SELF_HOST_CONFIG}, written by an earlier run, is not JSON (${e.message}); delete it and run again with the deploy's owner`);
  }
  if (prior?.changed) {
    return refuse(
      'SELF_HOST_OWNER_CHANGE',
      `${name} was deployed for ${prior.owner}, and this run names ${opts.ownerEmail.trim().toLowerCase()}. The owner is the one account that can sign in, so this would lock ${prior.owner} out. Run again with --owner-email ${prior.owner}; to hand the deploy to another owner on purpose, before its first passkey (docs/runbooks/self-host.md, step 4), delete packages/agent/${SELF_HOST_CONFIG} first`,
    );
  }
  try {
    if (ctx.run(['whoami', '--json']).status !== 0) {
      return refuse('SELF_HOST_NOT_LOGGED_IN', 'wrangler is not logged in to Cloudflare: run `pnpm exec wrangler login` in this checkout, then run this again');
    }
    const acc = account(ctx.run, { label: 'self-host', owns: (n) => n === name || n.startsWith(`${name}-`) });
    let listed = acc.listed();
    for (const [kind, what, resource] of [
      ['r2', 'R2 bucket', `${name}-agent`],
      ['vectorize', 'Vectorize index', `${name}-memory`],
    ]) {
      let made = false;
      if (!acc.has(listed, kind, resource)) {
        try {
          acc.create(kind, resource);
          made = true;
        } catch (e) {
          // Made meanwhile by someone else (or by a run that died after making it): already there is what was asked.
          listed = acc.listed();
          if (!acc.has(listed, kind, resource)) throw e;
        }
      }
      if (kind === 'vectorize' && !made) {
        const problem = indexShapeProblem(jsonOut(acc.ok(ctx.run(['vectorize', 'get', resource, '--json']), `reading Vectorize ${resource}`)));
        if (problem) {
          return refuse('SELF_HOST_INDEX_SHAPE', `the Vectorize index ${resource} already exists, but ${problem}, so it cannot hold this deploy's memory. Pick another --name, or delete it (\`pnpm exec wrangler vectorize delete ${resource}\`) if nothing in it is needed`);
        }
      }
      ctx.log(`${what} ${resource}: ${made ? 'ready.' : 'already there, kept.'}`);
    }

    ctx.write(configFile, configText(config, 'scripts/self-host.mjs'));
    ctx.log(`Deploying ${name} from this checkout (packages/agent/${SELF_HOST_CONFIG})…`);
    const deployed = deployWith(ctx.run, dir, SELF_HOST_CONFIG);
    if (deployed.status !== 0) return refuse('SELF_HOST_DEPLOY_FAILED', `wrangler deploy failed:\n${tailOf(deployed.out, 20)}`);
    const sub = subdomainIn(deployed.out, name);
    const url = workersDevTarget(deployed.ndjson) ?? (sub ? `https://${name}.${sub}.workers.dev` : null);
    if (!url) return refuse('SELF_HOST_DEPLOY_FAILED', `wrangler deployed ${name} but named no workers.dev URL for it; no secret was set. Check the account's workers.dev subdomain (Workers & Pages in the dashboard) and run again`);

    const minted = mintSecrets(secretsToMint(acc.secretNames(name)));
    if (Object.keys(minted).length > 0) acc.secrets(name, minted);
    ctx.log(`MASTER_KEY: ${minted.MASTER_KEY ? 'set (a new random key; it is never shown)' : 'already set, kept'}.`);
    ctx.log(`SETUP_TOKEN: ${minted.SETUP_TOKEN ? 'set (a new random token, in the link below)' : 'already set, kept'}.`);
    ctx.log('');
    ctx.log(`fletch is deployed: ${url}`);
    if (minted.SETUP_TOKEN) {
      ctx.log('Open this link to register your passkey. It is shown only now, so keep it until you have signed in:');
      ctx.log(setupLink(url, minted.SETUP_TOKEN));
    } else {
      ctx.log('The setup link was printed by the run that set SETUP_TOKEN and cannot be shown again. If no passkey was');
      ctx.log(`registered yet, set a new token with \`pnpm exec wrangler secret put SETUP_TOKEN --name ${name}\` and open the deploy's /login with it as the \`setup\` parameter.`);
    }
    return { ok: true, url };
  } catch (e) {
    return refuse('SELF_HOST_DEPLOY_FAILED', e.message);
  }
}

async function main(argv) {
  const opts = parseSelfHostArgs(argv);
  if (opts.refusal) return opts.refusal;
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
  let readRawConfig;
  let run;
  try {
    readRawConfig = createRequire(path.join(root, 'package.json'))('wrangler').experimental_readRawConfig;
    run = wranglerRunner(root, selfHostEnv(process.env, opts.accountId), 'self-host');
  } catch (e) {
    return { code: 'SELF_HOST_WRANGLER_MISSING', reason: `wrangler is not installed in this checkout; run \`pnpm install\`, then run this again (${e.message})` };
  }
  const r = await selfHost(
    {
      root,
      run,
      readRaw: (config) => readRawConfig({ config }).rawConfig,
      read: (file) => (existsSync(file) ? readFileSync(file, 'utf8') : null),
      write: (file, text) => writeFileSync(file, text, { mode: 0o600 }),
      log: console.log,
    },
    opts,
  );
  return r.ok ? null : r;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const fail = ({ code, reason }) => {
    console.error(`self-host: ${code}: ${reason}`);
    process.exitCode = 1;
  };
  main(process.argv.slice(2)).then(
    (refusal) => refusal && fail(refusal),
    (e) => fail({ code: 'SELF_HOST_DEPLOY_FAILED', reason: e.message }),
  );
}
