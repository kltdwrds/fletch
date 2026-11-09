---
id: D-0031
title: The document renderer's container rides on its own flag, --render, which the staging deploy carries; a paid deploy does not add it
status: proposed
door: one-way
decided: 2026-11-09
decider: agent
confirmation: review
review-by: 2026-12-31
revisit-when: a deploy's container bill is measured, the free-plan spike (Q2) shows containers on the free plan, or a cheaper renderer than a container exists
supersedes: D-0030
---
Ruling: `pnpm self-host --render`, `pnpm preview up --render` and `pnpm preview staging deploy --render` add the
`RENDERER` Durable Object binding (class `Renderer`, which every deploy exports) and one `containers` entry running
`docker.io/pandoc/minimal:3.11.0` on one `lite` instance (`RENDERER_CONTAINER` in `scripts/preview-plan.mjs`);
`--paid` adds Code Mode and Images alone (D-0021) and never the container; the staging workflow
(`.github/workflows/deploy-staging.yml`) deploys with `--render`; without the binding `singleAccountHost` refuses
render with `HOST_RENDER_UNAVAILABLE` naming it (D-0001) — because Kyle asked on 2026-11-09 for artifacts end to end
on the staging deploy, which runs without `--paid`, and Code Mode and Images are unmeasured on that account, so the
one paid binding staging needs gets its own switch — if wrong, the flag folds back into `--paid` (D-0030's shape) and
staging adds `--paid`; either is one line in `deployConfig` and one in the workflow.

## Context

D-0030 (F56, 2026-11-08) put the container on `--paid` behind `RENDERER_ON_PAID = false`, to be flipped when Kyle
accepted it. Kyle's instruction of 2026-11-09 ("Get artifacts working end to end on the staging deploy … the render
refused by name on any deploy that lacks the container … no blockers, best reading in one line and move, reconcile
later") is the acceptance in substance of a container on staging, and names either flag as acceptable. Staging has
never deployed with `--paid`; adding Code Mode and Images to it to get the renderer would spend and risk more than
asked. So the switch becomes the flag: `RENDERER_ON_PAID` is deleted, `deployConfig(..., { render })` adds the three
parts, and nothing but `--render` sets it.

The spend starts only when the workflow runs with the flag and the container application is created, which needs a
token permission only Kyle can grant: the staging token `fletch-staging-deploy` holds Individual Workers Editor on
`fletch-pv-1` alone, and the containers API (`/accounts/{id}/containers/applications`) answers 403 to it (measured
2026-11-09 from a cloud session on the pool token, whose scope is the same). `wrangler deploy` uploads the Worker
before it creates the container application, so a deploy on that token would leave new code live with no container;
`renderPreflight` in `scripts/preview.mjs` refuses with `PREVIEW_RENDER_TOKEN` before any upload until the token can
list container applications. Kyle's step: add Account › Workers Containers › Write to `fletch-staging-deploy` (the
dashboard, or `pnpm preview staging secrets` once it mints the group), then re-run `deploy-staging.yml`. That
permission is account-wide (containers have no per-application scope), so the token then reaches every container
application on the account: the qyvr sandboxes too. D-0008's token (`fletch-preview-slots`) is not widened by this
record; tier 2 on a leased slot with `--render` waits on its own decision.

## Options

- **Chosen:** a flag of its own, `--render`, carried by the staging workflow; `--paid` unchanged (D-0021).
- Rejected: flipping `RENDERER_ON_PAID` and deploying staging with `--paid` (two unmeasured bindings ride along, and the
  flip is D-0030's acceptance, Kyle's own commit).
- Rejected: the container in the base config (every free-plan deploy would fail to deploy it).
- Rejected: `max_instances: 2` (one owner, one tenant; a second instance only costs).

## Consequences

Until Kyle grants the permission, every push to main fails the deploy-staging run at `PREVIEW_RENDER_TOKEN` and the
slot keeps serving the main it has. After the grant, one re-run deploys main with the container; `/health` on the slot
says `render: true` once the host binds it. `pnpm preview staging secrets` still mints a token with the Editor group
alone (`policyExact`): re-running it after the dashboard edit drops the Containers permission again, so that script
gains the group only when Kyle accepts this record.
