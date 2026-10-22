# Parts

The roadmap, one part per section: what one session builds and proves with `pnpm accept F<n>`. The session protocol
is `docs/plan/KICKOFF.md`; status lives in `docs/plan/PROGRESS.md`, not here.

Rules for every part:

- **Shape.** `## F<n> <title>` (or `### F<n>.<p>` after a split), then **Read:** (the only documents to load),
  **Scope:**, **Acceptance:** (claims a test can prove, each naming its test file once written), **Not in scope:**
  (binding), and **Rulings:** where the plan session settled something up front, each written
  "Ruling: X — because Y — if wrong, Z".
- **Splitting.** A session may split its part into `F<n>.1`, `F<n>.2`, … here, log the split in `docs/DECISIONS.md`,
  and do exactly one.
- **Tags.** Every new test file's top-level `describe` carries `[F<n>]` (or `[F<n>.<p>]`); accept selects the
  part's tests and every earlier one by it, and fails a part with no test of its own.
- **Writing parts.** Kyle's plan session adds and reorders parts; a part session never adds one. A part names a
  one-way decision it needs as a blocker in its Read line, so a session stops instead of taking it.

F0 and F1 were written after the fact from the commits, tests and README (2026-10-22); their acceptance names what
exists.

## F0 The harness

**Read:** `scripts/accept.ts`, `test/m0/`.

**Scope:** The repository skeleton and the acceptance harness carried over from qyvr-co and cut to fletch: the
boundary check, `pnpm accept` with `F<n>` part ids and test tags, the secret and privacy scans, the pre-commit hook,
the hermetic vitest lane and CI.

**Acceptance:** `test/m0/accept.test.ts` (part ids and tags), `test/m0/harness.test.ts` (each check fails on a planted
violation; the pre-commit hook refuses a real commit), `test/m0/scans.test.ts`, and each script's `*.test.mjs`.

**Not in scope:** the platform's steps (the binding audit, the upstream pin check, the adapter contract suite), which
stayed in qyvr-co.

## F1 The self-host path

**Read:** README.md ("Set up your own fletch", "What is not in this build"), `docs/DECISIONS.md`,
`docs/runbooks/live-deploy.md`.

**Scope:** One owner on one account, set up in about ten minutes on the free plan: the host seam (`@qyvr/host`,
`singleAccountHost`), secret-backed keys, passkey login with the setup token and a recovery code, the provisioning
library and `create-fletch`, the primitives' publish build, refusals by name for what a self-host lacks, Workers AI
models with no gateway, and the live exit test.

**Acceptance:** the `[F1]` tests in `packages/host/test/`, `packages/host-cloudflare/test/`,
`packages/create-fletch/test/`, `test/workers/` (the `f1-*` files), `test/live/` and the publish-manifest and
rewrite-dts script tests; and one passing run of `test/live/f1-deploy.live.test.ts` against a throwaway account,
its wall-clock time recorded in PROGRESS.md.

**Not in scope:** mail, the shared workspace, rendering and Access members (refused with their
`HOST_<FEATURE>_UNAVAILABLE` codes); publishing `create-fletch` so it runs without a checkout.

## Next parts

Not written yet: the plan session adds them here, in order, before the loop runs.
