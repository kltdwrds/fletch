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
- 2026-10-22 A preview slot's lease lives in its own Durable Object (`PreviewLease`), never tombstoned, so a release
  that deletes the agent's objects keeps the row that decides who may release. Rejected: an R2 object, whose
  conditional writes the bucket wipe would have to step around.
- 2026-10-22 A preview slot is wiped by its placeholder's deploy, whose config tombstones the agent's Durable Object
  classes. Rejected: a per-lease `TENANT_ID`, which leaves the person-named objects reachable.
- 2026-10-22 The `workers.dev` subdomain of the preview pool is never committed (it names the account's owner):
  `FLETCH_PREVIEW_SUBDOMAIN`, or a git-ignored file `provision` writes. Rejected: custom domains under qyvr.dev, which
  would hand any `.qyvr.dev` cookie to a slot a session deployed.
- 2026-10-22 Muse owns execution: it runs the KICKOFF protocol through Claude Code, reviews and UATs the result and
  merges the PR and deploys previews (`docs/runbooks/muse-execution.md`); Kyle steers, does final UAT, accepts one-way
  doors, every Cloudflare change and the production go. Rejected: Muse
  as a second implementer, which would put two writers on one branch.
- 2026-10-22 F2 searches the entries `history()` draws, with no `LIKE` prefilter on `messages.body` (F2's first ruling
  named one): the thread also draws mailbox messages and a tool's announced words, which `messages` does not hold, and
  a `LIKE` over the JSON body misses escaped characters and non-ASCII case, so a prefilter could hide a match. Rejected:
  the prefilter, until Q4 measures the scan slow.
- 2026-10-22 `/app/search` caps a query's rows at 20 and keeps the recents at 8; a recent is ordered by its last
  connection, or its opening when no page has connected to it; a row matched by title alone carries the chat's own
  time (`lastAt`, the list row's), or its opening when it has none. Rejected: 20 recents, which the dialog never asked for.
- 2026-10-22 `test/fixtures/people.json` holds a second fictional member (`pat-solo`), so a claim about two people is
  tested with two members of the fixture. Rejected: a second identity made up inside a test.
