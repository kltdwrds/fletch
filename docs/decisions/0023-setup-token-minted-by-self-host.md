---
id: D-0023
title: The first passkey on a deploy needs a one-time setup token minted by pnpm self-host
status: accepted
door: one-way
decided: 2026-10-31
decider: Kyle
confirmation: scripts/self-host.test.mjs, packages/host-cloudflare/test/passkeys-routes.test.ts
review-by: 2026-12-31
revisit-when: a deploy can be claimed some other way (an identity provider, a signed claim)
supersedes: D-0002
---
Ruling: registering the first passkey requires the `SETUP_TOKEN` Worker secret that `pnpm self-host` mints (32 random
bytes, base64url) only when the Worker lacks it and prints once, as `<url>/login?setup=<token>`, on the run that minted
it; with no token configured, registration fails closed, and after the first passkey the token grants nothing —
because a fresh deploy sits on a public `workers.dev` address and would otherwise belong to its first visitor — if
wrong, anyone who finds the address before the owner owns the agent and its keys.

## Context

D-0002 made this ruling with `create-fletch` as the minter. `create-fletch` is deleted (D-0022) and `pnpm self-host`
mints the token the same way, so D-0002's ruling named a command that no longer exists; this record replaces it.
Kyle accepted it in chat on 2026-10-31 (Q36). Its substance, the login gate in `@qyvr/host-cloudflare`
(`packages/host-cloudflare/test/passkeys-routes.test.ts`), is unchanged. The link is a credential: `pnpm self-host`
never prints it but on the minting run, never prints `MASTER_KEY`, and passes both to `wrangler secret bulk` on stdin.

## Options

- **Chosen:** a one-time secret, minted at the first deploy, required for the first registration only.
- Rejected: first visitor wins (unsafe on a public URL); Cloudflare Access in front (a second product to set up,
  against the ten-minute promise); printing the link on every run (it would sit in every terminal scrollback).
