---
id: D-0013
title: The repository is private while the spine is built; parity evidence lives in docs/plan-v2/evidence/; the public release is cut later by cherry-pick
status: accepted
door: two-way
decided: 2026-10-29
decider: agent
confirmation: review
review-by: 2027-01-29
revisit-when: the spine is Locked (the public cut is due), someone other than Kyle wants a deploy, or a capture cannot pass the redaction gate
---
Ruling: `kltdwrds/fletch` is private for the parity phase, and every capture, dump slice, Muse answer and tier-2
result lives in `docs/plan-v2/evidence/`, redacted by `pnpm redact` before it is stored; the public release is a new
repository built by cherry-pick from this history with the evidence folder left behind — because Kyle asked for one
repository and one folder over a sibling evidence repository (O1), and no capture is stored yet, so the door is still
two-way — if wrong, evidence already in this history stays in it, and the public cut becomes a history filter instead
of a cherry-pick; the gate on every stored file is what keeps the cherry-pick path open.

## Context

The parity framework (`docs/plan-v2/2026-10-29-parity-framework-design.md` §4.4) first proposed a private sibling
repository `fletch-parity`, referenced by id from public scenario files. Kyle's answer on 2026-10-29: make this
repository private and keep the evidence in a folder here. `VISION.md`'s open-source promise holds for the released
version, not for the working repository during this phase. The visibility change itself is Kyle's GitHub setting;
GitHub Actions minutes are metered on a private repository.

## Options

- **Chosen:** one private repository, evidence in `docs/plan-v2/evidence/`, redaction before storage, a public cut by
  cherry-pick later.
- Rejected: a sibling evidence repository (two repositories to keep in step, an eval-time token, for a problem the
  redaction gate solves); storing evidence unredacted because the repository is private (the public cut would then
  need a history rewrite, and the scans run on every commit regardless).
