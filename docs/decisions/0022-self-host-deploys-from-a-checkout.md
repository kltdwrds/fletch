---
id: D-0022
title: pnpm self-host deploys the agent from a fletch checkout on the owner's wrangler login; there is no setup package
status: accepted
door: two-way
decided: 2026-10-30
decider: agent
confirmation: scripts/self-host.test.mjs
revisit-when: someone wants fletch without cloning, or the first owner other than Kyle sets one up
supersedes: D-0005
---
Ruling: an owner deploys fletch by running `pnpm self-host` in a clone of this repository after `wrangler login`: it
writes `packages/agent/wrangler.self-host.jsonc` with `main` at the checkout's `src/index.ts` and runs the checkout's
`wrangler deploy`, on the owner's own login, with no API token read or handled; `packages/create-fletch/` and the live
lane that tested it are deleted, and the provisioning exports of `@qyvr/host-cloudflare` (`CloudflareApi`,
`tokenScopes`, `ensureBucket`, `ensureVectorIndex`, `listSecrets`, `putSecret`, `workersDevUrl`, `mintMasterKey`,
`mintSetupToken`) stay as published — because a deploy from a checkout needs no token scopes, no
template kept in step with the agent's config and no published agent, and the deploy is built on the preview
scripts' wrangler runner and config derivation instead of a second copy of them — if wrong, every owner must clone
the repository and keep it to update, and the end-to-end deploy has no automated proof until a lane is rebuilt on
`pnpm self-host` (today the proof is Kyle's own run).

## Context

D-0005 ruled the same checkout shape for `create-fletch`, which also checked an API token's scopes, filled a template
copy of the agent's config, and called Cloudflare's API through `@qyvr/host-cloudflare`. Its live exit test never ran.
`pnpm preview` already deployed the agent from a checkout on a wrangler login, with a config derived from the
agent's own `wrangler.jsonc`. A packaged setup that needs no checkout (`npm create fletch`, a hosted one-click) is the
platform's later work; the provisioning library it would use stays published, because removing published API is a
one-way door.

## Options

- **Chosen:** `pnpm self-host` from a checkout on the wrangler login, reusing the preview scripts.
- Rejected: keep `create-fletch` (a token flow, a template and a package for one owner who already has a checkout);
  publish the agent as a package now (work the first deploys do not need); remove the provisioning exports (a breaking
  change to a published package for no gain).
