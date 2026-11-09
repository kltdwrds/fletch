---
id: D-0030
title: A paid deploy (--paid) also binds the document renderer, a pandoc container, beside Code Mode and Images
status: proposed
door: one-way
decided: 2026-11-08
decider: agent
confirmation: review
review-by: 2026-12-31
revisit-when: a deploy's container bill is measured, the free-plan spike (Q2) shows containers on the free plan, or a cheaper renderer than a container exists
---
Ruling: `pnpm self-host --paid` and `pnpm preview up --paid` add, beside D-0021's `LOADER` and `IMAGES`, the
`RENDERER` Durable Object binding (class `Renderer`, which every deploy exports) and one `containers` entry running
`docker.io/pandoc/minimal:3.11.0` (`RENDERER_CONTAINER` in `scripts/preview-plan.mjs`, at most two instances); without
them `singleAccountHost` refuses render with `HOST_RENDER_UNAVAILABLE` naming the `RENDERER` binding (D-0001) —
because the renderer's code (`packages/agent/src/render/`) already speaks to pandoc's server and F56 wires it into the
single-account host — if wrong, a paid deploy pays for a container its owner never asked for, and the binding moves
behind its own flag.

## Context

Until this record is accepted the switch is off: `RENDERER_ON_PAID` in `scripts/preview-plan.mjs` is `false`, so no
deploy, paid or not, gets the container, and every deploy refuses render by the binding's name. Accepting it is that
one line set to `true` (its test in `scripts/preview-plan.test.mjs` flips with it).


F56 (Kyle's one-hour ruling, 2026-11-08: defaults, best effort, reconcile later) built it. It is one-way because a
container spends money on the owner's account. `render` was already a published `HostFeature`, so no package contract
changed beyond an optional `RENDERER` on `SingleAccountEnv` (a changeset, minor). This record extends D-0021's set
rather than superseding it: D-0021 still holds for `LOADER` and `IMAGES`.

## Options

- **Chosen:** the container rides on `--paid` with the other paid bindings, in the one helper both deploys share
  (`deployConfig`).
- Rejected: a separate `--render` flag (another switch for one more paid binding; reversible if the bill says so).
- Rejected: the container in the base config (every free-plan deploy would fail to deploy it).
