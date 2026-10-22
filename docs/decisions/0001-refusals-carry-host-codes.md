---
id: D-0001
title: A capability this deploy lacks is refused with a `HOST_<FEATURE>_UNAVAILABLE` code, never faked
status: accepted
door: one-way
decided: 2026-10-20
decider: inherited
confirmation: test/workers/f1-refusals.test.ts, packages/host/test/host.test.ts
review-by: 2026-11-21
revisit-when: a second host implementation ships, or a refusal code needs renaming
---
Ruling: every capability the host cannot serve answers `{ ok: false, code: "HOST_<FEATURE>_UNAVAILABLE", reason }`
from `unavailable()`, and the app shows it by name — because a self-host lacks mail, workspace, rendering and the
paid-plan bindings, and an empty or successful-looking answer would hide that from the owner — if wrong, owners see
features silently do nothing, and renaming a code later breaks every consumer of the published `@qyvr/host`.

## Context

A self-hosted fletch is one owner on one account; several platform services are absent. The codes are part of
`@qyvr/host`'s published surface, so they are a contract, not an implementation detail. A HEIC upload without the
Images binding and any AVIF refuse with `HOST_IMAGES_UNAVAILABLE` (renamed from `IMAGE_CONVERT_UNAVAILABLE` before
release); a missing Worker Loader with `HOST_CODE_UNAVAILABLE`.

## Options

- **Chosen:** one code family, `HOST_<FEATURE>_UNAVAILABLE`, each with its own reason in words.
- Rejected: per-call ad hoc codes (no way for a UI to treat them alike); hiding the feature (the owner cannot tell
  absent from broken).

## Consequences

Adding a `HostFeature` adds its code. Renaming one is a major release of `@qyvr/host`.
