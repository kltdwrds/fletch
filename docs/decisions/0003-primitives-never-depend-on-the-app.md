---
id: D-0003
title: The published primitives never import the agent, and @qyvr/host imports no platform
status: accepted
door: one-way
decided: 2026-10-19
decider: inherited
confirmation: scripts/check-boundaries.mjs
review-by: 2026-11-21
revisit-when: a primitive needs something only the agent has
---
Ruling: nothing under `packages/host/` or `packages/host-cloudflare/` imports the agent or `create-fletch`, and
nothing under `packages/host/` imports a `cloudflare:` specifier — because the primitives are published for strangers
to build other agents on, and an import of the app would drag fletch along — if wrong, the published packages stop
being reusable and every agent change becomes a primitives release.

## Context

The boundary check holds the rules `no-fletch`, `no-deep-import` and `no-cloudflare-workers`, each with a planted
violation in its test.

## Consequences

When a primitive needs app behaviour, the primitive grows an interface and the app implements it.
