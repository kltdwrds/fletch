#!/usr/bin/env node
// `pnpm self-host`: fletch on the owner's own Cloudflare account, deployed from this checkout on their own wrangler
// login (docs/runbooks/self-host.md, D-0022). No API token is read or handled: wrangler runs with the token variables
// removed from its environment. In order, and refusing by name before anything is made:
//   1. the arguments (scripts/self-host-plan.mjs) and the deploy's config from packages/agent/wrangler.jsonc;
//   2. `wrangler whoami --json` (SELF_HOST_NOT_LOGGED_IN);
//   3. the R2 bucket `<name>-agent` and the Vectorize index `<name>-memory`, each made only when the account lacks it;
//   4. packages/agent/wrangler.self-host.jsonc written and `wrangler deploy` from there, the URL read from wrangler's
//      output file (SELF_HOST_DEPLOY_FAILED, with wrangler's last lines, for any failed wrangler step);
//   5. MASTER_KEY and SETUP_TOKEN set only when the Worker lacks them, in one `wrangler secret bulk` on stdin, and the
//      setup link printed only by the run that minted the token (D-0023). A second run redeploys and sets nothing.
// It reads the account and runs wrangler through scripts/preview-pool.mjs's helpers, as `pnpm preview` does.
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { configText, mintSecrets, subdomainIn, workersDevTarget, wranglerEnv } from './preview-plan.mjs';
import { account, agentDir, deployWith, tailOf, wranglerRunner } from './preview-pool.mjs';
import { parseSelfHostArgs, SELF_HOST_CONFIG, secretsToMint, selfHostConfig, setupLink } from './self-host-plan.mjs';

const refuse = (code, reason) => ({ ok: false, code, reason });

/**
 * One run for `opts` (parsed arguments) over `ctx`: `root` (the checkout), `run` (a wrangler runner), `readRaw` (the
 * base config's raw reader), `write` (a file writer) and `log`. Returns `{ ok: true, url }` or `{ ok: false, code,
 * reason }`. Never logs a secret but the setup link, once.
 */
export async function selfHost(ctx, opts) {
  const { name } = opts;
  const dir = agentDir(ctx.root);
  const config = selfHostConfig(ctx.readRaw(path.join(dir, 'wrangler.jsonc')), opts);
  if (ctx.run(['whoami', '--json']).status !== 0) {
    return refuse('SELF_HOST_NOT_LOGGED_IN', 'wrangler is not logged in to Cloudflare: run `pnpm exec wrangler login` in this checkout, then run this again');
  }
  const acc = account(ctx.run, { label: 'self-host', owns: (n) => n === name || n.startsWith(`${name}-`) });
  try {
    let listed = acc.listed();
    for (const [kind, what, resource] of [
      ['r2', 'R2 bucket', `${name}-agent`],
      ['vectorize', 'Vectorize index', `${name}-memory`],
    ]) {
      if (acc.has(listed, kind, resource)) {
        ctx.log(`${what} ${resource}: already there, kept.`);
        continue;
      }
      try {
        acc.create(kind, resource);
      } catch (e) {
        // Made meanwhile by someone else (or by a run that died after making it): already there is what was asked.
        listed = acc.listed();
        if (!acc.has(listed, kind, resource)) throw e;
      }
      ctx.log(`${what} ${resource}: ready.`);
    }

    ctx.write(path.join(dir, SELF_HOST_CONFIG), configText(config, 'scripts/self-host.mjs'));
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
  const { experimental_readRawConfig } = createRequire(path.join(root, 'package.json'))('wrangler');
  const r = await selfHost(
    {
      root,
      run: wranglerRunner(root, wranglerEnv(process.env, 'oauth', opts.accountId), 'self-host'),
      readRaw: (config) => experimental_readRawConfig({ config }).rawConfig,
      write: (file, text) => writeFileSync(file, text, { mode: 0o600 }),
      log: console.log,
    },
    opts,
  );
  return r.ok ? null : r;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (refusal) => {
      if (refusal) {
        console.error(`self-host: ${refusal.code}: ${refusal.reason}`);
        process.exitCode = 1;
      }
    },
    (e) => {
      console.error(e.message);
      process.exitCode = 1;
    },
  );
}
