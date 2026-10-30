# fletch

A self-hostable personal agent on Cloudflare, and the plain TypeScript primitives it runs on.

- `packages/agent` (`fletch-agent`, private): the agent Worker and its Durable Objects.
- `packages/host` (`@qyvr/host`): host contracts and logic with no platform imports.
- `packages/host-cloudflare` (`@qyvr/host-cloudflare`): the Cloudflare Durable Object implementation, and the
  provisioning library for one account (token scopes, bucket, memory index, Worker secrets).
- `pnpm self-host` (`scripts/self-host.mjs`): the one command that deploys fletch from this checkout to your account.

Apache-2.0. Contributions need a DCO sign-off (`git commit -s`).

```
pnpm install
pnpm verify
pnpm accept F1
```

`pnpm check` is the fast gate (lint, the harness checks and scans, typecheck) that the pre-push hook runs;
`pnpm verify` adds the tests and is what CI runs on a pull request that touches code (a docs-only one runs `pnpm check`). Working on fletch, with an agent or without: start at `AGENTS.md`.

`pnpm accept <F<n>|F<n>.<p>>` runs lint, the hermetic tests, the agent's dry-run bundle, the secret and privacy
scans, the harness checks and typecheck, in that order, and ends with one `ACCEPT <id>: PASS` or
`ACCEPT <id>: FAIL (<step>)` line.

## Set up your own fletch (aimed at ten minutes)

You need a Cloudflare account (the free plan is the target; not yet verified, see docs/runbooks/free-plan-spike.md),
Node 24.19 or newer, pnpm, and a clone of this repository: the deploy is built from the checkout's
`packages/agent/src/index.ts`, and running the command again from an updated checkout is how you update. Nobody has
timed this path on a real account yet. A packaged setup that needs no checkout is later work, for the platform.

1. **Clone, install and log in.** `wrangler login` opens Cloudflare in your browser; the deploy runs on that login,
   so there is no API token to make or paste. Open Workers & Pages in the dashboard once if you have never chosen a
   `workers.dev` subdomain.

   ```
   git clone https://github.com/qyvr-ai/fletch && cd fletch
   pnpm install
   pnpm exec wrangler login
   ```

2. **Deploy.**

   ```
   pnpm self-host --name sam --owner-email sam@solo-sam.example
   ```

   `--name` names the Worker (`https://<name>.<your-subdomain>.workers.dev`), its R2 bucket `<name>-agent`, its
   Vectorize index `<name>-memory` and the agent's tenant: 2 to 31 characters of a-z, 0-9 and `-`, starting with a
   letter. `--owner-email` is the one address that can sign in. If your login reaches several accounts, add
   `--account-id <32 hex>` (`pnpm exec wrangler whoami` lists them).

What it does, in order: checks the arguments (`SELF_HOST_NAME_INVALID`, `SELF_HOST_EMAIL_INVALID`,
`SELF_HOST_VAR_UNKNOWN` and the others in the runbook), that a rerun names the same owner (`SELF_HOST_OWNER_CHANGE`)
and that wrangler is logged in (`SELF_HOST_NOT_LOGGED_IN`) before anything is made; makes the bucket and the index
when the account lacks them; writes `packages/agent/wrangler.self-host.jsonc` (git-ignored:
it holds your account id and email) and runs `wrangler deploy` from it; sets the `MASTER_KEY` and `SETUP_TOKEN`
Worker secrets when the Worker lacks them; and prints `fletch is deployed: <url>`. A failed wrangler step stops it
with `SELF_HOST_DEPLOY_FAILED` and wrangler's last lines. Every refusal is one line, `self-host: <CODE>: <reason>`,
with exit code 1. The steps, what you see and how to undo it: `docs/runbooks/self-host.md`.

### The setup link

The first run prints one link, `https://<name>.<your-subdomain>.workers.dev/login?setup=<token>`. Open it and
register your passkey: that link is the only way to claim a fresh deploy, so nobody who finds the public URL can
take it. It is shown once, by the run that minted the `SETUP_TOKEN`, and it cannot be read back. Keep it until you
have signed in. If you lose it before registering, set a new one with
`pnpm exec wrangler secret put SETUP_TOKEN --name <name>` and open `/login?setup=<that value>`.

### The recovery code

When your first passkey is registered the page shows a recovery code, once. Keep it somewhere safe (a password
manager). If you lose the passkey, `/login` takes the code and signs you in just far enough to add a new passkey;
that spends the code and shows a fresh one. Only a hash of the code is stored (in the agent's own storage, never in
`wrangler.jsonc`).

### Running it again

Run the same command again whenever you like. A second run makes nothing, sets no secret and prints no setup link:
it redeploys the Worker from the checkout, so after a `git pull` it is also how you update. It writes the generated
config whole each time, so repeat `--paid` and every `--var` (one left out is dropped) and give the same
`--owner-email`: the deploy's passkeys, sessions and recovery code belong to that address, so another is refused
with `SELF_HOST_OWNER_CHANGE`.

### Models

By default every model call goes to Workers AI over the Worker's `AI` binding: no provider key, and the usage counts
against your account's Workers AI allowance. Optionally, two vars send every call through an AI Gateway and the chat
route to Meta's Muse Spark:

| Var | Meaning | Default |
|---|---|---|
| `AI_GATEWAY_ID` | An AI Gateway in your account. When set, every Workers AI call goes through it with its log collection off, and the chat route may use a gateway provider. | unset: the binding direct |
| `CHAT_PROVIDER` | `workers-ai` or `meta`. `meta` sends the chat route to Muse Spark 1.3 Contributor through the gateway's custom provider `meta` (base URL `https://api.meta.ai/v1`), with the Meta key stored on the gateway (bring your own key). Requires `AI_GATEWAY_ID`. The Contributor tier sends each chat's content to Meta, which may train on it: it is meant for eval slots on test identities, not an owner's deploy. | `workers-ai` |

There is no fallback model: a failed Muse Spark call is reported by name, never re-sent to Workers AI. A value the
agent cannot serve (`meta` without a gateway, or any other provider) fails every model call with
`MODEL_CONFIG_INVALID` and a reason naming the var. Set them with `--var`, for example
`pnpm self-host --name sam --owner-email … --var AI_GATEWAY_ID=<gateway id> --var CHAT_PROVIDER=meta`: they are the
only vars `--var` takes, `pnpm self-host` refuses a value the agent cannot serve (`SELF_HOST_VAR_INVALID`), and a
run without them leaves them out.

### A custom hostname is a second step

The deploy lives on `workers.dev` first, so that setup needs no domain. To use your own hostname (a domain whose
DNS is on this Cloudflare account), add a route to `packages/agent/wrangler.self-host.jsonc` and deploy that file:

```
"routes": [{ "pattern": "agent.example.com", "custom_domain": true }]
```

```
cd packages/agent && WRANGLER_BUILD_CONDITIONS=development,workerd,worker,browser pnpm exec wrangler deploy -c wrangler.self-host.jsonc
```

Two things to know. Passkeys are bound to the hostname they were made on, so on the new hostname sign in with your
recovery code at `/login` and add a passkey there. And `pnpm self-host` writes the whole file on every run, so a
later run drops your route: keep the route lines somewhere and re-add them (or deploy with wrangler as above).

### `--paid`

Code Mode (the Worker Loader binding) and HEIC-to-JPEG conversion (the Images binding) need the Workers Paid
plan, so they are not in the base config. `pnpm self-host --paid` adds the `LOADER` and `IMAGES` bindings. Without them, Code
Mode refuses with `HOST_CODE_UNAVAILABLE` and a HEIC upload with `HOST_IMAGES_UNAVAILABLE`, each with its reason.
Whether the free plan accepts those bindings is an open question; see docs/runbooks/free-plan-spike.md.

## What is not in this build, and why

A self-hosted fletch is one owner on one Cloudflare account. These features belong to a multi-tenant platform or
need a service this build does not run. Each is refused with a `HOST_<FEATURE>_UNAVAILABLE` code and a reason that
the UI shows; none is shown as empty or as success when it failed.

- **Mail** (`HOST_MAIL_UNAVAILABLE`): sending and receiving needs a mail domain and routing set up on your
  account, which `pnpm self-host` does not do.
- **Workspace** (`HOST_WORKSPACE_UNAVAILABLE`, and provisioning): the shared team workspace is a platform service.
- **Browser and render** (`HOST_RENDER_UNAVAILABLE`): page rendering ran in a browser sidecar that is left out.
- **Access members** (`HOST_MEMBERS_UNAVAILABLE`): syncing a team's members into Cloudflare Access is a platform
  feature; a self-host has exactly one member, the owner, who signs in with a passkey.
- **Code Mode and Images** (`HOST_CODE_UNAVAILABLE`, `HOST_IMAGES_UNAVAILABLE`): paid-plan bindings, present only
  with `--paid`. AVIF conversion is Enterprise-only and is refused either way.

## Working in this repository

The primitives are published as built packages (`dist/`), but inside the workspace everything runs from source:
`@qyvr/host` and `@qyvr/host-cloudflare` export `./src/index.ts` under the `development` condition, which
`tsconfig.base.json` (`customConditions`), vitest, `pnpm dev` (`node --conditions=development`) and the
wrangler bundles (`WRANGLER_BUILD_CONDITIONS`, in `pnpm accept`, `pnpm preview` and `pnpm self-host`) all ask for. So
`pnpm check` needs no build. If you run a workspace script with plain `node` and see a missing `dist/`, pass
`--conditions=development` or run `pnpm -r --filter "./packages/host*" build`.

Releases: add a changeset (`pnpm changeset`); every merge to `main` runs `pnpm verify`, then the release workflow
builds the two primitives and publishes the versions the changesets name (`pnpm release`). Until the repository
has an `NPM_TOKEN` secret the workflow warns and skips publishing; nothing has been published yet.

## Origin

The agent, its tests and the acceptance harness were copied from qyvr-co at commit `81f55d0` (qyvr-co 81f55d0),
with the platform's code (dispatcher, tail, mail and provisioning Workers, the upstream workspace adapter, the
staging probes and the render sidecar) left behind.
