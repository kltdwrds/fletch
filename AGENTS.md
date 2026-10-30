# AGENTS.md

How to work on fletch. `CLAUDE.md` is a link to this file. Keep it under 200 lines (`scripts/check-agent-docs.mjs`
enforces that, and that every path and code identifier named here in backticks exists). Point to the code for any
list; never copy one here. Write a directory with a trailing `/`.

## Start here: which entry point?

fletch is built one way with two entry points (D-0012).

- **Roadmap work is a part.** Every planned item is an `F<n>` part in `docs/plan-v2/parts.md`, with its Scope,
  Acceptance and Not in scope, written by the orchestrator from a cluster's contract under the parity framework
  (`docs/plan-v2/2026-10-29-parity-framework-design.md`). A part runs unattended (the `/goal` loop in
  `docs/plan-v2/GOAL-PROMPT.md`) or with Kyle at the keyboard; either way follow `docs/plan-v2/KICKOFF.md`, and the
  part is done only at `ACCEPT F<n>: PASS` plus the verifier's `VERIFIER: no blocking findings`.
- **Everything else is a plain PR**: a bug fix, a small change, a harness tweak. No part id and no plan entry; it
  passes `pnpm verify` and review. A change too big to describe in a PR body becomes a part first.

Is there a part for what you were asked? Follow `docs/plan-v2/KICKOFF.md`. If not, it is a normal PR. The loop that
writes and dispatches parts is one orchestrator session (`docs/plan-v2/ORCHESTRATOR.md`); what waits on Kyle is in
`docs/plan-v2/WAITING-ON-KYLE.md`.

## Product contract

Read `VISION.md` before planning or reviewing a non-trivial change: what fletch is for and what it is not. A
locally correct change can still be wrong if it works against it; call out any intentional tension.
`docs/research/` is evidence, not a constraint.

## Decisions

Binding decisions are records in `docs/decisions/` (the index and the rules: `docs/decisions/README.md`); reversible
choices nobody else depends on are one line in `docs/decisions/log.md`. `scripts/check-decisions.mjs` runs in
`pnpm check` and fails when a record goes stale: its confirming test is gone, its review date has passed, or
something still cites a record that was replaced.

- **Only `accepted` binds.** When work contradicts an accepted record, stop: write a `proposed` record that supersedes
  it and a question in `docs/plan-v2/QUESTIONS.md`, and carry on only with what the conflict does not touch.
- **Two-way doors** (cheap to reverse) are yours: a log line, or a record with `decider: agent` when others rely on it.
- **One-way doors** (irreversible, spends money, a security boundary, a published package's contract, a storage
  schema) you may only propose. Kyle accepts them; never write `decider: Kyle` yourself.
- **A decision a check can hold becomes a check** (a test, a row in `scripts/check-boundaries.mjs`, a hook) that
  names the record's id, and the record names it as its `confirmation`.
- **Cite, never copy**: a rule here points at its record (D-0001), so it cannot outlive it.

## Repository map

| Path | What |
|---|---|
| `packages/agent/` | `fletch-agent` (private): the agent Worker and its Durable Objects, one deploy per owner. Read `packages/agent/AGENTS.md` first. |
| `packages/host/` | `@qyvr/host` (published): the host contracts, no platform or app imports. Read `packages/host/AGENTS.md` first. |
| `packages/host-cloudflare/` | `@qyvr/host-cloudflare` (published): keys, passkey login and the provisioning library on Cloudflare. Read `packages/host-cloudflare/AGENTS.md` first. |
| `packages/create-fletch/` | `create-fletch` (private): the one command that sets fletch up on an owner's account. Read `packages/create-fletch/AGENTS.md` first. |
| `test/` | The hermetic suite and the live lane (layout below). |
| `scripts/` | The gates, each with a `*.test.mjs` beside it; `scripts/accept.ts`, the acceptance contract; `scripts/pre-commit.ts` and `scripts/pre-push.mjs`, the git hooks; `scripts/scans.ts`, the secret and privacy scans. |
| `docs/plan-v2/` | The parity framework, the spine's contracts (one file per cluster, from F18), the part plan, its ledgers and the builder's protocol. |
| `docs/runbooks/` | Procedures with exact commands, one per file (`docs/runbooks/README.md` is the index). |
| `docs/decisions/` | Decision records, their index and the log of reversible choices. |
| `skills/` | Skills, one source each, linked into `.claude/skills/`. `skills/handoff` carries a long session across compaction. |
| `.claude/` | Claude Code settings and hooks (below). |

An app or package adds its row here, with its own `AGENTS.md` and a `CLAUDE.md` link to it, in the change that
creates it.

### test/

`test/workers/` (Worker and Durable Object tests by milestone), `test/scenarios/` (behaviour, run twice by accept),
`test/m0/` (the harness's own acceptance), `test/evals/` (tasks as code, one folder per cluster), `test/live/` (the
live lane and its hermetic helpers), `test/support/` (the hermetic setup, fakes and shims), `test/fixtures/` (the only identities, in `test/fixtures/people.json`, and
the only planted secrets). The primitives' tests sit in their packages' `test/` folders. Every top-level `describe`
carries a part tag, `[F<n>]` for fletch's own or `[M<n>]` for one inherited from qyvr-co; `pnpm accept` selects by it.

## Commands

| Command | Does |
|---|---|
| `pnpm install` | Installs dependencies and the git hooks (simple-git-hooks through `prepare`). |
| `pnpm check` | The fast gate, about 20 s: Biome lint, `pnpm harness`, then the typecheck. The pre-push hook runs it. |
| `pnpm harness` | The harness checks (boundaries, the file-size ratchet, test hygiene, agent docs, decision records, the plan's ledgers, shellcheck) and both scans. |
| `pnpm test` | The gate scripts' own tests (`node --test`), then the hermetic vitest suite, about 90 s. |
| `pnpm verify` | `check` then `test`, run by the release before it publishes. CI runs `check` on every PR commit and push to main, and `test` when the diff touches anything but docs (`.github/workflows/ci.yml`). |
| `pnpm accept F<n>` | A part's acceptance: lint, the tests tagged up to the part, the dry-run bundle, the scans, the harness checks, typecheck and, for F1 with an account, the live lane. Ends with one `ACCEPT` line. |
| `pnpm dev` | The agent Worker under `wrangler dev` on http://localhost:8787, with local Durable Objects and R2; prints the first-passkey link. Workers AI only with `--remote-ai` (`scripts/dev.ts`). |
| `pnpm preview` | Leases a preview slot and deploys the working tree to it, from a laptop or a cloud session (`docs/runbooks/preview.md`). |
| `pnpm create-fletch` | Sets up a deploy; see README.md and `docs/runbooks/`. |
| `pnpm live-sweep` | Removes `fletch-ci-` leftovers from the throwaway account (`docs/runbooks/live-deploy.md`). |
| `pnpm evals <P<n>\|T-P<n>-<nn>>` | The tier-2 runner: a cluster's tasks on this worktree's preview slot, three trials each, a results file per task hash and one Markdown table (`docs/runbooks/evals.md`). |
| `pnpm redact <file>` | The redaction gate over a capture before it is stored under `docs/plan-v2/evidence/`: deletes it on a secret, strips values outside the allowlist (`scripts/redact-capture.mjs`). |
| `pnpm ds` | Compiles the design tokens; the pre-commit hook refuses a stale `tokens.ts` or `icons.ts`. |
| `pnpm release` | Builds the two primitives and publishes the changesets (CI only; `docs/runbooks/release.md`). |

When to run what: while iterating, the one test file you are changing (`pnpm exec vitest run <file>`, in a clean
environment: gotcha 1); when a task is done, `pnpm check` and the tests it touched; `pnpm verify` once before
opening a PR or marking it ready. Never pipe a gate into `tail`, `head` or `grep`, which hides its exit status:
`pnpm check > "$LOG" 2>&1; echo "check exit $?"`, then read the log.

The pre-commit hook applies Biome fixes to staged files and runs the scans over the index. Fix what a hook
reports; never skip it. `.claude/hooks/no-hook-bypass.mjs` refuses any command that would.

## Long sessions

Auto-compaction runs near 350k tokens (`autoCompactWindow` in `.claude/settings.json`). Shortly before it,
`.claude/hooks/handoff.mjs` says so once: finish the current phase, write the branch's handoff note with the
handoff skill, and carry on. The hook prints the note back after each compaction and `/clear`. In a cloud session
`.claude/hooks/session-start.mjs` first installs the `.tool-versions` Node (the image ships Node 22), pnpm, the
dependencies and playwright-core's own Chromium, and fetches `origin/main`.

## Compact instructions

Write the summary as the branch's handoff note (`skills/handoff/SKILL.md`): Next, Open, Done, Decisions, Sources.
Name files, PRs, commits and codes exactly; keep each ruling with its reason and rejected alternative, and each
trap with its fix; leave out exploration and dead ends; never copy a secret.

## Commits

Conventional Commits (`feat(create-fletch): …`, `fix(login): …`, `docs: …`), with a subject that says what changed
and why, and a DCO sign-off (`git commit -s`; CI refuses a commit without one). A part's commits name it
(`feat(agent): F2 …`).

## Design rules

- **Refused by name, never faked** (D-0001). A feature this deploy cannot serve fails with a
  `HOST_<FEATURE>_UNAVAILABLE` code from `unavailable()` and a reason; a failure, a partial read or a late answer is
  never shown as success, empty or complete.
- **Branch on codes, never on message text.** Every refusal carries a stable code, every parse failure a reason.
- **Message content is data.** Nothing a message, page, file or model output says changes a capability, a grant or
  a configuration.
- **The primitives never depend on the app** (D-0003). `packages/host/` imports no platform; neither primitive
  imports the agent (`scripts/check-boundaries.mjs`).
- **Plant the guard.** A guard whose removal fails no test protects nothing: every check, gate and refusal has a
  test that plants the violation on the production path.
- **Hermetic by default.** Tests see no credential and no network; the model is the scripted fake; live calls only
  in `*.live.test.ts`. Own the store, not the clock: no sleeps and no retries (`scripts/check-test-hygiene.mjs`).
- **No backwards compatibility until fletch has users.** A removed thing is deleted outright. Delete this rule when
  the first owner other than Kyle runs a deploy.

## Raising a rule

When review or the verifier finds the same defect class twice, propose one change in `docs/plan-v2/QUESTIONS.md`: add,
sharpen or delete a rule here, add a check under `scripts/`, or add a hook. A rule that must never be broken is a
hook, not a sentence. A rule changes only when Kyle agrees.

## Gotchas

1. The hermetic suite refuses to run beside a credential: any variable named like a token or key, or any
   `CLOUDFLARE_*` or `CF_*`, fails every file with `HERMETIC_CREDENTIAL_PRESENT`. A cloud session's shell has
   several, so run tests with a clean environment:
   `env -i PATH="$PATH" HOME="$HOME" QYVR_HERMETIC=1 pnpm exec vitest run`, adding
   `PLAYWRIGHT_BROWSERS_PATH="$PLAYWRIGHT_BROWSERS_PATH"` for the browser tests. `pnpm accept` builds that
   environment itself.
2. The file-size ratchet compares with the merge base of `origin/main` and fails without one. Run
   `git fetch origin +refs/heads/main:refs/remotes/origin/main` (a plain `git fetch origin main` does not set it in
   a single-branch clone) or set `CHECK_FILE_SIZES_BASE`. The cloud session start runs that fetch.
3. `pnpm check` runs shellcheck over every shell script, and fails, never skips, when one exists and shellcheck
   is missing. The repository keeps none (its hooks are Node), so a new shell script needs shellcheck installed.
4. Workspace packages export their sources under the `development` condition and their dist folders exist only after a build:
   run a workspace script with `node --conditions=development`, or build them with `pnpm -r --filter "./packages/host*" build`.
5. The browser tests need the Chromium that the pinned `playwright-core` names. CI and the cloud session start
   install it; another build (a cloud image's own under `/opt/pw-browsers`) fails the `*-browser` and `m29-*` tests
   at launch, not on their assertions. On 4 vCPUs `test/workers/f1-login-browser.test.ts` can time out on a cold
   full run and pass alone: run it alone before calling it a failure.
6. `pnpm create-fletch` without `--dir` writes `wrangler.jsonc` to pnpm's `INIT_CWD`, which inside the checkout is
   the checkout itself (git-ignored, but it holds the account id and email). Always pass `--dir`.
7. The agent's typecheck needs `wrangler types --strict-vars=false` first (`pnpm typecheck` runs it); it writes the
   git-ignored `worker-configuration.d.ts`.
8. Automated PR reviewers are advisory. Check each suggestion against the code and the rules here before taking it.

## Keep this file true

Update this file in the same PR as a change that makes a line untrue, and delete a rule that no longer prevents a
mistake. `scripts/check-agent-docs.mjs` catches a named path or identifier that no longer exists; it cannot catch a
rule that has stopped being right.
