---
id: D-0007
title: Binding decisions are records with a status, a ratifier, a confirmation and a review date, checked in pnpm check
status: accepted
door: two-way
decided: 2026-10-22
decider: Kyle
confirmation: scripts/check-decisions.test.mjs
review-by: 2027-01-22
revisit-when: the check fails more often on bookkeeping than on real staleness
---
Ruling: a decision others must obey is one file in `docs/decisions/`, an agent may only propose a one-way door, and
`scripts/check-decisions.mjs` fails `pnpm check` when a record's confirmation disappears, its review date passes,
or something still cites a record that was replaced — because decisions went stale and created tension late, and an
append-only log let later lines contradict earlier ones without anyone noticing — if wrong, the records become
bookkeeping that slows small changes without catching real drift.

## Context

The evidence is `docs/research/2026-10-22-decision-records.md`: MADR's confirmation section, fitness functions and
revisit triggers are what keep a decision from going stale; status and supersede links alone do not. qyvr-co's
385 KB append-only log is the failure this avoids.

## Options

- **Chosen:** records for binding decisions plus a capped log for two-way doors, a check in the gate, and Kyle as
  the only ratifier of one-way doors.
- Rejected: one append-only file (what went stale); RFC comment windows (one approver is the right size); a
  drift heuristic over commits touching a decision's files (deferred until the basics prove themselves).
