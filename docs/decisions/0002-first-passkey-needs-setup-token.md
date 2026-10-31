---
id: D-0002
title: The first passkey on a deploy needs a one-time setup token minted by create-fletch
status: superseded
superseded-by: D-0023
door: one-way
decided: 2026-10-20
decider: inherited
confirmation: packages/host-cloudflare/test/passkeys-routes.test.ts
review-by: 2026-11-21
revisit-when: a deploy can be claimed some other way (an identity provider, a signed claim)
---
Ruling: registering the first passkey requires the `SETUP_TOKEN` Worker secret that `create-fletch` mints and prints
once; with no token configured, registration fails closed, and after the first passkey the token grants nothing —
because a fresh deploy sits on a public `workers.dev` address and would otherwise belong to its first visitor — if
wrong, anyone who finds the address before the owner owns the agent and its keys.

## Context

`create-fletch` deploys to `https://<name>.<subdomain>.workers.dev` before any passkey exists. The setup link
(`/login?setup=<token>`) is shown once, by the run that minted the token, and cannot be read back; a lost link is
replaced with `wrangler secret put SETUP_TOKEN`.

## Options

- **Chosen:** a one-time secret, minted at deploy, required for the first registration only.
- Rejected: first visitor wins (unsafe on a public URL); Cloudflare Access in front (a second product to set up,
  against the ten-minute promise).

## Consequences

The setup link is a credential: it is never logged or written to a file (`packages/create-fletch/test/init.test.ts`).
