# Decisions

A decision others must obey is one record here, `NNNN-slug.md`. Reversible choices nobody else depends on are one
line in [log.md](log.md). `scripts/check-decisions.mjs` runs in `pnpm check` and fails when a record goes stale.
Why it is shaped this way: D-0007 and `docs/research/2026-10-22-decision-records.md`.

## How a decision becomes binding

- **Only `accepted` binds.** `proposed` is context, `superseded`, `rejected` and `deprecated` are history. When work
  contradicts an accepted record, stop: write a `proposed` record that supersedes it and a question in
  `docs/plan-v2/QUESTIONS.md`, and carry on only with what the conflict does not touch.
- **Two-way doors** (cheap to reverse) are the agent's: a line in the log, or a record with `decider: agent` when
  others will rely on it. The merge ratifies it.
- **One-way doors** (irreversible, spends money, a security boundary, a published package's contract, a storage
  schema) are proposed by an agent and accepted only by Kyle: the record says `decider: Kyle`. Records written before
  this process say `decider: inherited` and carry a review date by which Kyle confirms them (`decider: Kyle`) or
  supersedes them.
- **A record names what holds it.** `confirmation` is a test, a check or a hook that mentions the record's id, so
  renaming or deleting it fails the check; or `review` with a `review-by` date when nothing executable can.
- **A record says when to look again**: `revisit-when` in words, `review-by` as a date. A passed date fails
  `pnpm check` until Kyle renews it or a new record supersedes it.
- **Cite, never copy.** AGENTS.md, a runbook or a code comment points at a record by id (D-0001); the check fails a
  citation of a record that was replaced, naming the replacement.
- **Never edit an accepted record's ruling.** Supersede it: a new record with `supersedes: D-NNNN`, and the old one
  set to `status: superseded` with `superseded-by` (the check holds both ends).
- **The log stays small** (40 KB): when its lines start mattering to others, promote them into records and prune.

## A record

```markdown
---
id: D-0008
title: One line a reader can obey
status: proposed            # proposed | accepted | rejected | superseded | deprecated
door: one-way               # one-way | two-way
decided: 2026-10-22
decider: agent              # Kyle | agent | inherited
confirmation: test/workers/x.test.ts   # files that mention D-0008, comma-separated, or review
review-by: 2027-01-22       # required for review, and for an inherited one-way door
revisit-when: what would make this wrong
supersedes: D-0003          # optional; the old record then names this one in superseded-by
---
Ruling: X — because Y — if wrong, Z.

## Context, ## Options (the rejected ones too), ## Consequences: one page at most.
```

After adding or changing a record, run `node scripts/check-decisions.mjs --write` to refresh the index.

## Index

<!-- index:begin (node scripts/check-decisions.mjs --write) -->
| Id | Decision | Status | Door | Decided | Review by |
|---|---|---|---|---|---|
| [D-0001](0001-refusals-carry-host-codes.md) | A capability this deploy lacks is refused with a `HOST_<FEATURE>_UNAVAILABLE` code, never faked | accepted | one-way | 2026-10-20 | 2026-11-21 |
| [D-0002](0002-first-passkey-needs-setup-token.md) | The first passkey on a deploy needs a one-time setup token minted by create-fletch | accepted | one-way | 2026-10-20 | 2026-11-21 |
| [D-0003](0003-primitives-never-depend-on-the-app.md) | The published primitives never import the agent, and @qyvr/host imports no platform | accepted | one-way | 2026-10-19 | 2026-11-21 |
| [D-0004](0004-paid-bindings-are-opt-in.md) | Code Mode and Images are not in the base config; create-fletch --paid adds them | superseded | two-way | 2026-10-20 |  |
| [D-0005](0005-create-fletch-deploys-from-a-checkout.md) | create-fletch deploys the agent from a fletch checkout, not from a published package | superseded | two-way | 2026-10-20 | 2027-01-20 |
| [D-0006](0006-one-plan-two-entry-points.md) | One plan with two entry points: roadmap work is an `F<n>` part, everything else a plain PR | superseded | two-way | 2026-10-22 | 2027-01-22 |
| [D-0007](0007-decision-records.md) | Binding decisions are records with a status, a ratifier, a confirmation and a review date, checked in pnpm check | accepted | two-way | 2026-10-22 | 2027-01-22 |
| [D-0008](0008-preview-slots-on-a-per-worker-token.md) | Cloud sessions deploy to a fixed pool of preview slots with a token scoped to the slot Workers alone | accepted | one-way | 2026-10-22 |  |
| [D-0009](0009-page-grammar.md) | Every page is a path in one grammar module both the server and the page script read; anything else is a 404 page | accepted | two-way | 2026-10-23 |  |
| [D-0010](0010-artifact-collection-address.md) | Stub for Kyle's artifact record - artifacts live at `/library/artifacts/<slug>`, a collection of the page grammar | proposed | two-way | 2026-10-23 |  |
| [D-0011](0011-subagent-transcript-read.md) | A sub-agent facet answers its parent's owner-checked read of its transcript, and nothing else reads it | accepted | one-way | 2026-10-26 |  |
| [D-0012](0012-one-plan-on-the-parity-loop.md) | One plan with two entry points, on the parity loop: a part is one builder session under docs/plan-v2/, everything else a plain PR | accepted | two-way | 2026-10-29 | 2027-01-29 |
| [D-0013](0013-private-repository-evidence-in-tree.md) | The repository is private while the spine is built; parity evidence lives in docs/plan-v2/evidence/; the public release is cut later by cherry-pick | superseded | two-way | 2026-10-29 | 2027-01-29 |
| [D-0014](0014-public-repository-evidence-git-ignored.md) | The repository stays public; parity evidence lives git-ignored under docs/plan-v2/evidence/ on Kyle's Mac, with only its README and the content-free tier-2 results tracked | accepted | two-way | 2026-10-29 | 2027-01-29 |
| [D-0015](0015-tier2-evals-in-ci.md) | Tier-2 evals run in CI on a PR touching the agent, with the slot token and a Workers AI spend cap as repository secrets | proposed | one-way | 2026-10-29 | 2026-12-31 |
| [D-0016](0016-oauth-connectors.md) | Connectors that authenticate by OAuth authorization code get a redirect route, a state store and token refresh on the agent | proposed | one-way | 2026-10-30 | 2026-12-31 |
| [D-0017](0017-no-payment-instrument.md) | fletch holds no payment instrument and submits no payment; the person pays in a live page they take over | proposed | one-way | 2026-10-30 | 2026-12-31 |
| [D-0018](0018-agent-name-is-the-owners-setting.md) | The agent's name and avatar are the owner's settings, written only by the owner through the app; until that setting exists the agent has no name and says so | proposed | one-way | 2026-10-30 | 2026-12-31 |
| [D-0019](0019-operating-block-cap-6-kib.md) | The operating block's cap is 6 KiB, held by a test, so P14's identity section fits | accepted | two-way | 2026-10-30 |  |
| [D-0020](0020-chat-model-two-providers-no-hedge.md) | The agent reaches models two ways, Workers AI and Meta through an AI Gateway, with no fallback model; invalid model vars fail every call by name | accepted | two-way | 2026-10-30 |  |
| [D-0021](0021-paid-bindings-opt-in-self-host.md) | Code Mode and Images are not in the base config; pnpm self-host --paid adds them | accepted | two-way | 2026-10-30 |  |
| [D-0022](0022-self-host-deploys-from-a-checkout.md) | pnpm self-host deploys the agent from a fletch checkout on the owner's wrangler login; there is no setup package | accepted | two-way | 2026-10-30 |  |
| [D-0023](0023-setup-token-minted-by-self-host.md) | The first passkey on a deploy needs a one-time setup token minted by pnpm self-host | proposed | one-way | 2026-10-30 | 2026-12-31 |
<!-- index:end -->
