# packages/create-fletch

`create-fletch`, private and not yet published: the one command that sets fletch up on an owner's Cloudflare
account. It checks the token's scopes, writes `wrangler.jsonc`, ensures the bucket and the memory index, runs
`wrangler deploy`, sets `MASTER_KEY` and `SETUP_TOKEN` only when missing, and prints the URL. It runs from a fletch
checkout: the config it writes points `main` at the checkout's agent.

## The one rule

Refuse before touching anything. Every input is validated (`NAME_INVALID`, `OWNER_EMAIL_INVALID`,
`ACCOUNT_ID_INVALID`, `TOKEN_MISSING`, `INIT_OWNER_CHANGE`) and the token's scopes checked (`TOKEN_SCOPE_MISSING`)
before the first call that writes.

## Rules

All in `packages/create-fletch/test/init.test.ts`:

- The token comes from `CLOUDFLARE_API_TOKEN` or a hidden prompt, never a flag, and is never printed; nor is
  `MASTER_KEY`. The setup link is printed only by the run that minted the setup token.
- A second run creates nothing and puts no secret. A `wrangler.jsonc` it did not write (no `CONFIG_HEADER`) is
  never overwritten (`INIT_CONFIG_EXISTS`); the owner never changes (`INIT_OWNER_CHANGE`).
- A failed deploy sets no secret (`DEPLOY_FAILED`); a 403 on a create or deploy is `TOKEN_SCOPE_MISSING`; a local
  failure is `INIT_FAILED`, any other API status `CLOUDFLARE_API_ERROR`.
- `src/template/wrangler.jsonc` matches `packages/agent/wrangler.jsonc` on everything the agent declares; change
  them together. `--paid` adds the Worker Loader and Images bindings.
- The template fill is literal.

## Running it

`pnpm create-fletch` from the root, always with `--dir` (AGENTS.md, gotcha 6). The live exit test,
`test/live/f1-deploy.live.test.ts`, drives `init()` against a throwaway account (`docs/runbooks/live-deploy.md`).

## Keep this file true

Update it in the same PR as a change that makes a line untrue.
