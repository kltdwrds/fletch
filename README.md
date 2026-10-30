# fletch

A self-hostable personal agent on Cloudflare, and the plain TypeScript primitives it runs on.

- `packages/agent` (`fletch-agent`, private): the agent Worker and its Durable Objects.
- `packages/host` (`@qyvr/host`): host contracts and logic with no platform imports.
- `packages/host-cloudflare` (`@qyvr/host-cloudflare`): the Cloudflare Durable Object implementation, and the
  provisioning library for one account (token scopes, bucket, memory index, Worker secrets).
- `packages/create-fletch` (`create-fletch`, private): the one command that sets fletch up on your account.

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

## F1 exit test: written, not yet run

`test/live/f1-deploy.live.test.ts` deploys a Worker named `fletch-ci-<run id>` into a throwaway Cloudflare account,
walks the ten-minute path (health, passkey with a setup token, recovery code, a memory round trip, the last-passkey
rule), prints the wall-clock time, and deletes the Worker, bucket and index. It has not been run yet. To run it:

```
QYVR_LIVE=1 CF_LIVE_ACCOUNT_ID=... CF_LIVE_TOKEN=... pnpm vitest run test/live/f1-deploy.live.test.ts
```

`pnpm accept F1` runs it as its `live` step under the same variables and otherwise prints `live: skipped (no account)`.
The tag `v0.1.0` follows a passing run. See `docs/runbooks/live-deploy.md`.

The run leaves objects in the bucket `<name>-agent` (the agent keeps MEMORY.md there), and R2's API cannot empty a bucket,
so the cleanup prints a warning naming that bucket; the run still passes. Any other leftover fails it. Delete the bucket
by hand before the next run, or that run's sweep fails on it: Dashboard, R2, the bucket, delete its objects, then delete
the bucket. `pnpm live-sweep` (same two variables) removes every other `fletch-ci-` leftover.

## Set up your own fletch (aimed at ten minutes)

You need a Cloudflare account (the free plan is the target; not yet verified (see docs/runbooks/live-deploy.md)), Node 24.19
or newer, and pnpm. Nobody has timed this path on a real account yet: the F1 exit test above measures it.

1. **Make an API token.** Cloudflare dashboard, My Profile, API Tokens, Create Token. Give it these permissions on
   your account: Workers Scripts (Edit), Workers R2 Storage (Edit), Vectorize (Edit) and Workers AI (Read). Note
   your 32-character account id (Workers & Pages, right-hand column). Open Workers & Pages once if you have never
   chosen a `workers.dev` subdomain.
2. **Clone and install.**

   ```
   git clone https://github.com/qyvr-ai/fletch && cd fletch
   pnpm install
   ```

3. **Run create-fletch** from a directory of your own (the config it writes holds your account id and email, so
   keep it out of the checkout):

   ```
   mkdir ~/my-fletch && cd ~/my-fletch
   CLOUDFLARE_API_TOKEN=... pnpm --dir ~/path/to/fletch create-fletch \
     --name sam --owner-email sam@solo-sam.example --account-id <32-hex account id> --dir ~/my-fletch [--paid]
   ```

   Give `--dir`. Without it the config is written to the directory pnpm was run from (`INIT_CWD`), which with
   `pnpm --dir` is where you stand, but if you run `pnpm create-fletch` inside the checkout it lands in the
   checkout: gitignored there as `/wrangler.jsonc`, and it holds your account id and email.

   Without the flags it asks for the name, your email, the account id and the token (input hidden). The token is
   read from the environment only, never from an argument.

`npm create fletch` will do the same without a checkout once `create-fletch` is published; today it runs from a
checkout, because the `wrangler.jsonc` it writes sets `main` to this checkout's `packages/agent/src/index.ts` and
`wrangler deploy` bundles the agent from there.

What it does, in order: checks the token (a token that is not valid is refused as `TOKEN_INVALID`; one without a
permission it can see is missing is refused with `TOKEN_SCOPE_MISSING` naming the scope, before anything is
created), writes `wrangler.jsonc`, ensures the R2 bucket `<name>-agent` and the Vectorize index `<name>-memory`,
runs `wrangler deploy`, sets the `MASTER_KEY` and `SETUP_TOKEN` Worker secrets when the Worker lacks them, and
prints your `workers.dev` URL.

The permission check reads: it proves the token can see R2, Vectorize, Workers Scripts and Workers AI, not that it
can change them. A token that reads but cannot edit is still caught, one step later and by name: a refused bucket
or index create, or a refused deploy, ends as `TOKEN_SCOPE_MISSING` for that scope. Nothing is half-hidden; fix
the token and run again.

### The setup link

The first run prints one link, `https://<name>.<your-subdomain>.workers.dev/login?setup=<token>`. Open it and
register your passkey: that link is the only way to claim a fresh deploy, so nobody who finds the public URL can
take it. It is shown once, by the run that minted the `SETUP_TOKEN`, and it cannot be read back. Keep it until you
have signed in. If you lose it before registering, set a new one with `wrangler secret put SETUP_TOKEN` and open
`/login?setup=<that value>`.

### The recovery code

When your first passkey is registered the page shows a recovery code, once. Keep it somewhere safe (a password
manager). If you lose the passkey, `/login` takes the code and signs you in just far enough to add a new passkey;
that spends the code and shows a fresh one. Only a hash of the code is stored (in the agent's own storage, never in
`wrangler.jsonc`).

### Running it again

Run the same command again whenever you like. A second run creates nothing, rotates no secret, and prints the
same URL (it redeploys the Worker from the checkout, so it is also how you update). It refuses with
`INIT_CONFIG_EXISTS` rather than overwrite a `wrangler.jsonc` it did not write, and with `INIT_FAILED` for a
local failure such as an unwritable directory.

The owner cannot be changed by running it again. If the `wrangler.jsonc` in `--dir` names another `OWNER_EMAIL`,
it refuses with `INIT_OWNER_CHANGE` before calling Cloudflare: the deploy's passkeys, sessions and recovery code
belong to that address, so a new owner would be locked out. Run it with the same `--owner-email`, or set up a new
deploy (another `--name` and `--dir`) for the other address.

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
`MODEL_CONFIG_INVALID` and a reason naming the var. Add both under `vars` in the written `wrangler.jsonc` and deploy
that file as in the custom hostname step below.

### A custom hostname is a second step

The deploy lives on `workers.dev` first, so that setup needs no domain. To use your own hostname (a domain whose
DNS is on this Cloudflare account), add a route to the written `wrangler.jsonc` and deploy that file:

```
"routes": [{ "pattern": "agent.example.com", "custom_domain": true }]
```

```
CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... pnpm --dir ~/path/to/fletch exec wrangler deploy --config ~/my-fletch/wrangler.jsonc
```

Two things to know. Passkeys are bound to the hostname they were made on, so on the new hostname sign in with your
recovery code at `/login` and add a passkey there. And create-fletch writes the whole file on every run, so a
later run drops your route: keep the route lines somewhere and re-add them (or deploy with wrangler as above).

### `--paid`

Code Mode (the Worker Loader binding) and HEIC-to-JPEG conversion (the Images binding) need the Workers Paid
plan, so they are not in the base config. `--paid` adds the `LOADER` and `IMAGES` bindings. Without them, Code
Mode refuses with `HOST_CODE_UNAVAILABLE` and a HEIC upload with `HOST_IMAGES_UNAVAILABLE`, each with its reason.
Whether the free plan accepts those bindings is an open question; see docs/runbooks/free-plan-spike.md.

## What is not in this build, and why

A self-hosted fletch is one owner on one Cloudflare account. These features belong to a multi-tenant platform or
need a service this build does not run. Each is refused with a `HOST_<FEATURE>_UNAVAILABLE` code and a reason that
the UI shows; none is shown as empty or as success when it failed.

- **Mail** (`HOST_MAIL_UNAVAILABLE`): sending and receiving needs a mail domain and routing set up on your
  account, which `create-fletch` does not do.
- **Workspace** (`HOST_WORKSPACE_UNAVAILABLE`, and provisioning): the shared team workspace is a platform service.
- **Browser and render** (`HOST_RENDER_UNAVAILABLE`): page rendering ran in a browser sidecar that is left out.
- **Access members** (`HOST_MEMBERS_UNAVAILABLE`): syncing a team's members into Cloudflare Access is a platform
  feature; a self-host has exactly one member, the owner, who signs in with a passkey.
- **Code Mode and Images** (`HOST_CODE_UNAVAILABLE`, `HOST_IMAGES_UNAVAILABLE`): paid-plan bindings, present only
  with `--paid`. AVIF conversion is Enterprise-only and is refused either way.

## Working in this repository

The primitives are published as built packages (`dist/`), but inside the workspace everything runs from source:
`@qyvr/host` and `@qyvr/host-cloudflare` export `./src/index.ts` under the `development` condition, which
`tsconfig.base.json` (`customConditions`), vitest, `pnpm create-fletch` (`node --conditions=development`) and the
wrangler bundles (`WRANGLER_BUILD_CONDITIONS`, in `pnpm accept` and in create-fletch's deploy) all ask for. So
`pnpm check` needs no build. If you run a workspace script with plain `node` and see a missing `dist/`, pass
`--conditions=development` or run `pnpm -r --filter "./packages/host*" build`.

Releases: add a changeset (`pnpm changeset`); every merge to `main` runs `pnpm verify`, then the release workflow
builds the two primitives and publishes the versions the changesets name (`pnpm release`). Until the repository
has an `NPM_TOKEN` secret the workflow warns and skips publishing; nothing has been published yet.

## Origin

The agent, its tests and the acceptance harness were copied from qyvr-co at commit `81f55d0` (qyvr-co 81f55d0),
with the platform's code (dispatcher, tail, mail and provisioning Workers, the upstream workspace adapter, the
staging probes and the render sidecar) left behind.
