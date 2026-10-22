# Decision log

Two-way doors: dated one-liners with their reason, for choices nobody else has to obey. When a line starts mattering
to others, promote it into a record (README.md) and delete it here. Capped at 40 KB by `scripts/check-decisions.mjs`.

- 2026-10-20 WebAuthn uses `@simplewebauthn/server` 14.0.3: it bundles under `nodejs_compat`, so there is no
  hand-rolled fallback.
- 2026-10-20 `@noble/hashes` 2.4.0 provides synchronous SHA-256 in the passkey stores.
- 2026-10-20 `create-fletch` sets `MASTER_KEY` and `SETUP_TOKEN` (32 random bytes, base64url) each only when the Worker
  lacks it: a fresh account gets two secret puts, a second run none (D-0002).
- 2026-10-20 `tokenScopes(cf, accountId)` takes the account id, which the per-scope probes and the account-token
  verify endpoint need.
- 2026-10-22 `pnpm check` is the fast gate (lint, harness checks and scans, typecheck; about 20 s, run by the pre-push
  hook) and `pnpm verify` adds the tests (CI and the release). Rejected: tests in the pre-push hook, too slow for every
  push and refused beside a cloud shell's credentials.
- 2026-10-22 The file-size cap is a ratchet against `origin/main` (ported from qyvr): a file already over 600 lines may
  not grow. Rejected: the flat cap, which blocks unrelated PRs when a file drifts over.
- 2026-10-22 Muse owns execution: it runs the KICKOFF protocol through Claude Code, reviews and UATs the result and
  publishes the PR (`docs/runbooks/muse-execution.md`); Kyle steers, accepts one-way doors and merges. Rejected: Muse
  as a second implementer, which would put two writers on one branch.
