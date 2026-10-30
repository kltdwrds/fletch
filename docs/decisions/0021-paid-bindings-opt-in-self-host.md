---
id: D-0021
title: Code Mode and Images are not in the base config; pnpm self-host --paid adds them
status: accepted
door: two-way
decided: 2026-10-30
decider: agent
confirmation: scripts/self-host.test.mjs
revisit-when: the free-plan spike (docs/plan-v2/QUESTIONS.md, Q2) shows the free plan accepts either binding
supersedes: D-0004
---
Ruling: the Worker Loader (`LOADER`) and Images (`IMAGES`) bindings stay out of `packages/agent/wrangler.jsonc` and
are added only by `pnpm self-host --paid` (and `pnpm preview up --paid`), as exactly `worker_loaders: [{ binding:
"LOADER" }]` and `images: { binding: "IMAGES" }` — because setup targets the free plan and `wrangler types` would
otherwise make them required in `Env` — if wrong, free-plan owners miss two features they could have had.

## Context

D-0004 made the same ruling for `create-fletch`, which is deleted: the deploy is now `pnpm self-host` from a checkout
(D-0022). Only the command that adds the bindings changed. Without them Code Mode refuses with
`HOST_CODE_UNAVAILABLE` and a HEIC upload with `HOST_IMAGES_UNAVAILABLE` (D-0001). Whether the free plan accepts them
is unmeasured; `docs/runbooks/free-plan-spike.md` measures it. Both deploy paths derive their config through one
helper, `deployConfig` in `scripts/preview-plan.mjs`, so the bindings are added in one place.

## Options

- **Chosen:** opt-in with `--paid`, carried over unchanged.
- Rejected: in the base config (every free-plan deploy would type them required and fail to bind); detecting the plan
  at deploy time (an API call and a branch for a question the spike answers once).
