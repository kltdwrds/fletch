# Parts

The roadmap, one part per section: what one builder session builds and proves with `pnpm accept F<n>`. The loop that
produces parts is `2026-10-29-parity-framework-design.md` §3; the builder's protocol is `KICKOFF.md`; status lives in
`PROGRESS.md`, not here. F0–F17 were the first plan (2026-10-20 to 2026-10-27): their rows are closed in `PROGRESS.md`
and their sections are in git history (`git show 34c6b0a:docs/plan/parts.md`). The pare-down that opened Phase 0
(design §5.1) was a plain PR, not a part.

Rules for every part:

- **Shape.** `## F<n> <title>` (or `### F<n>.<p>` after a split), then **Read:** (the only documents to load),
  **Scope:**, **Acceptance:** (claims a test can prove, each naming its test file once written), **Not in scope:**
  (binding), and **Rulings:** where the orchestrator settled something up front, "Ruling: X — because Y — if wrong, Z".
- **Splitting.** A builder may split its part into `F<n>.1`, `F<n>.2`, … here, log the split in `docs/decisions/log.md`,
  and do exactly one.
- **Tags.** Every new test file's top-level `describe` carries `[F<n>]` (or `[F<n>.<p>]`); accept selects the part's
  tests and every earlier one by it, and fails a part with no test of its own.
- **Writing parts.** The orchestrator adds parts: Phase 0's here, and a cluster's after its Interrogate and Translate
  stages have written `contracts/P<n>-<slug>.md`. A builder session never adds one. A part names the one-way decision
  it needs as a blocker in its Read line, so a session stops instead of taking it.

## Phase 0: the framework (design §5)

## F18 The contract kit

**Read:** the design (§3, §4, Appendix A, Appendix B), `test/support/scenario.ts` (what `defineScenario` records
today), `scripts/scans.ts` and `scripts/lib/secret-patterns.ts` (the scans the gate reuses), `docs/runbooks/preview.md`
(for nothing but the vocabulary). No one-way door.

**Scope:** The files every later cluster fills, and the two checks that keep them honest.

1. `docs/plan-v2/contracts/README.md`: the contract file template of Appendix A, with the rules for each section
   (a clause cites a row, a capture or a quoted line, or carries `[attested]`; a task names its file; a property row
   names its proof), `docs/plan-v2/SCORECARD.md` with its header row and no rows, and `docs/plan-v2/evidence/README.md`:
   what is stored there (captures, dump slices, Muse's answers, one folder per cluster, all git-ignored and local to
   Kyle's Mac), that every file passed `pnpm redact` first, and that only the README and `results/` (tier-2 verdicts:
   task hash, trial outcomes, timestamps, never agent or user text) are tracked (D-0014).
2. `docs/plan-v2/INTERROGATE.md`: the checklist the orchestrator follows in Muse's chat per scenario step (design
   §4.1: do, list calls, `SELECT` the changed rows, quote the governing text, `[attested]` for the rest), the browser
   capture per step (§4.2: screenshot, DOM note of roles, labels, hrefs and order, request log as method, path, status
   and body shape, a reload), the three-attempts rule, and the dump refresh and diff procedure.
3. The trace: `test/support/trace.ts` holds the Appendix B shape as types and `validateTrace()`, which refuses a
   document with prose in an asserted field or a tag outside the set; `defineScenario` writes one trace per run to
   `$QYVR_TRACE_DIR/<scenario id>.json` when that variable is set and nothing otherwise.
4. The redaction gate: `scripts/redact-capture.mjs <file>` runs the secret patterns over a capture, strips values
   from every field outside the allowlist (ids, enums, status codes, failure words, kinds), and deletes the file with
   a non-zero exit when a secret is found; `pnpm redact` names it.
5. Tasks as code: `test/support/task.ts` holds `defineTask()` with the Appendix A task fields (setup, turns,
   end_state, required_facts, minefields, collateral, graders, reference, `versionHash()` over all of them) so a
   tier-1 task runs under vitest as a scenario does and a tier-2 runner (F19) can read the same file.

**Acceptance:** `scripts/redact-capture.test.mjs` (a planted secret deletes the capture and fails; a value outside
the allowlist is stripped; an allowlisted field keeps its value); `test/m0/f18-trace.test.ts` tagged `[F18]` (a
scenario emits a trace that validates; prose in `failure.user_words` is accepted and prose in `state_delta` is
refused; no file is written without `QYVR_TRACE_DIR`); `test/m0/f18-task.test.ts` `[F18]` (`versionHash` changes
when a grader changes and not when a comment does; a task's minefield failing fails the task); `ACCEPT F18: PASS`.

**Not in scope:** the tier-2 runner (F19); any cluster's contract; the browser automation itself (the orchestrator
drives the built-in browser by hand).

## F19 The tier-2 runner

**Read:** F18's files, the design (§3 "Tiers", §5.2), `docs/runbooks/preview.md`, `scripts/preview.mjs`,
`test/live/f1-deploy.live.test.ts` (how a session is obtained on a real slot with the soft authenticator),
`test/support/soft-authenticator.ts`. Blocker on CI only: O9 (a live-model key and slot token in CI) is a one-way
door; until Kyle accepts its record the runner runs from Kyle's Mac against the worktree's leased slot.

**Scope:** `pnpm evals <cluster|task id>`: reads the task files under `test/evals/`, drives the worktree's preview
slot through the app's routes with a session obtained as the live test obtains one, runs each task three times,
grades by the task's code graders, and separates an infrastructure failure (no slot, a 5xx before the first model
call, a lease that lapsed) from an agent failure. Per task the verdict is `pass` (all three trials), `fail`, or
`infra`; a `regressed` or `improved` note is added when a result for the same `versionHash` exists. Results are
written to `docs/plan-v2/evidence/results/<versionHash>.json` and summarised as one Markdown table for the PR body. The CI wiring is written as a `proposed` record
(the key's scope, the spend cap, where it lives) and not enabled.

**Acceptance:** `test/m0/f19-evals.test.ts` `[F19]` against a fake slot: three trials and the `pass` rule; `infra`
never counted as `fail`; the same hash reuses the baseline and a changed grader does not; the table shape. One live
run of a trivial task on a preview slot, its table pasted in the PR body. `ACCEPT F19: PASS`.

**Not in scope:** CI (O9); a model judge or rubric; tier 3; any change to the agent.

## F20 The dry run: reactions

**Read:** the design (§5.3), `docs/briefs/reactions-spec-2026-10-23.md`, `docs/briefs/reactions-dump-2026-10-23.md`,
`docs/briefs/reactions-plan-fable-2026-10-23.md` (the ground truth the kit is tested against),
`test/workers/f10-reactions.test.ts` and `test/workers/f10-reactions-page.test.ts` (what shipped),
`docs/plan-v2/contracts/README.md`, `INTERROGATE.md`. No one-way door; this part is run by the orchestrator, not a
builder, and its scope names the contract file it writes.

**Scope:** The full loop once, on a capability that already shipped. Interrogate: the reaction scenario (ack on
work start, a 👍 answering a pending question, an ambient reaction, a reaction the agent sets) run in Muse's chat
per `INTERROGATE.md`, the captures through `pnpm redact` into `docs/plan-v2/evidence/p1-reactions/`, and
`contracts/P1-reactions.md` written with clauses that cite rows and captures by path. Translate: the survey of F10's code as shipped, the mechanism mapping, a property row for
approval finality (a reaction answering a question is an answer, never a grant), the deltas, and the fresh-session
check recorded in the file. Build: the tasks under `test/evals/p1-reactions/`, tier 1 under vitest and tier 2 with
`pnpm evals p1-reactions` on a preview slot. Lock: the first row of `SCORECARD.md`.

**Acceptance:** the contract file's every clause cites an evidence id or carries `[attested]` (a check in
`test/m0/f20-contract.test.ts` `[F20]` over the file); the fresh session's derived task list is in the file with no
open gap; the must-have tasks pass three of three in the `pnpm evals` table pasted in the PR body; the scorecard row
names the PR; `ACCEPT F20: PASS`. A task that fails against F10's code is a finding: it is recorded, and the fix is a
part of its own after this one.

**Not in scope:** changing the reactions behaviour; any other cluster; the deletion of `docs/briefs/` (the PR after
this one, once the contract stands on its own).

## Spine clusters

Parts for each cluster are added here by the orchestrator, numbered from F21, once `contracts/P<n>-<slug>.md` has its
translation. The order is by dependency (design §6): P2 loop, tools and deferral → P15 approvals and grants → P6
memory with context assembly → P7 jobs, hooks and ledger → P5 and P3 activity, provenance and delegation. Folded in
from the first plan: F7 (the address survives sign-in, and its one-way record) into P1's contract; F16 (the detail
pane per step type) and F17 (the activity eval) into P5's contract and tasks. The artifacts track (P4) continues on
its own seams and is not a spine cluster.
