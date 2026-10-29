---
id: D-0004
title: Code Mode and Images are not in the base config; create-fletch --paid adds them
status: accepted
door: two-way
decided: 2026-10-20
decider: inherited
confirmation: packages/create-fletch/test/init.test.ts
revisit-when: the free-plan spike (docs/plan-v2/QUESTIONS.md, Q2) shows the free plan accepts either binding
---
Ruling: the Worker Loader (`LOADER`) and Images (`IMAGES`) bindings are left out of `packages/agent/wrangler.jsonc`
and added only by `create-fletch --paid` — because setup targets the free plan and `wrangler types` would otherwise
make them required in `Env` — if wrong, free-plan owners miss two features they could have had.

## Context

Without them Code Mode refuses with `HOST_CODE_UNAVAILABLE` and a HEIC upload with `HOST_IMAGES_UNAVAILABLE` (D-0001).
Whether the free plan accepts them is unmeasured; `docs/runbooks/free-plan-spike.md` measures it.
