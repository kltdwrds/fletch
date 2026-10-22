---
id: D-0006
title: One plan with two entry points: roadmap work is an `F<n>` part, everything else a plain PR
status: accepted
door: two-way
decided: 2026-10-22
decider: Kyle
confirmation: review
review-by: 2027-01-22
revisit-when: sessions are unsure which entry point applies, or parts sit unused for a month
---
Ruling: planned work is an `F<n>` part in `docs/plan/parts.md`, worked under `docs/plan/KICKOFF.md` and done only at
`ACCEPT F<n>: PASS` and a clean verifier; everything else is a plain PR that passes `pnpm verify` — because Kyle wants
unattended runs on the roadmap and lightweight PRs for the rest, in one system rather than two — if wrong, sessions
spend effort deciding which mode they are in, or parts become ceremony nobody runs.

## Options

- **Chosen:** one system, two entry points, one decisions record (Kyle, 2026-10-22).
- Rejected: interactive PRs only (no unattended runs); the unattended loop only (too heavy for a bug fix); two
  parallel systems (a session cannot tell which applies).
