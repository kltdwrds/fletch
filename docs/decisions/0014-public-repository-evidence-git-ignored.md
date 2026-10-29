---
id: D-0014
title: The repository stays public; parity evidence lives git-ignored under docs/plan-v2/evidence/ on Kyle's Mac, with only its README and the content-free tier-2 results tracked
status: accepted
door: two-way
decided: 2026-10-29
decider: agent
confirmation: review
review-by: 2027-01-29
revisit-when: the evidence must reach a machine other than Kyle's (a cloud builder, a second orchestrator), or a results file needs content a reader could trace to a person
supersedes: D-0013
---
Ruling: `kltdwrds/fletch` is public, and every capture, dump slice and Muse answer lives under `docs/plan-v2/evidence/`,
git-ignored, on Kyle's Mac alone; only `docs/plan-v2/evidence/README.md` and `docs/plan-v2/evidence/results/` (tier-2
verdicts: task hash, trial outcomes, timestamps, never agent or user text) are tracked, so `scripts/check-plan.mjs`
can hold a scorecard row to a results file in CI — because the private repository (D-0013) stopped GitHub Actions
for want of billing within the hour, Kyle wants the simplest thing that keeps the sensitive files off GitHub, and the
orchestrator runs on his Mac where the folder is — if wrong, evidence is lost with the Mac (it is not versioned: a
backup is Kyle's), or a cloud builder cannot read a capture a contract cites and must ask.

## Context

D-0013 made the repository private with evidence in tree. Actions minutes are metered on a private repository and
the account's spending limit refused the first CI run. The redaction gate (`pnpm redact`, F18) still runs on
everything stored under the folder: the files are off GitHub, not off every screen, and a results file is derived
from them.

## Options

- **Chosen:** public repository, evidence git-ignored and local, README and results tracked.
- Rejected: fixing Actions billing and staying private (a bill for a problem a `.gitignore` solves); a private
  sibling repository (two repositories to keep in step); committing the evidence to the public repository after
  redaction (the gate strips values, not shape, and Kyle's account is the source).
