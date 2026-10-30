---
id: D-0016
title: Connectors that authenticate by OAuth authorization code get a redirect route, a state store and token refresh on the agent
status: proposed
door: one-way
decided: 2026-10-30
decider: agent
confirmation: review
review-by: 2026-12-31
revisit-when: the first owner asks for a provider that offers only OAuth, or a provider fletch already connects by token withdraws its tokens
---
Ruling: a connector whose provider offers only OAuth authorization code is connected through a redirect
route on the agent's own origin (`/connect/oauth/<provider>/callback`), a per-attempt `state` row the person's click
mints and the callback spends once, and a refresh token held in the Vault as its own kind with the provider's scopes
and lifetime, refreshed only by the egress module at use — because Muse's provider connectors (code host, music,
tasks, social) are OAuth grants and the P9 contract (`docs/plan-v2/contracts/P9-connectors.md`, One-way doors) cannot
reach them with a token the person pastes — if wrong, the route is removed and an OAuth-only provider is refused by
name (D-0001), which is what the agent does today.

## Context

fletch's vault takes a value the person enters on the capture form, bound to hosts the person names (B-P9-01,
B-P9-05); GitHub connects by a personal token. A provider that issues no token the person can copy cannot be
connected. The interrogation of Muse (`docs/plan-v2/evidence/p9-connectors/answers/step-1.md`, `step-7.md`) found
its connections obtained through the provider's consent page, their expiry surfacing as `reauthorization_required`
and a reconnect card.

## Options

- **Refuse OAuth-only providers by name** (today). No new boundary; the person uses the provider's own app.
- **This record**: a callback route, a one-shot `state` row, a `oauth` kind in the Vault with refresh at use. The
  callback receives codes from the open web (a security boundary); refresh tokens and scopes are a storage schema.
- **A hosted broker** (a shared OAuth app on a qyvr domain exchanging codes for every deploy): rejected in the
  proposal; it puts every owner's grants behind one app's secret and one party's uptime, against `VISION.md`.

## Consequences

Accepted: a part under P9 after the spine, with its own contract clauses (the consent page opened by the person,
the state spent once, the refresh never shown, the revoke calling the provider's revoke endpoint), and
`test/workers/` tests that plant a replayed state and a refresh outside the egress module. Rejected: the refusal
stands and the Not in scope line in the P9 contract holds.
