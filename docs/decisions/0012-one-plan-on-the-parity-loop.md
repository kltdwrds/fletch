---
id: D-0012
title: One plan with two entry points, on the parity loop: a part is one builder session under docs/plan-v2/, everything else a plain PR
status: accepted
door: two-way
decided: 2026-10-29
decider: agent
confirmation: review
review-by: 2027-01-29
revisit-when: sessions are unsure which entry point applies, or parts sit unused for a month, or the loop's stages stop producing contracts
supersedes: D-0006
---
Ruling: planned work is an `F<n>` part in `docs/plan-v2/parts.md`, written by the orchestrator from a cluster's
contract and worked by a builder session under `docs/plan-v2/KICKOFF.md`, done only at `ACCEPT F<n>: PASS` and a
clean verifier; everything else is a plain PR that passes `pnpm verify` — because the parity framework
(`docs/plan-v2/2026-10-29-parity-framework-design.md`) replaced the first plan and its Muse-driven loop with one
orchestrator and one plan folder, and D-0006's reasons (unattended runs on the roadmap, light PRs for the rest, one
system) still hold — if wrong, sessions spend effort deciding which mode they are in, or parts become ceremony nobody
runs.

## Context

D-0006 named `docs/plan/` and the Muse execution runbook. The pare-down of 2026-10-29 moved the plan to
`docs/plan-v2/`, deleted the runbook, closed F0–F17 and made the orchestrator the subject of the loop. The ruling is
the same shape on the new paths; it is superseded rather than edited because an accepted ruling is never edited.

## Options

- **Chosen:** the same two entry points on the new plan folder, the orchestrator writing parts.
- Rejected: keeping `docs/plan/` beside `docs/plan-v2/` (two plans: a session cannot tell which applies, D-0006's own
  failure mode); dropping parts for plain PRs only (no unattended runs, no accept line per cluster).
