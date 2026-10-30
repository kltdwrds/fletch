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

## F21 Reactions: a person's own message takes no reaction

**Read:** `docs/plan-v2/contracts/P1-reactions.md` (B-P1-10, Translation delta 6, T-P1-08),
`packages/agent/src/http/app/message-actions.ts` (`openActions`, `holdable`), `test/workers/m29-message-actions.test.ts`,
`test/evals/p1-reactions/surface-controls.task.ts`. The specimen `packages/agent/src/design/fletch/ds/specimens/reactions.html` (Kyle's look on it is UAT after the
build, never a blocker). No one-way door.

**Scope:** The ⋯ sheet and the 500 ms hold popover on the person's own message offer Reply and Copy and no reaction,
as the hover row already does; on the agent's message they keep the reactions. The m29 assertion that the person's own
message takes a reaction is replaced by its opposite. T-P1-08's own-message leg passes and its `it.fails` marker goes.
The contract's D14 planted failing write (Fresh-session check): a page test under `test/evals/p1-reactions/` in which
the reaction write fails and no chip is drawn, the chip appearing only once the store's frame carries the row.

**Acceptance:** `test/evals/p1-reactions/surface-controls.test.ts` passes whole under `[F20]` with no known-failure
marker; `test/workers/m29-message-actions.test.ts` asserts no reaction control on the person's own message at 390 and in
the hold popover, with the planted page that offers one failing the check; the planted failing write draws no chip
and the test fails when the page draws on the click instead of the frame; `ACCEPT F21: PASS`.

**Not in scope:** the server side (`reactionRefusal` keeps accepting a mid of either side; the contract grades the
surface); the `+` more control; any other delta of the contract.

## F22 Reactions: the care register and a reaction on a win

**Read:** `docs/plan-v2/contracts/P1-reactions.md` (B-P1-07, B-P1-11, finding 2 and the tier-2 table), `test/evals/p1-reactions/care-reaction.task.ts`
and `test/evals/p1-reactions/react-like-a-friend.task.ts` (the two graders, unchanged), `packages/agent/src/chat/instructions.ts`
(`REACTING`), `docs/runbooks/evals.md`. No one-way door. A live step: `pnpm evals` runs from Kyle's Mac on this
worktree's slot (`pnpm preview up`); if no slot can be leased, that is a question, not a reason to skip.

**Scope:** The agent's reacting instruction and its examples, so that on hard news the agent's reaction is 🫶 or none
and its reply carries no emoji, and a small win gets exactly one 👍 while an instrument-style request after it gets
none. The two tasks are the measure; their graders do not change. One harness gap the F20 verifier named goes with
it: T-P1-03's harness (`test/evals/p1-reactions/harness.ts`, `thumbs-up-answers-question.task.ts`) asserts that the
c2 reaction was stored, so the card leg cannot pass on a refused write (its hash moves; it is tier 1).

**Acceptance:** `pnpm evals T-P1-06` and `pnpm evals T-P1-09` each `pass` (three of three), the table in the PR body and
the results files committed; the tier-1 reactions tests still pass, T-P1-03's with the stored-reaction assertion and
its new `version_hash` in the contract; `ACCEPT F22: PASS`.

**Not in scope:** the surface (F21); any new task; a change to a grader or to the contract's clauses.

## Spine clusters

Parts for each cluster are added here by the orchestrator, numbered from F23, once `contracts/P<n>-<slug>.md` has its
translation. The order is by dependency (design §6): P2 loop, tools and deferral → P15 approvals and grants → P6
memory with context assembly → P7 jobs, hooks and ledger → P5 and P3 activity, provenance and delegation. Folded in
from the first plan: F7 (the address survives sign-in, and its one-way record) into P1's contract; F16 (the detail
pane per step type) and F17 (the activity eval) into P5's contract and tasks. The artifacts track (P4) continues on
its own seams and is not a spine cluster.

## F23 The loop as it is: P2's contract check and the tier-1 tasks on shipped behaviour

**Read:** `docs/plan-v2/contracts/P2-loop.md` (Clauses, Tasks, the Translation's survey, mapping, deltas and Build
notes), `test/m0/f20-contract.test.ts` (the contract check's pattern), `test/support/task.ts` and
`test/support/contract.ts`, `test/evals/p1-reactions/harness.ts` and one P1 task pair (the world, the seed, the
scripted model), the surveyed seams (`packages/agent/src/tools/registry.ts`, `packages/agent/src/context/assemble.ts`,
`packages/agent/src/chat/mailbox.ts`, `packages/agent/src/chat/engine.ts`, `packages/agent/src/chat/tools.ts`,
`packages/host/src/host.ts`) and the tests that already pin them (`test/workers/m3-tools.test.ts`,
`test/workers/m1-context.test.ts`, `test/workers/m24-2-steering.test.ts`, `test/workers/f1-refusals.test.ts`). No
one-way door. No live step.

**Scope:** `test/evals/p2-loop/`: a `.task.ts` for every task the contract names (fifteen; the contract check needs
each file to exist, load and carry its id and clauses), and a `.test.ts` tagged `[F23]` for the nine tier-1 tasks that
need no new surface: T-P2-01 (the deferred load, once per chat), T-P2-02 (the stable prefix and the dated envelope),
T-P2-03 (nothing streams before the last tool result), T-P2-05 (the steer folded in at the boundary with
`STEER_POLICY`), T-P2-07 (the write's result before the reply; the file link graded as a markdown link, its card is
F24's), T-P2-08 (a failed read is `isError` and plain words), T-P2-09 (`tool_search` before `HOST_PRINT_UNAVAILABLE`,
no code in the reply), T-P2-11 (the long-history reload, without the file card) and T-P2-15 (a tool result inside its
fence). A tool a task needs that the registry lacks (a `probe` namespace, a print feature the test host refuses) is a
test-host fixture under `test/support/`, never a production tool. `test/m0/f23-contract.test.ts` checks P2 as F20's
checks P1 (the planted guards are not repeated). The contract's fifteen `version_hash` lines are filled from Node's
own loader (Q14). A defect the pinning finds is fixed in the part when it is a line, else a question in
`QUESTIONS.md`.

**Acceptance:** the nine `[F23]` tests pass; `test/m0/f23-contract.test.ts` passes with no finding; every
`version_hash` in `contracts/P2-loop.md` is filled; `ACCEPT F23: PASS`.

**Not in scope:** the status line, the file card and the job wake (F24); tier 2; any change to a clause or to a
grader's intent; an exec surface; approvals.

## F24 The thread shows the work: the status line, the file card and a job's completion wakes the agent

**Read:** `docs/plan-v2/contracts/P2-loop.md` (B-P2-04, B-P2-06, B-P2-07, B-P2-10, deltas 4 to 6, the tier-2 tasks),
the specimen `ds/specimens/loop-status.html` (the status line and the file card in both themes, drawn by the
orchestrator before this part starts), `packages/agent/src/chat/activity-steps.ts` (`STEP_WORDS`, the wording to
reuse), `packages/agent/src/chat/engine.ts` (`handoff`, `notify`), `packages/agent/src/jobs/notices.ts`,
`packages/agent/src/http/app/chat.ts`, `packages/agent/src/chat/links.ts`, `docs/runbooks/evals.md`. No one-way
door. A live step: `pnpm evals` runs from Kyle's Mac on this worktree's slot (`pnpm preview up`); if no slot can be
leased, that is a question, not a reason to skip.

**Scope:** (1) A status line under the agent's avatar while a tool runs, derived from the turn's tool frames with a
per-tool wording table in the page (never from the model's text), gone at `turn_done` and `turn_failed` (T-P2-04).
(2) A file card in the thread for a markdown link to a file in the agent's store, name, kind and a preview or
glyph, drawn from the stored markdown and again after a reload (T-P2-10; then T-P2-07's link grader asks for the
card). (3) A job's terminal result wakes the agent through the path a delegation's handoff already takes, the
result as a harness handoff in the turn's input, an empty reply allowed on that event-driven turn and adding no
agent entry, the notice row kept as what the person sees, a second delivery of the same completion changing
nothing (T-P2-06). (4) Tier 2 on the slot: T-P2-13 (must-have), T-P2-12 and T-P2-14, three trials each, the
results files committed.

**Acceptance:** the `[F24]` tests for T-P2-04, T-P2-06, T-P2-10 and T-P2-07's card pass; `pnpm evals T-P2-13`
`pass` (three of three); T-P2-12 and T-P2-14 run and their results recorded whatever the verdict, the table in the
PR body; `ACCEPT F24: PASS`.

**Not in scope:** a URL unfurl (delta 5); a `message_break` split (delta 2); an exec tool; approvals (P15); a change
to a clause.
