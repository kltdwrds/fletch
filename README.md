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
pnpm check
pnpm accept F1
```

`pnpm accept <F<n>|F<n>.<p>>` runs lint, the hermetic tests, the agent's dry-run bundle, the secret and privacy
scans, the harness checks and typecheck, in that order, and ends with one `ACCEPT <id>: PASS` or
`ACCEPT <id>: FAIL (<step>)` line.

## Set up your own fletch (about ten minutes)

You need a Cloudflare account (the free plan works), Node 24.19 or newer, and pnpm.

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
   checkout: gitignored there as `/wrangler.jsonc`, and it holds your account id and email. Without the flags it asks for the name, your email, the account id and the token (input
   hidden). The token is read from the environment only, never from an argument.

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
Whether the free plan accepts those bindings is an open question; see docs/DECISIONS.md.

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

Releases: add a changeset (`pnpm changeset`); every merge to `main` runs `pnpm check`, then the release workflow
builds the two primitives and publishes the versions the changesets name (`pnpm release`).

## Origin

The agent, its tests and the acceptance harness were copied from qyvr-co at commit `81f55d0` (qyvr-co 81f55d0),
with the platform's code (dispatcher, tail, mail and provisioning Workers, the upstream workspace adapter, the
staging probes and the render sidecar) left behind.
