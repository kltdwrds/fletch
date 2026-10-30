# Self-host: fletch on your own Cloudflare account

`pnpm self-host` deploys the agent from this checkout to the owner's own Cloudflare account, on the owner's own
`wrangler login` (D-0022): no API token is made, read or pasted. It makes the deploy's R2 bucket and Vectorize index,
writes the deploy's config, runs `wrangler deploy`, sets the `MASTER_KEY` and `SETUP_TOKEN` Worker secrets once, and
prints the setup link once (D-0023). The code is `scripts/self-host.mjs` (the run) and `scripts/self-host-plan.mjs`
(arguments, the config, which secrets to mint), built on the preview scripts' wrangler runner and config derivation
(`scripts/preview-pool.mjs`, `scripts/preview-plan.mjs`).

## When

- Setting up a new fletch for one owner on one account.
- Updating a deploy after `git pull`: the same command again redeploys the code and changes nothing else.
- Adding the paid-plan bindings (`--paid`, D-0021) or a model var (`--var`).

## Steps

1. From a clone of this repository, install and log wrangler in to the account (a browser window opens). Open
   Workers & Pages in the dashboard once if the account has never chosen a `workers.dev` subdomain.

   ```bash
   pnpm install
   pnpm exec wrangler login
   ```

2. Deploy, naming the deploy and its one owner:

   ```bash
   pnpm self-host --name sam --owner-email sam@solo-sam.example
   ```

   Optional: `--account-id <32 hex>` when the login reaches several accounts (`pnpm exec wrangler whoami` lists
   them; without it wrangler's own error names the choice); `--paid` adds the Worker Loader (`LOADER`) and Images
   (`IMAGES`) bindings, which need the Workers Paid plan; `--var AI_GATEWAY_ID=<gateway id>` sends every model call
   through that AI Gateway, and with it `--var CHAT_PROVIDER=meta` puts chat on the gateway's custom provider `meta`.
   No other var is taken.

3. Open the printed setup link, register a passkey, and keep the recovery code the page shows.

4. To update, pull and run the same command again, with the same `--owner-email`:

   ```bash
   git pull && pnpm install
   pnpm self-host --name sam --owner-email sam@solo-sam.example
   ```

   Each run writes the deploy's config whole from what it is given, so repeat `--paid` and every `--var` each time:
   one left out is dropped from the deploy. A different `--owner-email` is refused (`SELF_HOST_OWNER_CHANGE`); to hand
   the deploy to another owner on purpose, delete the generated config first.

## What you see

A first run prints the bucket and the index as `ready`, the deploy, both secrets as `set`, then
`fletch is deployed: https://sam.<subdomain>.workers.dev` and one setup link,
`https://sam.<subdomain>.workers.dev/login?setup=<token>`. It is shown only by the run that minted the token and
cannot be read back. A second run prints both resources as `already there, kept`, both secrets as
`already set, kept`, the same URL, and no link.

A refusal is one line on stderr, `self-host: <CODE>: <reason>`, with exit code 1:

| Code | Means | Do |
|---|---|---|
| `SELF_HOST_NAME_INVALID` | The name is not 2 to 31 characters of a-z, 0-9 and `-` starting with a letter. | Pick another name. |
| `SELF_HOST_EMAIL_INVALID` | `--owner-email` is missing or not an address. | Give the owner's address. |
| `SELF_HOST_ACCOUNT_INVALID` | `--account-id` is not 32 hexadecimal characters. | Copy it from `pnpm exec wrangler whoami`. |
| `SELF_HOST_NAME_RESERVED` | The name starts with `fletch-pv-`, the preview pool's slots. | Pick another name. |
| `SELF_HOST_VAR_UNKNOWN` | A `--var` other than `AI_GATEWAY_ID` or `CHAT_PROVIDER`, or one without `=`. | Drop it. |
| `SELF_HOST_VAR_INVALID` | `CHAT_PROVIDER` is not `workers-ai` or `meta`, `meta` comes without an `AI_GATEWAY_ID`, or `AI_GATEWAY_ID` is empty. | Fix the value. |
| `SELF_HOST_ARG_UNKNOWN` | An option it does not know, or one without its value. | Check the command against step 2. |
| `SELF_HOST_WRANGLER_MISSING` | wrangler is not installed in this checkout. | `pnpm install`, then run again. |
| `SELF_HOST_CONFIG_INVALID` | packages/agent/wrangler.jsonc has a binding a self-host deploy does not know, or the generated config from an earlier run is not JSON. | Pull a fixed checkout, or delete the generated config. |
| `SELF_HOST_OWNER_CHANGE` | The deploy was made for another owner; this run would lock that owner out. | Run with the first owner's address, or delete the generated config to hand it over. |
| `SELF_HOST_NOT_LOGGED_IN` | `wrangler whoami` finds no login. | `pnpm exec wrangler login`, then run again. |
| `SELF_HOST_INDEX_SHAPE` | `<name>-memory` already exists with other dimensions or another metric than 768 and cosine. | Pick another name, or delete that index if nothing in it is needed. |
| `SELF_HOST_DEPLOY_FAILED` | A wrangler step failed (listing, making, deploying, secrets), with wrangler's last lines, or the deploy named no `workers.dev` URL. No secret is set before the deploy succeeds. | Fix what wrangler said and run again. |

A lost setup link, before any passkey was registered: set a new token and open `/login?setup=<that value>`.

```bash
pnpm exec wrangler secret put SETUP_TOKEN --name sam
```

## Undo

Delete the Worker (its Durable Objects and their data go with it), then the index, then the bucket, which R2 deletes
only once it is empty (Dashboard, R2, the bucket, delete its objects first):

```bash
pnpm exec wrangler delete --name sam
pnpm exec wrangler vectorize delete sam-memory --force
pnpm exec wrangler r2 bucket delete sam-agent
```

The generated config, packages/agent/wrangler.self-host.jsonc, is git-ignored and holds the account id and the owner's email; delete it
too when the deploy is gone.
