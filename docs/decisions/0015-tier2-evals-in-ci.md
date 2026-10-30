---
id: D-0015
title: Tier-2 evals run in CI on a PR touching the agent, with the slot token and a Workers AI spend cap as repository secrets
status: proposed
door: one-way
decided: 2026-10-29
decider: agent
confirmation: review
review-by: 2026-12-31
revisit-when: the dry run (F20) shows unstable verdicts, previews move to an account of their own (Q3), or a slot's chat model needs a key the gateway cannot hold
---
Ruling: a GitHub Actions workflow `tier2.yml` runs `pnpm evals <cluster>` for each cluster a PR's diff touches
under `packages/agent/`, on a preview slot it leases with the pool's token, and posts the Markdown table as one PR
comment (never a gate, O2) — because tier 2 needs the real model and a real slot, which only a key in CI can give
unattended — if wrong, the runner keeps running from Kyle's Mac (`docs/runbooks/evals.md`), which is where it runs
today and until this record is accepted.

## Context

F19 built the runner (`scripts/evals.ts`): it reads `test/evals/**/*.task.ts`, drives this worktree's preview slot
through the app's routes, runs each task three times, grades by code, and writes `docs/plan-v2/evidence/results/`.
The design (§5.2, O9) has Kyle agreeing in principle to a key in CI and asks F19 to write the record with the key's
scope and spend cap for his acceptance. Nothing here is enabled: no workflow file, no secret, no comment. This record
is a one-way door twice over: it spends money (model calls on every agent PR) and it moves a credential across a
boundary (a token that deploys to the pool, held by GitHub).

## The key's scope

- **The slot token**, `fletch-preview-slots` (D-0008): Individual Workers Editor on exactly the pool's Workers,
  nothing else. It already exists; CI gets its value as the repository secret `FLETCH_PREVIEW_CLOUDFLARE_API_TOKEN`
  and the pool's account and subdomain as `CLOUDFLARE_ACCOUNT_ID` and `FLETCH_PREVIEW_SUBDOMAIN`. It can deploy a slot
  and read a slot's lease; it cannot touch production's Workers, buckets, indexes or the account's billing (D-0008's
  measured gap stands: a Worker it deploys may bind another resource, so the workflow deploys only through
  `pnpm preview up`, which binds the slot's own).
- **No model key.** A slot's chat model is Workers AI through the slot Worker's `AI` binding
  (`packages/agent/src/model/routes.ts`), billed to the pool's account, unless the slot sets `CHAT_PROVIDER=meta`
  (D-0020): then it is Muse Spark through the account's AI Gateway, whose Meta key lives on the gateway, not in
  the agent or in CI. Either way there is no provider key for CI to hold.
- **Where it lives:** a GitHub environment `tier2` on this repository, with the three secrets above, restricted to the
  `main` branch and PR branches of this repository (a fork's PR never sees them), and the workflow's `permissions`
  limited to `pull-requests: write` (the comment) and `contents: read`.

## The spend cap

- **Per run:** at most 12 tasks, 3 trials each, 4 minutes per turn (`TURN_TIMEOUT_MS`), one workflow job of at most
  60 minutes; the runner stops a task at its first infra trial.
- **Per month:** a Workers AI usage notification on the pool's account at 10 USD and the workflow disabled by hand
  above 25 USD; the neuron price of the default chat model (`@cf/zai-org/glm-5.3-flash`) at the time of acceptance is
  written into the record's Consequences when Kyle accepts it.
- **Concurrency:** one run at a time per PR (`concurrency: tier2-${{ github.head_ref }}`, cancel in progress), and the
  pool's free slots bound the number of PRs under test at once; a run with no free slot ends `infra`, never waits.

## Options

- **Chosen:** comment only, on PRs touching `packages/agent/`, with the existing slot token and no model key.
- Rejected: a required check (O2 says comments until the dry run shows stable verdicts).
- Rejected: a token of its own with Workers AI: Read (the slot Worker calls the model through its binding; a token
  adds nothing the deploy does not already carry).
- Rejected: running on every PR (a docs change has no tier-2 question; the cost is the model's).

## Consequences

Until accepted: the runner runs from Kyle's Mac against the worktree's leased slot (`docs/runbooks/evals.md`), and a
part's PR body carries the table it printed. On acceptance: the workflow file is a plain PR citing this record, the
secrets are Kyle's to set, and `WAITING-ON-KYLE.md` lists both.
