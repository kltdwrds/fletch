---
id: D-0008
title: Cloud sessions deploy to a fixed pool of preview slots with a token scoped to the slot Workers alone
status: proposed
door: one-way
decided: 2026-10-22
decider: agent
confirmation: scripts/preview-token.test.mjs, scripts/preview-plan.test.mjs
revisit-when: Cloudflare scopes bindings by token, or previews move to an account of their own (docs/plan/QUESTIONS.md, Q3)
---
Ruling: a cloud session deploys fletch only to the pool `fletch-pv-<n>` (`pnpm preview`, `docs/runbooks/preview.md`),
with an account-owned token holding Individual Workers Editor on exactly the slot Workers, and reaches a slot's bucket
and index only through the slot Worker's own bindings — because creating Workers or touching R2 and Vectorize needs
account-wide grants that could also redeploy or delete qyvr.dev production, and Kyle ruled out widening
`qyvr-preview-slots` for that reason — if wrong, the boundary is weaker than it looks (below), and previews belong on
an account of their own.

## Context

Measured on account 62b4c5143baaabf42b828a0d7a6b272e, 2026-10-22, with throwaway `fletch-pv-spike-*` resources and
token, all deleted after (a spike script, then the real `pnpm preview` commands end to end on slot 1 and
`deprovision`):

- `wrangler deploy` of a Worker with R2, Vectorize, Workers AI and Durable Object bindings succeeds on a token with
  only Individual Workers Editor on that Worker; so do `secret bulk` and `secret list`. Wrangler warns that it skips
  automatic provisioning for R2, which needs nothing here. The slot Worker then used every binding: an R2 put and get,
  a Vectorize upsert, describe and delete, a Workers AI embedding. No extra grant is needed.
- The token is refused on qyvr.dev production's Workers (403), on listing the account's R2 buckets (403), Vectorize
  indexes (403), D1 databases (401) and the workers.dev subdomain (403), and on deploying a Worker it does not cover.
- A Durable Object class's `deleted` tombstone in `exports`, then the class re-created, empties its storage; a
  tombstone for a class never created, or one already deleted, deploys cleanly. The placeholder relies on this.

## The gap

The same spike deployed the slot Worker with a binding to a bucket that was not the slot's, and the Worker wrote to
it. A binding is not checked against the deploying token: whoever holds this token can bind production's buckets,
indexes, databases, namespaces or services into a slot Worker and read or write them. So the token cannot redeploy or
delete production, but it can reach production's data. `pnpm preview` binds only the slot's own resources
(`slotConfig` refuses anything else), which holds an honest session, not one that runs wrangler itself. qyvr's own
pool has the same gap.

## Options

- **Accept the gap** on the shared account: previews work today; production data is reachable from any cloud session
  that holds the token.
- **A Cloudflare account only for previews** (recommended, Q3): `provision --account` makes the pool there and the
  inventory and token follow it; the gap then reaches only other previews. Costs the account's plan.
- Rejected: widening `qyvr-preview-slots`, or account-wide Workers, R2 and Vectorize write: they can redeploy
  production (Kyle).
