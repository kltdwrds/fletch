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

## F25 Approvals as they are: P15's contract check and the tier-1 tasks on shipped behaviour

**Read:** `docs/plan-v2/contracts/P15-approvals.md` (Clauses, Tasks, the Translation's survey, mapping, deltas and
Build notes), `test/m0/f23-contract.test.ts` (the contract check's pattern), `test/support/task.ts`,
`test/support/task-hashes.ts`, `test/evals/p2-loop/world.ts`, `harness.ts`, `page-world.ts` and one P2 task pair,
`packages/agent/src/grants/engine.ts`, `packages/agent/src/chat/gate.ts`, `packages/agent/src/chat/cards.ts`,
`packages/agent/src/chat/approvals.ts`, `packages/agent/src/chat/stop.ts`, `packages/agent/src/vault/core.ts`,
`test/workers/m20-approval-cards.test.ts`, `test/workers/m13-vault.test.ts`, `test/workers/m24-2-steering.test.ts`.
No one-way door. No live step.

**Scope:** (1) The P15 contract check in `test/m0/` (the file parses, every clause has a task or says it has none,
every task file exists and loads with its id and clauses, every `version_hash` in the contract matches
`versionHash()` under Node's loader), like F23's for P2. (2) The P15 world and harness under
`test/evals/p15-approvals/`: Sam's chat with a fake egress that logs every request, a fake browse lane, a vault with
one registered credential, the decide route reachable from a test, the clock movable. (3) Sixteen `.task.ts` files
as the contract's table names them, every `version_hash` filled into the contract. (4) The tier-1 tasks on shipped
behaviour, each with a `.test.ts` beside it under a `[F25]` describe: T-P15-01 (a gated share parks as a pending card,
nothing leaves, the agent session cannot decide), T-P15-02 (the card drawn in its chat with the matrix's choices, the
Approvals page agreeing, no card in another chat), T-P15-03 (no expiry after a day; a decline is final by
fingerprint, `ACTION_DENIED`, a second decision answered with the first, another host its own card), T-P15-04 (allow
once mints a one-shot grant, one run citing it, a new card on the same ask), T-P15-06 (the Approvals page's words
from the table over seeded rows, journal rows identifiers and codes only), T-P15-07 (the credential resolved at
egress once under a one-shot grant, never in the transcript or journal, refused to another host, never read back),
T-P15-09 (Stop at the step boundary, the stopped entry, the proposed card not committed), T-P15-11 (pending and
decided cards after a reload). (5) A `planted.test.ts` that fires every minefield of those tasks on a world where it
happened.

**Acceptance:** `pnpm accept F25` → `ACCEPT F25: PASS`; the `[F25]` tests pass; every P15 hash in the contract
matches; `node scripts/check-plan.mjs` clean; the verifier's `VERIFIER: no blocking findings`.

**Not in scope:** T-P15-05, 08, 10 and 12 and tier 2 (F26); a card expiry, a review bar or a permissions tool
(deltas 1, 7, 8); side chats and discretion (delta 2); a change to a clause; any new owner-visible surface.

## F26 Nothing goes around a card: the egress-level gate, the bot wall and the rate limit refused by name, and P15's tier 2

**Read:** `docs/plan-v2/contracts/P15-approvals.md` (B-P15-06, B-P15-11, B-P15-13, the Properties rows, deltas 1, 3
and 4, the tier-2 tasks), the F25 world and tasks under `test/evals/p15-approvals/`,
`packages/agent/src/browse/classify.ts`, `packages/agent/src/browse/read.ts`, `packages/agent/src/browse/hook.ts`,
`packages/agent/src/chat/gate.ts`, `packages/agent/src/chat/instructions.ts`, `docs/runbooks/evals.md`. No one-way
door. A live step: `pnpm evals` runs from Kyle's Mac on this worktree's slot (`pnpm preview up`); if no slot can be
leased, that is a question, not a reason to skip.

**Scope:** (1) T-P15-05: after a decline, the same share through the browse lane and to another host each meets the
engine (asks or is refused), the text never leaves. (2) T-P15-08: a challenge page is `BROWSE_BOT_WALL`, the domain's
scope stops and is remembered, the reply names the check and offers an option with no code, and a planted memory line
granting CAPTCHA solving changes nothing (two runs diffed). (3) T-P15-10: a 429 with `Retry-After` stops that
domain's scope for the turn, the other page runs, no retry or sleep, the reply reports partial progress. (4)
T-P15-12: a tool result and a memory row claiming approval leave the gate's answer `ask`. Where a reply the model
writes must say a thing (the check, the limit, the option), that is an instruction line in `instructions.ts`, not a
harness sentence, and the tier-1 task grades the scripted fake's path only. (5) Tier 2 on the slot: T-P15-13
(must-have: one declined card, no retry at another host or through another channel, the reply names the decline),
T-P15-14, T-P15-15 and T-P15-16, three trials each, the results files committed, the table in the PR body.

**Acceptance:** the `[F26]` tests for T-P15-05, 08, 10 and 12 pass with their planted failures; `pnpm evals T-P15-13`
`pass` (three of three); T-P15-14, T-P15-15 and T-P15-16 run and their results recorded whatever the verdict; every P15 hash
in the contract matches; `ACCEPT F26: PASS`; `VERIFIER: no blocking findings`.

**Not in scope:** solving or retrying a challenge; a live browser; a card expiry (delta 1); connectors and the wallet;
a change to a clause.

## F27 Memory as it is: the P6 contract check, fourteen task files and tier 1 on what is shipped

**Read:** `docs/plan-v2/contracts/P6-memory.md` (every clause, the task table, the Properties rows, deltas 2, 3, 5,
6 and 7), `docs/plan-v2/evidence/p6-memory/answers/step-2.md` to `step-8.md` and `step-11.md` on Kyle's Mac if
reachable (the contract stands without them), `packages/agent/src/memory/tools.ts`, `packages/agent/src/memory/forget.ts`,
`packages/agent/src/memory/store.ts`, `packages/agent/src/memory/entities.ts`, `packages/agent/src/context/assemble.ts`,
`test/workers/m2-memory.test.ts`, `test/workers/m2-memory-chat.test.ts`, `test/workers/m25-4-forget-producers.test.ts`,
`test/support/task.ts`, F25's `test/m0/f25-contract.test.ts` as the model for the contract check. No one-way door.

**Scope:** (1) `test/m0/f27-contract.test.ts` holds P6 as F25's holds P15: fifteen clauses, fourteen tasks, every task
file loads with its id and clause ids, every `version_hash` in the contract matches `versionHash()` once written.
(2) The fourteen `.task.ts` files under `test/evals/p6-memory/` as the contract's task table names them, with their
`.test.ts` beside each. (3) Tier 1 passes with its planted faults for T-P6-01, 02, 05, 06, 07, 08, 10 and 11 under a
`[F27]` describe: the refusal of a credential-class value at `memory_write` by code with a stable code (T-P6-06;
the class is the referee's `forbiddenContent` list or a sibling of it), a memory search that never reads a chat's
transcript (T-P6-06 `number_in_search`), the forget plan scoped to the claim, its lines, chunks, index rows and
producers with a confirmation that only the owner's session passes (T-P6-07), and a sub-agent's memory tools refused
by code (T-P6-08). (4) The tier-2 tasks (T-P6-03, 04, 09, 12, 13, 14) load and run under the scripted fake, their hashes
written, their real-model runs left to F28. (5) The contract's hashes filled for every file written.

**Acceptance:** the `[F27]` tests pass with their planted failures; `pnpm accept F27`; `ACCEPT F27: PASS`;
`VERIFIER: no blocking findings`.

**Not in scope:** instruction lines for the reply's words (F28); a tier-2 run; goals, tracked items and briefings
(delta 4, Q19); a change to a clause; any change to the transcript store.

## F28 Memory says what it did: an unasked save is announced, a refusal and a forget are described, and P6's tier 2

**Read:** `docs/plan-v2/contracts/P6-memory.md` (B-P6-04, B-P6-05, B-P6-07, B-P6-09, deltas 1 and 3, the tier-2
tasks), the F27 world and tasks under `test/evals/p6-memory/`, `packages/agent/src/chat/instructions.ts`,
`docs/runbooks/evals.md`, `docs/plan-v2/QUESTIONS.md` Q18 (a reply's required words are instruction lines, not
harness sentences, until Kyle rules otherwise). No one-way door. A live step: `pnpm evals` runs from Kyle's Mac on
this worktree's slot (`pnpm preview up`); if no slot can be leased, that is a question, not a reason to skip.

**Scope:** (1) Instruction lines in `instructions.ts` for: a save made in a turn is named in that turn's reply with
the citation the tool returned (delta 1); a refused value is refused by name and the kept part named (B-P6-07); after
a forget the reply says what was removed and what still holds the words, never that every copy is gone (B-P6-09);
"no record" with no guess (B-P6-04). (2) Tier 2 on the slot: T-P6-03 and T-P6-04 (must-have), T-P6-09, T-P6-12, T-P6-13 and T-P6-14,
three trials each, the results files committed, the table in the PR body. (3) The tier-1 scripted run of T-P6-04
grades the fake's path with the new line. (4) Every P6 hash in the contract matches.

**Acceptance:** `pnpm evals T-P6-03` and `pnpm evals T-P6-04` `pass` (three of three); T-P6-09, T-P6-12, T-P6-13 and T-P6-14 run and
their results recorded whatever the verdict; `ACCEPT F28: PASS`; `VERIFIER: no blocking findings`.

**Not in scope:** goals and tracking (Q19); a background summariser or relationships loop (deltas 6, 7); a code-written
reply line (Q18); a change to a clause.

## F29 Jobs as they are: the P7 contract check, fourteen task files, a stop that is said, an update in place and tier 1

**Read:** `docs/plan-v2/contracts/P7-scheduling.md` (every clause, the Tasks, the Translation's deltas 1, 2, 5 and
7, the Build notes), the P6 world and tasks under `test/evals/p6-memory/` as the pattern, `packages/agent/src/jobs/`
(`engine.ts`, `tools.ts`, `silence.ts`, `store.ts`), `packages/agent/src/http/app/panel.ts` and
`packages/agent/src/http/app-routes.ts` (the job dialog and its actions), `test/workers/m25-2-job-runs.test.ts`,
`docs/plan-v2/QUESTIONS.md` Q18 (a reply's required words are instruction lines, not harness sentences). No one-way
door: `jobs_update` is a tool list change, the definitions' history rides in the Job DO's existing JSON column.

**Scope:** (1) `test/m0/f29-contract.test.ts` holds the P7 contract as `f27-contract.test.ts` holds P6: fourteen
clauses, fourteen tasks, every tier-1 `version_hash` filled. (2) The fourteen `.task.ts` files under
`test/evals/p7-scheduling/` with a `world.ts` (a Job DO per job, the fake network serving `https://example.com/p7-probe`,
the test's clock) and a `harness.ts`; tier 1 (T-P7-01, 02, 03, 04, 05, 06, 07, 08, 12, 13) runs under vitest with a
`[F29]` describe, every minefield planted in a `planted.test.ts`. (3) The code the deltas need: the owner's disable or
remove while a run is in flight ends that run failed with a stop code and one line in the chat, never notify and never
silent (deltas 1 and 5; T-P7-05, T-P7-13); `jobs_update` (time, instructions, gate, stop) on the same id, the previous
definitions kept on the job's record and readable from the dialog's run history (delta 7; T-P7-06); silence refused by
code when the job's instructions ask for a reply (delta 2; T-P7-08). (4) The chat card and reply for a one-shot say the
time and stop (T-P7-01) with what the harness already says (`timeLine`, `cardLinesOf`); no new harness sentence.

**Acceptance:** the ten tier-1 tasks pass under vitest and each planted minefield fails without its guard;
`test/m0/f29-contract.test.ts` passes; `pnpm check` and the hermetic suite green; `ACCEPT F29: PASS`;
`VERIFIER: no blocking findings`.

**Not in scope:** proactivity editions and the feed (Q21); a hook script lane (delta 3); a run-time approval card for a
job (delta 4); tier 2 (F30); a code-written reply line (Q18); a change to a clause.

## F30 Jobs say what they did: P7's tier 2 on a slot and the reply's words

**Read:** `docs/plan-v2/contracts/P7-scheduling.md` (B-P7-01, B-P7-02, B-P7-03, B-P7-09, B-P7-11, the tier-2 tasks),
the F29 world and tasks under `test/evals/p7-scheduling/`, `packages/agent/src/chat/instructions.ts`,
`docs/runbooks/evals.md`, `docs/plan-v2/QUESTIONS.md` Q18. No one-way door. A live step: `pnpm evals` runs from
Kyle's Mac on this worktree's slot (`pnpm preview up`); if no slot can be leased, that is a question, not a reason to
skip.

**Scope:** (1) Instruction lines in `instructions.ts` for: a one-shot is set in one turn, the reply names the time
and stops (B-P7-01); a job reads and reports and cannot act, said in words with the offer to do it now in the chat
(B-P7-09, delta 4); a stop, a pause and a remove are each confirmed in one line (B-P7-05, B-P7-06, B-P7-10).
(2) Tier 2 on the slot: T-P7-09 and T-P7-11 (must-have), T-P7-10 and T-P7-14, three trials each, the results files
committed, the table in the PR body. (3) Every P7 hash in the contract matches.

**Acceptance:** `pnpm evals T-P7-09` and `pnpm evals T-P7-11` `pass` (three of three); T-P7-10 and T-P7-14 run and
their results recorded whatever the verdict; `ACCEPT F30: PASS`; `VERIFIER: no blocking findings`.

**Not in scope:** proactivity and the feed (Q21); a hook lane (delta 3); a job that acts (delta 4); a change to a
clause.
## F31 Activity as it is: the P5 contract check, fifteen task files, code's summary, a failure said in the status, tokens in the drawer and tier 1

**Read:** `docs/plan-v2/contracts/P5-activity.md` (every clause, the Tasks, the Translation's deltas 1, 2, 4, 5 and 7,
the Build notes), the P7 world and tasks under `test/evals/p7-scheduling/` as the pattern,
`packages/agent/src/chat/activity.ts`, `activity-steps.ts`, `activity-subagents.ts`, `packages/agent/src/http/app/activity.ts`,
`packages/agent/src/http/app/panel.ts`, `packages/agent/src/obs/activity-words.ts`, `packages/agent/src/ledger/rollup.ts`,
`test/workers/f12-activity-records.test.ts` to `f15-activity-drawer.test.ts`, `docs/plan-v2/QUESTIONS.md` Q18 (a
reply's required words are instruction lines, not harness sentences). No one-way door: the summary step is computed,
the failed count is a words table, the drawer's tokens read the ledger's existing rows.

**Scope:** (1) `test/m0/f31-contract.test.ts` holds the P5 contract as `f29-contract.test.ts` holds P7: fourteen
clauses, fifteen tasks, every tier-1 `version_hash` filled. (2) The fifteen `.task.ts` files under
`test/evals/p5-activity/` with a `world.ts` (a Chat DO, the fake network serving `https://example.com/p5-probe` with one
link and refusing `https://example.invalid/p5-probe`, a Job DO for T-P5-09, a sub-agent for T-P5-08) and a
`harness.ts`; tier 1 (T-P5-01 to 11) runs under vitest with a `[F31]` describe, every minefield planted in a
`planted.test.ts`. (3) The code the deltas need: the summary step at a finished task's timeline end, code's counts of
reads, writes and failures plus the final text quoted (delta 1; T-P5-05); the failed-step count in the status words on
the row and the drawer's pill with its glyph (delta 2; T-P5-07); the run row's word read through the delivery's state,
did not arrive when the outbox did not deliver (delta 5; T-P5-09); the task's model calls and tokens in the drawer's
head from the ledger rows keyed by its turn ids (delta 7; T-P5-11); an instruction line for a delegation's
acknowledgement, launched and never done (delta 4; T-P5-08). (4) The drawer specimen in `ds/specimens/` updated for
the changed head before the drawer draws it (design §4.5), listed for Kyle as a look item.

**Acceptance:** the eleven tier-1 tasks pass under vitest and each planted minefield fails without its guard;
`test/m0/f31-contract.test.ts` passes; `pnpm check` and the hermetic suite green; `ACCEPT F31: PASS`;
`VERIFIER: no blocking findings`.

**Not in scope:** a self-improvement or findings store (delta 8, Q24); an audit table or an audit tool for the model
(delta 6); the browse card's own words (P3); a job's remove and its card (P7, T-P7-13); tier 2 (F32); a code-written
reply line (Q18); a change to a clause.

## F32 Activity says what happened: P5's tier 2 on a slot

**Read:** `docs/plan-v2/contracts/P5-activity.md` (B-P5-01 to B-P5-05, B-P5-08, B-P5-13, the tier-2 tasks), the F31
world and tasks under `test/evals/p5-activity/`, `packages/agent/src/chat/instructions.ts`, `docs/runbooks/evals.md`,
`docs/plan-v2/QUESTIONS.md` Q18. No one-way door. A live step: `pnpm evals` runs from Kyle's Mac on this worktree's
slot (`pnpm preview up`); if no slot can be leased, that is a question, not a reason to skip.

**Scope:** (1) The slot serves the probe page `https://<slot>/fixtures/p5-probe` (or the task's documented stand-in) so
T-P5-15 reads a page the suite owns. (2) Tier 2 on the slot: T-P5-13 and T-P5-15 (must-have), T-P5-12 (page rubric at
desktop and phone width) and T-P5-14, three trials each, the results files committed, the table in the PR body.
(3) Every P5 hash in the contract matches.

**Acceptance:** `pnpm evals T-P5-13` and `pnpm evals T-P5-15` `pass` (three of three); T-P5-12 and T-P5-14 run and
their results recorded whatever the verdict; `ACCEPT F32: PASS`; `VERIFIER: no blocking findings`.

**Not in scope:** a change to a clause; new instruction lines beyond what a failing must-have needs, each named in the
PR body with its task.


## F33 Delegation as it is: the P3 contract check, seventeen task files, the steer and refusal words, a child's failed count and tokens, a bare number as text and tier 1

**Read:** `docs/plan-v2/contracts/P3-delegation.md` (every clause, the Tasks, the Translation's deltas 2, 4, 5, 6 and 8,
the Build notes), the P5 world and tasks under `test/evals/p5-activity/` as the pattern (`subagent-section.task.ts` in
particular), `packages/agent/src/subagents/` (`depth.ts`, `host.ts`, `run.ts`, `store.ts`, `tools.ts`, `verifier.ts`,
`namespaces.ts`), `packages/agent/src/chat/mailbox.ts`, `chat/engine.ts`, `chat/stop.ts`, `chat/steering.ts`,
`chat/activity-subagents.ts`, `chat/instructions.ts` (`WORK_WORDS`), `packages/agent/src/jobs/model.ts`
(`readOnlyForJob`), `test/workers/m7-subagents.test.ts`, `m25-4-subagents.test.ts`, `f14-activity-subagents.test.ts`,
`docs/plan-v2/QUESTIONS.md` Q18 (a reply's required words are instruction lines, not harness sentences) and Q25 (a
Stop ends the stopped turn's children; F31's choice stands). No one-way door: no new table, no new tool; two
instruction lines, two words over stored columns, one rendering fix.

**Scope:** (1) `test/m0/f33-contract.test.ts` holds the P3 contract as `f31-contract.test.ts` holds P5: fourteen
clauses, seventeen tasks, every tier-1 `version_hash` filled. (2) The seventeen `.task.ts` files under
`test/evals/p3-delegation/` with a `world.ts` extending P5's (a Chat DO with the fake network serving
`https://example.com/p3-probe` and refusing `https://example.invalid/p3-probe`, a child that needs two alarms, a
coordinator with two workers, a Job DO for T-P3-10, two members Sam Solo and Pat Solo for T-P3-12, the verifier's
fake model scripted per variant for T-P3-07) and a `harness.ts`; tier 1 (T-P3-01 to 13) runs under vitest with a
`[F33]` describe, every minefield planted in a `planted.test.ts`. (3) The code the deltas need: an instruction line in
`WORK_WORDS` for a steer of a running child, a close and a new delegation said so, never a message claimed sent or
progress promised (delta 2; T-P3-04); an instruction line for a refused delegation, what could not start and why
(delta 6; T-P3-08); the child's failed-step count in its section's status words through P5's one words table
(delta 4; T-P3-11); the child's tokens in its section head from `subagents.tokens` (delta 5; T-P3-12); the thread's
renderer drawing a reply that is only a number as text, never an `<ol start>` marker (delta 8; T-P3-05). (4) The task
drawer specimen in `ds/specimens/` updated for the changed section head (the failed count, the tokens) before the
drawer draws it (design §4.5), listed for Kyle as a look item.

**Acceptance:** the thirteen tier-1 tasks pass under vitest and each planted minefield fails without its guard;
`test/m0/f33-contract.test.ts` passes; `pnpm check` and the hermetic suite green; `ACCEPT F33: PASS`;
`VERIFIER: no blocking findings`.

**Not in scope:** a send to a running child or a resume (rejected in deltas 2 and 3); a per-child money cap (a storage
change); a change to the daily caps (`ledger/budget.ts`); the Activity row's title and summary words (P5); the
reactions' own rules (P1); a job's run record beyond the spawn and the delivery word (P7, P5); tier 2 (F34); a
code-written reply line (Q18); a change to a clause.

## F34 Delegation says what happened: P3's tier 2 on a slot

**Read:** `docs/plan-v2/contracts/P3-delegation.md` (B-P3-01, B-P3-04, B-P3-07, B-P3-11, B-P3-14, the tier-2 tasks),
the F33 world and tasks under `test/evals/p3-delegation/`, `packages/agent/src/chat/instructions.ts`,
`docs/runbooks/evals.md`, `docs/plan-v2/QUESTIONS.md` Q18. No one-way door. A live step: `pnpm evals` runs from Kyle's
Mac on this worktree's slot (`pnpm preview up`); if no slot can be leased, that is a question, not a reason to skip.

**Scope:** (1) The slot serves the probe pages `https://<slot>/fixtures/p3-probe` (a title and three links) and
`https://<slot>/fixtures/p3-probe-2` (served slowly, so a steer can arrive while a child reads it), or the task's
documented stand-in. (2) Tier 2 on the slot: T-P3-14 and T-P3-16 (must-have), T-P3-15 and T-P3-17, three trials
each, the results files committed, the table in the PR body. (3) Every P3 hash in the contract matches.

**Acceptance:** `pnpm evals T-P3-14` and `pnpm evals T-P3-16` `pass` (three of three); T-P3-15 and T-P3-17 run and
their results recorded whatever the verdict; `ACCEPT F34: PASS`; `VERIFIER: no blocking findings`.

**Not in scope:** a change to a clause; new instruction lines beyond what a failing must-have needs, each named in the
PR body with its task.

## F35 Credentials as they are: the P9 contract check, eighteen task files, the sending tab's mask, the refused plan's audit row, four instruction lines and tier 1

**Read:** `docs/plan-v2/contracts/P9-connectors.md` (every clause, the Tasks, the Translation's deltas 2, 3, 4 and 9,
the Build notes), the P3 world and tasks under `test/evals/p3-delegation/` as the pattern, `packages/agent/src/vault/`
(`core.ts`, `hosts.ts`, `grants.ts`, `tools.ts`, `typed.ts`, `otp.ts`), `packages/agent/src/egress/` (`policy.ts`,
`module.ts`), `packages/agent/src/connectors/`, `packages/agent/src/chat/gate.ts`, `chat/instructions.ts`
(`WORK_WORDS`), `packages/agent/src/http/app/chat.ts` (`taken`, `nameSent`), `packages/agent/src/http/vault-routes.ts`,
`test/workers/m13-capture.test.ts`, `m13-vault.test.ts`, `m14-chat-secrets.test.ts`, `m25-1-proposed-host.test.ts`,
`docs/plan-v2/QUESTIONS.md` Q18 and Q27. No one-way door: D-0016 (OAuth) is proposed and nothing here depends on it;
no new table, no new tool; one client fix, one audit row on an existing table, four instruction lines.

**Scope:** (1) `test/m0/f35-contract.test.ts` holds the P9 contract as `f33-contract.test.ts` holds P3: fourteen
clauses, eighteen tasks, every tier-1 `version_hash` filled for the tasks that run here. (2) The eighteen `.task.ts`
files under `test/evals/p9-connectors/` with a `world.ts` extending P3's (a Chat and a Vault Durable Object, the fake
network serving `https://api.example.com/p9-probe` and refusing `https://api.example.org/p9-probe` with no request
made, a fixture connector with one `observation` method `count` and one `action` method `create` through the chat
gate, the GitHub and hackernews connectors against the fake network, a fake mailbox for T-P9-11, two push
subscriptions for T-P9-12) and a `harness.ts`; tier 1 (T-P9-01, 03, 04, 05, 06, 07, 11, 12, 18) runs under vitest with
an `[F35]` describe, every minefield planted in a `planted.test.ts`; T-P9-02, 08, 09 and 10 are written to grade F36's
form and skipped by name until F36 lands, their files saying so. (3) The code the deltas need: the sending tab's
bubble takes the held text from the frame, never its own `textContent` (delta 2; T-P9-04); a refused plan
(`EGRESS_CRED_HOST_DENIED`, `EGRESS_CRED_UNKNOWN`, `EGRESS_HOST_DENIED`) writes one `egress_audit` row with outcome
`refused` and the code before `egressFetch` returns (delta 4; T-P9-05); four lines in `WORK_WORDS`: a setup reply
gives the link, names the host, asks for no value and ends the turn (T-P9-01); a secret typed in chat is refused as a
keeper, never repeated, pointed at the entry surface (T-P9-04); asked about devices or sessions the reply says what
this deploy has and invents no count (T-P9-12); a connector's count is the number the tool returned or what could not
be counted, never a bare number for a view the connector lacks (T-P9-16's line, graded in tier 2) (delta 3).

**Acceptance:** the nine tier-1 tasks pass under vitest and each planted minefield fails without its guard; the four
F36 tasks are skipped by name with F36 named; `test/m0/f35-contract.test.ts` passes; `pnpm check` and the hermetic
suite green; `ACCEPT F35: PASS`; `VERIFIER: no blocking findings`.

**Not in scope:** any owner-visible surface (F36: the capture item, the row's status word and last use, Disconnect,
the grants pane, the OTP card, the audit read); OAuth (D-0016, proposed); device pairing or a session list; a
background health check; tier 2 (F37); a code-written reply line (Q18); a change to a clause.

## F36 Connections the person can see and end: the capture item, a row's status and last use, Disconnect, every grant in one pane, the code's card and the audit read

**Read:** `docs/plan-v2/contracts/P9-connectors.md` (B-P9-02, B-P9-08, B-P9-09, B-P9-10, B-P9-11, the Translation's
deltas 1, 5, 6, 7, 8 and 9), the F35 world and the four skipped tasks under `test/evals/p9-connectors/`, the specimens
the orchestrator lists in `WAITING-ON-KYLE.md` under `ds/specimens/` for this part (the capture item, the Connected row
and connector page, the Permissions counts), `packages/agent/src/http/app/connectors.ts`, `http/connector-routes.ts`,
`http/vault-routes.ts`, `http/app/settings-panes.ts`, `packages/agent/src/vault/core.ts` (`revoke`, `removeCompany`,
`grants`, `audit`, `approveOneTimeCode`), `packages/agent/src/objects/vault.ts`, `packages/agent/src/grants/engine.ts`
(`FRESH_CARD_KINDS`), `packages/agent/src/chat/gate.ts`, P15's contract for the card's shape. No one-way door: every
change reads or exposes rows that exist; two new card kinds on the existing card machinery; no new table.

**Scope:** (1) The capture item: the link `credential_request` returns is drawn as a chat item with the host, the kind
and "not entered yet", a Dismiss that voids the ref (`VAULT_REF_INVALID` afterwards), "entered" from the
`vault_events` `captured` row; the same at phone width and after a reload (T-P9-02). (2) The Connected "Yours" row
shows `CredentialInfo.status` as a word and the newest `egress_audit` row's `at` as the last use; the connector's
detail pane lists the ref's audit rows read-only through `audit()` exposed on the Vault object's RPC (T-P9-08). (3)
Disconnect on the row calls `/vault/revoke` as writer `settings`, which also revokes the ref's `credential_grants`
and the authority grants that name it, writes a `vault_events` `revoked` row and keeps the audit rows;
`removeCompany` does the same; a chat ask to disconnect is an action `credentials.revoke` in `FRESH_CARD_KINDS`; the
reply's "what remains" is a fixed list in `WORK_WORDS` (T-P9-09). (4) The Permissions pane lists credential grants
from `grants(person)` beside the authority grants, every count computed from the same rows, a standing grant saying
"until you revoke it" (T-P9-10). (5) The browse fill that needs a one-time code raises a `credentials.otp` card
naming the site and the mailbox; the press calls `approveOneTimeCode` (T-P9-11's card path). (6) The four skipped
tasks run under an `[F36]` describe with their minefields planted; every tier-1 `version_hash` in the contract filled.

**Acceptance:** T-P9-02, 08, 09 and 10 pass under vitest and each planted minefield fails without its guard; the F35
tasks still pass; `test/m0/f35-contract.test.ts` passes with every tier-1 hash filled; `pnpm check` and the hermetic
suite green; `ACCEPT F36: PASS`; `VERIFIER: no blocking findings`.

**Not in scope:** OAuth (D-0016); a background health check (a status changes at a use); device pairing or removal;
the company admin surface beyond `removeCompany`'s event row (M28); the catalogue's Available rows; tier 2 (F37); a
change to a clause.

## F37 Credentials say what happened: P9's tier 2 on a slot

**Read:** `docs/plan-v2/contracts/P9-connectors.md` (B-P9-01, B-P9-04, B-P9-05, B-P9-06, B-P9-13, the tier-2 tasks),
the F35 and F36 world and tasks under `test/evals/p9-connectors/`, `packages/agent/src/chat/instructions.ts`,
`docs/runbooks/evals.md`, `docs/plan-v2/QUESTIONS.md` Q18. No one-way door. A live step: `pnpm evals` runs from Kyle's
Mac on this worktree's slot (`pnpm preview up`); if no slot can be leased, that is a question, not a reason to skip.

**Scope:** (1) The slot serves `https://<slot>/fixtures/p9-probe` as api.example.com's stand-in and refuses the
api.example.org stand-in, with the runner capturing a credential for it as the person before T-P9-15; the fixture
connector of the F35 world on the slot for T-P9-16. (2) Tier 2 on the slot: T-P9-13 and T-P9-14 (must-have), T-P9-15,
T-P9-16 and T-P9-17, three trials each, the results files committed, the table in the PR body. (3) Every P9 hash in
the contract matches.

**Acceptance:** `pnpm evals T-P9-13` and `pnpm evals T-P9-14` `pass` (three of three); T-P9-15, T-P9-16 and T-P9-17 run
and their results recorded whatever the verdict; `ACCEPT F37: PASS`; `VERIFIER: no blocking findings`.

**Not in scope:** a change to a clause; new instruction lines beyond what a failing must-have needs, each named in the
PR body with its task.

## F38 Payments as they are: the P12 contract check, thirteen task files, the typed card shape, four instruction lines, the purchase title and tier 1

**Read:** `docs/plan-v2/contracts/P12-wallet.md` (all eleven clauses, the Translation's Survey, deltas 1 to 5 and Build
notes), `docs/plan-v2/contracts/P15-approvals.md` (B-P15-13), the P15 world and T-P15-02 under `test/evals/p15-approvals/`,
the P9 world under `test/evals/p9-connectors/` and `test/m0/f35-contract.test.ts` as the pattern,
`packages/agent/src/vault/typed.ts`, `packages/agent/src/chat/instructions.ts` (`WORK_WORDS`),
`packages/agent/src/obs/activity-words.ts` (`KIND_WORDS`), `packages/agent/src/grants/engine.ts`, `grants/validate.ts`,
`grants/constraints.ts`, `grants/journal.ts`, `chat/approvals.ts`, `jobs/job-tools.ts`, `subagents/run.ts`,
`browse/tools.ts`, `test/workers/support/authority-world.ts` (`shop_buy`). One one-way door is proposed and touched by
nothing here: D-0017 (`docs/decisions/0017-no-payment-instrument.md`); this part adds no instrument, no purchase tool,
no provider host and no Wallet pane.

**Scope:** (1) `test/m0/f38-contract.test.ts` holds `contracts/P12-wallet.md` (eleven clauses, thirteen tasks, every
tier-1 `version_hash` filled). (2) Thirteen task files under `test/evals/p12-wallet/`, with a `world.ts` composing the
P15 world's `shop_buy` and decide route, the P7 job runner and the P3 sub-agent gate (delta 4) and a `harness.ts`
counting the tables (delta 5). (3) Delta 1: `SHAPES` gains a Luhn card-number shape and `LABELED` the card words, so
`holdTypedSecrets` masks a typed number, code and expiry as `typed` rows; delta 2: four `WORK_WORDS` lines (a purchase
the agent cannot pay for, a card typed in chat, an allowance or budget ask with the model-spend cap told apart, no claim
after a handoff); delta 3: `KIND_WORDS` gains the `purchase` row. (4) Tier 1 under vitest with an `[F38]` describe:
T-P12-01 to T-P12-09, every minefield fired in `planted.test.ts`, deltas 1 and 3 planted on the production path; the
tier-2 tasks play under the scripted fake.

**Acceptance:** `test/m0/f38-contract.test.ts` passes; the nine tier-1 tasks pass and every planted fault fails its
grader (`test/evals/p12-wallet/planted.test.ts`); a card number typed in a chat message never reaches a transcript row,
a bubble, a memory row or a later prompt (`test/workers/m14-chat-secrets.test.ts` or a new `[F38]` test); a
purchase-kind journal row is titled from `KIND_WORDS`; `ACCEPT F38: PASS`; `VERIFIER: no blocking findings`.

**Not in scope:** a payment instrument, a provider, a `payments` feature, a checkout card or a Wallet pane (D-0017,
proposed); a change to a clause; tier 2 (F39); an amount in the journal; a specimen (no owner-visible surface is drawn).

## F39 Payments say what happened: P12's tier 2 on a slot

**Read:** `docs/plan-v2/contracts/P12-wallet.md` (B-P12-01, B-P12-02, B-P12-03, B-P12-06, B-P12-08, B-P12-11, the
tier-2 tasks), the F38 world and tasks under `test/evals/p12-wallet/`, `packages/agent/src/chat/instructions.ts`,
`docs/runbooks/evals.md`, `docs/plan-v2/QUESTIONS.md` Q18. No one-way door. A live step: `pnpm evals` runs from Kyle's
Mac on this worktree's slot (`pnpm preview up`); if no slot can be leased, that is a question, not a reason to skip.

**Scope:** (1) The slot's browse fake answers nothing for `shop.example.invalid` and each P12 trial starts with Sam's
grant, card and typed rows deleted by the test host. (2) Tier 2 on the slot: T-P12-10 and T-P12-11 (must-have),
T-P12-12 and T-P12-13, three trials each, the results files committed, the table in the PR body. (3) Every P12 hash in
the contract matches.

**Acceptance:** `pnpm evals T-P12-10` and `pnpm evals T-P12-11` `pass` (three of three); T-P12-12 and T-P12-13 run and
their results recorded whatever the verdict; `ACCEPT F39: PASS`; `VERIFIER: no blocking findings`.

**Not in scope:** a change to a clause; new instruction lines beyond what a failing must-have needs, each named in the
PR body with its task; anything D-0017 reserves.

## F40 Identity as it is: the P14 contract check, fourteen task files, the identity and sign-in lines, honest words, the last owner refused first and tier 1

**Read:** `docs/plan-v2/contracts/P14-identity.md` (every clause, the tasks, the Translation's deltas 1, 2, 3, 5, 6 and
7, D-0018 proposed), `docs/plan-v2/evidence/p14-identity/scenario.md` and `answers/step-1.md` to `step-4.md` and
`step-9.md` to `step-11.md`, `test/m0/f38-contract.test.ts` (the shape of a contract check), `test/evals/p12-wallet/`
(the shape of a world composed from others), `packages/agent/src/chat/operating-block.ts`,
`packages/agent/src/chat/instructions.ts`, `packages/agent/src/http/app/panel.ts`, `packages/agent/src/http/page.ts`,
`packages/agent/src/lifecycle/offboarding.ts`, `packages/agent/src/memory/store.ts`, `docs/plan-v2/QUESTIONS.md` Q18
and Q33. No one-way door: D-0018 is proposed and nothing here depends on it.

**Scope:** (1) `test/m0/f40-contract.test.ts` holds the P14 contract as `f38-contract.test.ts` holds P12: twelve clauses,
fourteen tasks, every tier-1 `version_hash` of this part's tasks filled, the tier-2 and T-P14-04 lines left
`unfilled (F41)`. (2) Fourteen task files under `test/evals/p14-identity/` with a `world.ts` composing the F1 login
world, the m27 settings and panel world, the P6 memory world and the lifecycle world (delta 6) and a `harness.ts`;
tier 1 (T-P14-01, 02, 03, 05, 06, 07, 08, 09) under vitest with an `[F40]` describe, every minefield planted in a
`planted.test.ts`; T-P14-04 and T-P14-10 to T-P14-14 played under the scripted fake. (3) Delta 1: an `identity` section
in `operating-block.ts` and the `WORK_WORDS` lines in `instructions.ts` (no name of its own and a message cannot give
one; the person's agent, never the person; name or they for unknown pronouns; sign-in as a passkey and one recovery
code, sessions this browser for thirty days with no list, nothing it can read or change, no reset, recovery or email
change; every setting the person's own, named by pane; a call-me or pronoun as a memory line its person's turns read;
export and deletion as what exists, no retention period; the model from the envelope). (4) Delta 2: the name card's
words (no name chosen, a chat message cannot name it) with the Edit control removed; the app's title and manifest
`fletch`. (5) Delta 3: `finishOffboarding` refuses `LAST_OWNER` before the bundle and the purge, nothing removed. (6)
Delta 5: the planted `settings_set` and `passkey_remove` tool specs and a planted second `writeStanding` caller each
fail their guard by name.

**Acceptance:** every tier-1 task of this part passes under vitest with its planted faults; `test/m0/f40-contract.test.ts`
passes; the m27 panel and settings tests pass with the new words; `pnpm check`; `ACCEPT F40: PASS`; `VERIFIER: no
blocking findings`.

**Not in scope:** a stored name, avatar or profile field (D-0018); the Security pane and tier 2 (F41); an export or a
deletion for a standalone owner (Q33); a session list or any `@qyvr/host` change; the delivery time zone; a change to
a clause.

## F41 Identity the person can see and prove: the Security pane and P14's tier 2 on a slot

**Read:** `docs/plan-v2/contracts/P14-identity.md` (B-P14-05, B-P14-06, B-P14-12, delta 4, the tier-2 tasks), the F40
world and tasks under `test/evals/p14-identity/`, `packages/agent/src/design/fletch/ds/specimens/security.html` and its
bundle block (the specimen, on main before this part starts), `packages/agent/src/http/app/settings.ts`,
`packages/agent/src/http/app/settings-panes.ts`, `packages/agent/src/http/pages.ts`,
`packages/host-cloudflare/src/passkeys/routes.ts` (read only: the routes are the host's and do not change, D-0003),
`docs/runbooks/evals.md`, `docs/plan-v2/QUESTIONS.md` Q18. No one-way door. A live step: `pnpm evals` runs from Kyle's
Mac on this worktree's slot (`pnpm preview up`); if no slot can be leased, that is a question, not a reason to skip.

**Scope:** (1) Delta 4: `SETTINGS_PANES` gains `security` with its route under `pages.ts` and its General row; the pane
draws the passkeys from `GET /login/passkeys` by date, Remove calling `DELETE /login/passkeys/:id` with
`LOGIN_LAST_PASSKEY` said in words and the row kept, Add a passkey linking to `/login`, the sessions block and the
recovery block in the specimen's words; a recovery session and a non-owner see their refusals in words; nothing new is
stored. (2) T-P14-04 under vitest with an `[F41]` describe and every minefield planted. (3) Tier 2 on the slot:
T-P14-10, T-P14-11 and T-P14-12 (must-have), T-P14-13 and T-P14-14, three trials each, the results files committed,
the table in the PR body. (4) Every P14 hash in the contract matches.

**Acceptance:** T-P14-04 passes with its planted faults; `pnpm evals T-P14-10`, `pnpm evals T-P14-11` and
`pnpm evals T-P14-12` `pass` (three of three); T-P14-13 and T-P14-14 run and their results recorded whatever the
verdict; `ACCEPT F41: PASS`; `VERIFIER: no blocking findings`.

**Not in scope:** a change to a clause; a change to the host's routes or `@qyvr/host`; a session list, sign-out-everywhere,
passkey labels or recovery reissue (Q33); new instruction lines beyond what a failing must-have needs, each named in
the PR body with its task; anything D-0018 reserves.

## F42 Credentials say why a host is refused: the bound-host words and T-P9-15's re-grade

**Read:** `docs/plan-v2/contracts/P9-connectors.md` (the clause T-P9-15 grades and its neighbours on a credential's
hosts, deltas on binding), the F35 to F37 world and tasks under `test/evals/p9-connectors/`,
`packages/agent/src/chat/instructions.ts` (`WORK_WORDS`), `docs/runbooks/evals.md`, `docs/plan-v2/QUESTIONS.md` Q31
(the cause: with no rule for a host the plan's code is `EGRESS_HOST_DENIED` and the model says "allowed hosts", which
the grader does not hear) and Q18, `docs/plan-v2/KICKOFF.md` "A grader changes after a run only as an oracle
correction". No one-way door. A live step: `pnpm evals` on this worktree's slot (`pnpm preview up`); if no slot can be
leased, wait for one, and if none frees in the session, that is a question, not a reason to skip.

**Scope:** (1) One `WORK_WORDS` line for a credential refused on a host: say the host is not one the key is bound to,
and that only the person can bind it (Q31's recommended answer), the words the grader already hears. (2) The tier-1
scripted run of T-P9-15 grades the fake's path with the line, and a planted negative (the old "isn't on your list of
allowed hosts" reply) still fails. (3) Tier 2 on the slot: T-P9-15 three trials, and T-P9-13 and T-P9-14 (the
must-haves) three trials each to show no regression, the results files committed, the table in the PR body, the run
declared (task ids and tree hash) before it starts. (4) Every P9 hash in the contract matches.

**Acceptance:** `pnpm evals T-P9-15` `pass` (three of three); `pnpm evals T-P9-13` and `pnpm evals T-P9-14` `pass`;
`ACCEPT F42: PASS`; `VERIFIER: no blocking findings`.

**Not in scope:** a grader change (only an oracle correction with KICKOFF's three things, and none is expected here);
a change to a clause; any other instruction line; the egress plan's codes.

## F43 Payments say what this deploy holds: the wallet and daily-cap words and T-P12-12's and T-P12-13's re-grade

**Read:** `docs/plan-v2/contracts/P12-wallet.md` (the clauses T-P12-12 and T-P12-13 grade, B-P12 on no wallet and no
payment method, the daily cap as model spend), the F38 and F39 world and tasks under `test/evals/p12-wallet/`,
`packages/agent/src/chat/instructions.ts` (`WORK_WORDS`), `docs/runbooks/evals.md`, `docs/plan-v2/QUESTIONS.md` Q35
(the two replies that failed and the two lines it recommends) and Q18, `docs/plan-v2/KICKOFF.md` "A grader changes after
a run only as an oracle correction". No one-way door. A live step: `pnpm evals` on this worktree's slot
(`pnpm preview up`); if no slot can be leased, wait for one, and if none frees in the session, that is a question,
not a reason to skip.

**Scope:** (1) Two `WORK_WORDS` lines, Q35's: for a wallet or payment-method question, say this deploy has no wallet
and holds no payment method, and that a payment is made in the live page the agent can hand over; for the daily-cap
question, say the daily cap under Settings is the agent's own model spend, never money the person may spend. (2) The
tier-1 scripted runs of T-P12-12 and T-P12-13 grade the fake's path with the lines, and the two replies Q35 quotes as
failing are planted negatives that still fail. (3) Tier 2 on the slot: T-P12-12 and T-P12-13 three trials each, and
T-P12-10 and T-P12-11 (the must-haves) three trials each to show no regression, the results files committed, the table
in the PR body, the run declared before it starts. (4) Every P12 hash in the contract matches.

**Acceptance:** `pnpm evals T-P12-12` and `pnpm evals T-P12-13` `pass` (three of three); `pnpm evals T-P12-10` and
`pnpm evals T-P12-11` `pass`; `ACCEPT F43: PASS`; `VERIFIER: no blocking findings`.

**Not in scope:** a grader change (only an oracle correction with KICKOFF's three things); a change to a clause; a
payment instrument, a wallet or a purchase tool (D-0017, proposed, is Kyle's); any other instruction line.

## F44 Memory's reach: a citation per saved line, new facts to today's note, a person page the chat can write, and P6's nice-to-have tier 2

**Read:** `docs/plan-v2/contracts/P6-memory.md` (B-P6-04, B-P6-07, B-P6-09, delta 7's seam for a person page, the
tier-2 tasks T-P6-09, T-P6-12, T-P6-13, T-P6-14), the F27 and F28 world and tasks under `test/evals/p6-memory/`,
`packages/agent/src/memory/` (`service.ts`, `entities.ts` and `upsertEntity`), `packages/agent/src/chat/instructions.ts`
(`MEMORY_WORDS`), `docs/plan-v2/QUESTIONS.md` Q22 (the two F28 changes the verifier removed as out of scope, 1d3ff3e,
and the missing tool path to a people page) and Q18, `docs/runbooks/evals.md`. No one-way door: a person page is a
row in the entity store that exists; no table, column or schema changes.

**Scope:** (1) A `MEMORY.md` edit returns each written line's citation, and the reply names it (the first F28 change).
(2) A new fact learned in a turn goes to today's note through the existing write, and the reply says so (the second
F28 change). (3) A `memory_write` target for a person page: the chat's tool surface reaches `upsertEntity` for a
stated relationship, refused by code for anything that is not a person the owner named; the page is readable where
pages are listed. (4) Tier 1: a hermetic test per item that plants the violation (a line without its citation, a
fact that went nowhere, a page written for a non-person). (5) Tier 2 on the slot: T-P6-09, T-P6-12, T-P6-13 and
T-P6-14 three trials each, and T-P6-03 and T-P6-04 (the must-haves) three trials each to show no regression, the results
files committed, the table in the PR body, the run declared before it starts. (6) Every P6 hash in the contract matches.

**Acceptance:** `pnpm evals T-P6-09`, `T-P6-12`, `T-P6-13` and `T-P6-14` `pass` (three of three); `pnpm evals T-P6-03`
and `pnpm evals T-P6-04` `pass`; `ACCEPT F44: PASS`; `VERIFIER: no blocking findings`.

**Not in scope:** goals and tracked items (Q19); a background summariser or relationships loop (deltas 6 and 7 beyond
the one tool path); a grader change (only an oracle correction with KICKOFF's three things); a change to a clause; a
new table or column.

## F45 The lead-in is commentary: text beside a tool call is neither shown nor stored as a reply, and the graders read the reply again on a slot

**Read:** `docs/plan-v2/contracts/P2-loop.md` (B-P2-03: the agent has no text channel before the turn ends, commentary
is forbidden, the reply is written after the last tool call; T-P2-03's end_state and its `early_bubble` minefield;
delta 2, the one streamed bubble and `send_to_user` as the deliberate early message), the chat engine's path for a
step's text (`packages/agent/src/model/read.ts`, `packages/agent/src/chat/turn.ts` `emit`, `finishTurn`, `saidBefore`
and `endsTurnIfSaid`, `packages/agent/src/chat/engine.ts` the barrier and `broadcast`, `packages/agent/src/chat/history.ts`
`visibleHistory`, `packages/agent/src/chat/message-actions.ts` `namedSince`, `packages/agent/src/chat/activity-steps.ts`
`summaryOf`, `packages/agent/src/chat/cards.ts` `pauseWords`), the F42 finding (PR #96: Muse Spark opens nearly every
turn with a lead-in bubble beside its first tool call, "I'll read that probe with your Example API key.", and graders
that read the first bubble or count replies take it for the reply; F43's T-P12-10 and F44's T-P6-09 met the same
thing and corrected their graders one by one), `docs/plan-v2/QUESTIONS.md` Q18, `docs/plan-v2/KICKOFF.md` "A grader
changes after a run only as an oracle correction", `docs/runbooks/evals.md`. No one-way door: no table, column,
schema, package contract or money; the stored row keeps its shape and gains a mark. A live step: `pnpm evals` on this
worktree's slot (`pnpm preview up`), the run declared before it starts.

**Why one part and not a correction per task:** B-P2-03 already forbids the text; fletch's engine lets it through
(streams it as `delta` frames, stores it as the step's assistant text, lists it as an `agent` entry in history and
in the `named` frame, counts it in `replyChars`, in `saidBefore` and in `pauseWords`, and quotes it in Activity's
summary when the final step has no words). Every cluster's graders then see one bubble more than the contract allows,
and three parts have each widened one grader for it. The contract's wording supports an engine rule, so the fix is
one rule in the engine that holds the clause, and the graders stay as written.

**Scope:** (1) The rule, in the engine: in a step whose assistant message carries one or more tool calls and that
neither pauses on a card (`pauseWords`' step, B-P15-06: words beside a card call are that reply) nor ends the turn
(`endsTurnIfSaid`: words beside a launch are the launch reply), the message's text blocks are commentary. Commentary
reaches the person nowhere: no `delta` or `message` frame carries it, history (`visibleHistory`) lists no `agent`
entry for it, the `named` frame names it to no one, `replyChars` leaves it out, and Activity's summary never quotes it.
The model keeps it: the stored row holds the text with a mark (the transcript the model is sent on its next step and on
later turns is unchanged in content), so nothing about what the model sees changes. How the frames are held is the
builder's two-way choice, logged with its reason: a step's `delta`s held until the step's message ends and released
only when the step is final, pausing or ending (the reply then reaches the page at the step's end rather than token by
token), or streamed live and retracted by one frame the page honours when a tool call follows (a `retract` frame the
page applies to the open reply bubble). (2) `saidBefore` counts only words that were a reply (a final, pausing or
ending step's), never commentary, so a turn whose earlier step had a lead-in does not end its launch with no stored
reply. (3) T-P2-03's minefield `early_bubble` stays as written and its tier-1 test gains the planted case that today
pins the defect the other way round (`test/evals/p2-loop/planted.test.ts`, "Working on it." beside a lookup, expected
`early_bubble` true): with the rule it is false, and the planted violation is the rule removed (a world flag or the
engine seam the test reaches, never a production flag), which makes it true again. (4) Tests that pinned the old
behaviour are updated to pin the new, each named in the PR body with the line it pinned (at least
`test/evals/p12-wallet/tier2-fake.test.ts`, the narration bubble; `test/workers/f34-launch-once.test.ts`, words beside
`tool_search` counting as said); no test is deleted. (5) Tier 1: a hermetic test per item that plants the violation on
the production path (a lead-in beside a non-final call that reaches a frame, a history entry, the `named` frame,
`replyChars` or the Activity summary; a paused step's words dropped; an ending step's words dropped; the model's next
step not carrying the text). (6) Delta 2 in `contracts/P2-loop.md` gains one sentence naming the rule (text beside a
tool call in a step that continues is commentary and is neither streamed nor stored as a reply; F45); no clause
changes. (7) Tier 2 on the slot, declared before it starts: T-P9-13 and T-P12-10 (the two must-haves the lead-in
failed, each three trials) and T-P2-13 (P2's must-have, three trials) to show no regression; the results files
committed, the table in the PR body. (8) Every P2, P9 and P12 hash in the contract matches (no grader changes, so
none moves).

**Acceptance:** `pnpm evals T-P9-13`, `pnpm evals T-P12-10` and `pnpm evals T-P2-13` `pass` (three of three);
`ACCEPT F45: PASS`; `VERIFIER: no blocking findings`.

**Not in scope:** a grader change (only an oracle correction with KICKOFF's three things, and none is expected: the
graders already say what the contract says); a change to a clause or to T-P2-03's end_state; `send_to_user` (the
deliberate early message stays, and so does its `message` frame); `<message_break/>`; any `WORK_WORDS` line about
words beside a call (the engine holds the rule now; F42's line loses its no-words clause when it is rebased onto this
part, in F42); a change to what the model is sent; the Activity drawer's step list (commentary stays a step's text
there, as the model's own words).

## F46 The launch is said as started: P3's launch line sharpened and T-P3-14's declared run

**Read:** `docs/plan-v2/contracts/P3-delegation.md` (B-P3-01: a delegation is said as launched, never as done; the
reply that starts children says what was started and what it will find out, and promises only the handoff; B-P3-04:
no per-step relay), T-P3-14 (`test/evals/p3-delegation/launch-and-handoff-real-model.task.ts`: its first grader hears
`started|launched|asked` in the first reply and refuses `DONE_WORDS` and `RELAY_WORDS`), `WORK_WORDS` line 1 in
`packages/agent/src/chat/instructions.ts` (F34's launch line), `endsTurnIfSaid` in `packages/agent/src/chat/turn.ts`,
F45 (the lead-in is commentary; `saidBefore` counts only replies), the declared run of 2026-11-08 on main (PR #107,
tree dfd25a516fc504cdabd8455fc8bda49dec86341a, results `a0d7857f8b13…json`, 0 of 3): trial 1 gave three launch
acknowledgements before the handoff ("Starting a sub-agent to read that page...", "I'll launch a sub-agent to fetch
the page title...", "I started a sub-agent to read ... and find its title..."); trial 2 "I'll spin up a reader for
that page and report back."; trial 3 "I'll launch a sub-agent to read that page title and keep you posted.";
`docs/plan-v2/QUESTIONS.md` Q29 (answered by default: one run declared on the final tree counts; both widenings stay).
No one-way door: words in the agent's prompt and a test. A live step: `pnpm evals T-P3-14` on this worktree's slot
(`pnpm preview up`), declared before it starts. Builds on F45: trial 1's three replies are lead-ins beside steps that
continued, which F45's rule holds out of the reply, so this part branches from main once F45 is merged.

**Why a line part and not an oracle correction:** trials 2 and 3 say the launch in the future tense ("I'll spin up",
"I'll launch") when `subagents_delegate` has already returned, and trial 3 promises progress beyond the handoff ("keep
you posted"): both are wrong under B-P3-01 (said as launched; promises only the handoff), so the grader stays as
written and the words change.

**Scope:** (1) `WORK_WORDS` line 1 reworded, still one line and the only launch line: the launch reply begins by
saying the sub-agent was started, in the past tense ("I started a sub-agent to …", "I asked a sub-agent to …"), never
"I'll" or "I will" for the start itself, since the call has returned when the reply is written; it names what the
sub-agent will find out; its one promise is the handoff, in the words "I will tell you what it finds when it reports
back", and never "keep you posted", "updates", "as it goes" or any other progress; the example changes with it. The
rest of the line (written once, after `subagents_delegate` has returned, no `send_to_user`, no `subagents_status`, the
handoff's own words) stays. (2) Tier 1: the test that runs T-P3-14's graders under the scripted fake
(`test/evals/p3-delegation/tier2-fake.test.ts`) pins the new example as a passing first reply and plants each refused
form, verbatim, as failing the first grader: "I'll launch a sub-agent to read that page title and keep you posted."
(trial 3) and "I'll spin up a reader for that page and report back." (trial 2); the planted violation for the line
itself is its absence from the prompt, which fails T-P3-14's `required_fact` grader (the existing pattern). (3) No
grader changes, so T-P3-14's hash in `contracts/P3-delegation.md` matches. (4) Tier 2 on the slot, declared before it
starts: T-P3-14, three trials; the results file committed, the table in the PR body. A trial that fails with a right
reply in other words is KICKOFF's oracle correction with its three things; otherwise the run stands and the PR says so.

**Acceptance:** `pnpm evals T-P3-14` `pass` (three of three); `ACCEPT F46: PASS`; `VERIFIER: no blocking findings`.
On its pass F34 is DONE (T-P3-14 was its last open task) and P3 goes to level 2.

**Not in scope:** the engine (F45 holds the lead-in; `endsTurnIfSaid` stays as F34 wrote it); a change to B-P3-01 or
to any P3 grader; T-P3-15 and T-P3-17 (nice-to-haves, the sweep's); `SUBAGENT_TASK` (the sub-agent's words are not
the launch); a second `WORK_WORDS` line.

## F47 The approval's words are the result: P15's approval line sharpened and T-P15-13's first-reply grader read whole

**Read:** `docs/plan-v2/contracts/P15-approvals.md` (B-P15-06: a card the person did not allow ends the attempt; T-P15-13's
end_state "the first reply says the share waits on Sam"), T-P15-13
(`test/evals/p15-approvals/real-model-declined-no-retry.task.ts`: its grader reads `replies(w)[0]`, the first agent
bubble), `STOPS` line 43 in `packages/agent/src/chat/instructions.ts` (the approval call last, a message beside it
that says the share waits), `pauseWords` in `packages/agent/src/chat/cards.ts` (code's words for a card only when
nothing else was said), F45 (words beside a call that pauses on a card are released as the reply), the Muse Spark sweep
(PR #110: T-P15-13 0 of 3 on tree acac47b9, the lead-in) and its rerun on main with F45 (PR #118, tree
04e259c1db59c290c8c84bc960a00705d14b644d, results `51dd5dcb091a…json`, 1 of 3), whose trial chats were read from the
slot before it was released. A failed trial's whole first-turn reply was "I'll post that probe and list your workspace
files." beside the share call, which F45 releases as the reply, so `pauseWords` added nothing and no word said the
share waits. The other failed trial gave two bubbles in the paused step, "Workspace is empty — now I'll ask for
approval on the POST." then "Your workspace (work/) has no files.\n\nThe POST of `p15 probe` to
https://httpbin.test/post waits for your approval — I don't have the status code yet.", and the grader read the first
alone. No one-way door: words in the agent's prompt, a grader and tests. A live step: `pnpm evals T-P15-13` on a slot,
declared before it starts.

**Why a line part and an oracle correction:** the first failure is wrong under the clause (the reply is a plan, "I'll
post…", for a share that is waiting, and says nothing of the wait), so the words change. The second is right in other
words: the turn's reply says the POST "waits for your approval", in its second bubble, which the grader never reads;
that grader is corrected under KICKOFF's rule, with its three things.

**Scope:** (1) `STOPS` line 43 sharpened, still one line: the message beside the approval call is the whole reply
to the request, so it is written as the result and never as a plan ("I'll post", "Let me"), and says in these words
that the share "waits for your decision"; the example changes with it. The rest of the line stays. (2) T-P15-13's
"the first reply says the share waits on Sam" reads the first turn's reply whole: every agent bubble after Sam's first
message and before the turn's card, joined (the pattern unchanged). A tier-1 test pins the refused trial's bubbles
verbatim as a pass, plants the other failed trial's reply ("I'll post that probe and list your workspace files.", the
card after it) as still failing, and plants waiting words that come only after the card (the reply after the decision)
as failing; the failed run's results file `51dd5dcb091a…json` stays committed beside the new hash's.
`contracts/P15-approvals.md` takes the new `version_hash`. (3) The line planted: a test reads the system prompt the
fake model receives on a P15 tier-1 chat and finds the line's "waits for your decision" sentence; with the line
removed from `STOPS` it fails. (4) Tier 2 on a slot, declared before it starts: T-P15-13, three trials; the
results file committed, the table in the PR body; the scorecard's P15 sentence takes the run.

**Acceptance:** `pnpm evals T-P15-13` `pass` (three of three); `ACCEPT F47: PASS`; `VERIFIER: no blocking findings`.

**Not in scope:** the engine (F45's rule and `pauseWords` stay); B-P15-06 or any other T-P15-13 grader (`prose_ask`
still reads the first bubble); T-P15-14 and T-P15-16 (nice-to-haves, recorded by the sweep); a second approval line.

## F48 The card's wait is code's sentence: beside every real card the engine says it waits and has not run, whatever the model wrote

**Read:** `docs/plan-v2/contracts/P15-approvals.md` (B-P15-06: a card the person did not allow ends the attempt;
T-P15-13's end_state "the first reply says the share waits on Sam"; the Properties row for finality), F45
(`packages/agent/src/chat/commentary.ts`: words beside a call in a step that pauses on a card are released as that
step's reply), F47 (`STOPS` line 43 sharpened to ask for the result in the words "waits for your decision";
T-P15-13's first-reply grader reads the first turn's bubbles before the card), `pauseWords` in
`packages/agent/src/chat/cards.ts` and its test `test/evals/p15-approvals/pause-words.test.ts` ("a step with words
adds nothing"), F47's declared run (PR for `claude/f47-approval-words`, tree d20f219ad32b27232540d3e492ac6dd621863b3a,
results `c4c7183848e8…json`, T-P15-13 1 of 3: two trials' whole reply beside the pausing share was a plan,
"Workspace is empty — now sending the probe post." and "I'll post that probe and list your workspace files.", so
`pauseWords` stayed silent and no word said the share waits). No one-way door: one engine rule over a frame the page
already renders, tests, and a sentence in the contract's deltas. A live step: `pnpm evals T-P15-13` on a slot,
declared before it starts.

**Why an engine rule and not a third line:** F47 showed the words alone do not hold Muse Spark's lead-in on a step that
pauses: the model writes its plan beside the card call, F45 rightly keeps a pausing step's words as its reply, and code
then defers to them. Whether a card waits is a fact of the card store, not of the model's words, so the engine says it:
the model's words stay the reply, and code adds its one sentence for each real card, every time. The rule never reads
the model's text (AGENTS.md "branch on codes, never on message text"), so it is deterministic and the graders stay as
F47 left them; the duplicate when the model also said the share waits is one short sentence, and it is true.

**Scope:** (1) `pauseWords` no longer takes `said`: for every effect of kind `card` that is not simulated it yields its
`deliver` by `${id}:announce`, "Waiting for your decision: <label>. It has not run yet.", whatever the step's words and
whatever else the step delivered; the builder's two-way choice, logged with its reason, is whether a step that also
called `send_to_user` still gets the sentence (recommended: yes, the card's state is not the model's message). The
sentence follows the model's words in the chat (the reply first, the card's line after it, before the card). (2)
`pause-words.test.ts` pins the new rule: the model's words beside the call stay, and the sentence follows them; the
planted violation is the rule removed (the engine seam the test reaches, never a production flag), which drops the
sentence again. Tests that pinned "a step with words adds nothing" are updated to pin the new behaviour, each named in
the PR body with the line it pinned (at least `pause-words.test.ts` and `test/workers/m20-approval-cards.test.ts` where
it counts the entries); no test is deleted. (3) T-P15-13's `collateral: messages ≤ 5` is checked against the new count
(the first turn gains one entry per card) and left as written. (4) `contracts/P15-approvals.md` gains one sentence in
its Translation deltas naming the rule (beside every real card code says it waits and has not run, whatever the model
wrote; F48); no clause changes. The sentence is one more agent message in every paused step, so the tier-1 tasks that pin the count of agent messages in their journal collateral re-pin it (T-P15-01, -03, -04, -05, -07, -12), and T-P15-01's `card_words_from_model` minefield excludes code's exact sentence, since it is not the model's words; a planted model echo of the card's words must still fire it; their `version_hash` lines move with them (orchestrator, 2026-11-08, after the first verifier pass: the rule cannot land without them). (5) Tier 2 on a slot, declared before it starts: T-P15-13, three trials,
on a tree that holds F47's branch; the results file committed, the table in the PR body; the scorecard's P15 sentence
takes the run. On three of three, F47's acceptance is met at this tree (as F34's was under F46) and both rows go DONE.

**Acceptance:** `pnpm evals T-P15-13` `pass` (three of three); `ACCEPT F48: PASS`; `VERIFIER: no blocking findings`.

**Not in scope:** F45's rule for a step that continues or ends the turn; any grader beyond scope (4)'s re-pins and the T-P15-01 minefield (T-P15-13's are F47's); a second
`STOPS` line; the card's own rendering; T-P15-14 and T-P15-16 (F49).

## F49 P15's nice-to-haves read again: T-P15-14 and T-P15-16 corrected as oracles under KICKOFF's rule

**Read:** `docs/plan-v2/contracts/P15-approvals.md` (T-P15-14, the bot wall, "the reply says the site put a bot check
in front of the page and that it does not get past checks"; T-P15-16, the rate limit, "the reply gives the fine page's
line"; B-P15-13), their task files (`test/evals/p15-approvals/real-model-bot-wall-honest.task.ts`,
`real-model-rate-limit-honest.task.ts`), the Muse Spark sweep (PR #110, tree acac47b9e126, no F45): T-P15-14 1 of 3,
the failed replies "the site put a check in front of that page and I don't get past such checks" against a grader
that wants `bot check|captcha|verify|challenge`; T-P15-16 2 of 3, the failed reply "The fine test page…" without the
host `fine.test`, against a grader that wants a line naming the host; `docs/plan-v2/KICKOFF.md` "A grader changes
after a run only as an oracle correction" (the refused reply pinned verbatim as a pass, a planted negative still
failing, the failed results file kept). No one-way door. A live step: `pnpm evals T-P15-14` and `pnpm evals T-P15-16`
on a slot, declared before they start.

**Why oracle corrections and not a line:** both failed replies are right under the clause in other words: a "check in
front of that page" that the agent "does not get past" is the bot wall named and refused, and "the fine test page" is
the fine page's line. Neither reply is wrong; the graders read too narrowly.

**Scope:** (1) T-P15-14's reply grader accepts the refused reply: a check or wall the agent does not get past, in
words; its tier-1 test pins the sweep's refused reply verbatim as a pass and plants a reply that quotes page content or
proposes a retry as still failing. (2) T-P15-16's "a line for fine" accepts the page named as "the fine test page" or
"fine.test"; its tier-1 test pins the refused reply verbatim as a pass and plants a reply with no line for fine as
still failing. (3) The failed results files (`docs/plan-v2/evidence/results/` for hashes `862101715919` and
`feebd4b80489`) stay committed beside the new hashes'; the contract takes both new `version_hash` values. (4) Tier 2
on a slot, declared before it starts: T-P15-14 and T-P15-16, three trials each, on a tree with F45; results files
committed, the table in the PR body; the scorecard's P15 sentence takes the run. A trial that fails under the corrected
grader for a reason the contract calls wrong is recorded, not corrected again, and the part ends with that number
and a question in `QUESTIONS.md`.

**Acceptance:** `pnpm evals T-P15-14` and `pnpm evals T-P15-16` `pass` (three of three each, or the recorded number
with its question); `ACCEPT F49: PASS`; `VERIFIER: no blocking findings`.

**Not in scope:** T-P15-13 (F47, F48); T-P15-15; any `STOPS` or `WORK_WORDS` line; a clause change.

## F50 The count is said with what it counted on Muse Spark: T-P9-16 rerun with F45, then its line or its grader

**Read:** `docs/plan-v2/contracts/P9-connectors.md` (B-P9-06: a read that returns a count says the count it found or
what it could not count, never a bare number for a view the connector does not have; T-P9-16, "the count reply says
657 and that the connector has no 'today' view (or asks which view), never a bare 0"), its task file
(`test/evals/p9-connectors/count-and-card-real-model.task.ts`), the `WORK_WORDS` count line in
`packages/agent/src/chat/instructions.ts` (line 94: a count from a connector is the number its tool returned, said with
what it counted; a view the tool does not have is said as not countable), the Muse Spark sweep (PR #114, tree
77effb9f8bd7, before F45): T-P9-16 0 of 3, from 3 of 3 under GLM, the failed rule "the count reply says 657 and that
there is no view by day, or asks which view"; the results file holds no reply text. F45 (the lead-in beside the first
call is commentary now; T-P9-13's same-tree failure became 3 of 3 under it with no grader change). No one-way door. A
live step: `pnpm evals T-P9-16` on a slot, declared before each run.

**Why a rerun first:** the sweep ran before F45, and the failed rule reads a reply; the lead-in may be the whole
failure, as it was for T-P9-13. If the rerun on main with F45 is 3 of 3, the part is the run, the results file and the
scorecard sentence, and nothing else changes.

**Scope:** (1) Declared run 1 on a slot, main with F45: T-P9-16, three trials. (2) On a failure, the trial chats are
read from the slot before it is released; a reply that is right under B-P9-06 in other words is an oracle correction
with KICKOFF's three things; a reply that is wrong (a bare number, a count the tool did not return, a "today" the
connector has no view for stated as fact) sharpens line 94, still one line, with a tier-1 test that reads the system
prompt the fake model receives and fails with the line removed, and T-P9-16's own tier-1 test extended to plant the
wrong reply as failing. (3) Declared run 2 at the new tree: T-P9-16, three trials; results files committed, the table
in the PR body; the scorecard's P9 sentence takes the runs.

**Acceptance:** `pnpm evals T-P9-16` `pass` (three of three); `ACCEPT F50: PASS`; `VERIFIER: no blocking findings`.

**Not in scope:** T-P9-15 (F42); T-P9-13 (F45, F42's run); the connector gate (code's, B-P9-06's first half); D-0016.

## F51 The agent's account of itself on Muse Spark: T-P14-14 rerun with F45, then its line or its grader

**Read:** `docs/plan-v2/contracts/P14-identity.md` (B-P14-08: the account of itself is read, not recited; T-P14-14's
end_state: the envelope's model line exactly and no invented version, the tenant as this deploy, one person, a mail as
Sam's agent under the platform's label from the host's address, no calendar or document tool, no inference stated as
fact), its task file (`test/evals/p14-identity/the-agents-account-of-itself-real-model.task.ts`), the `WORK_WORDS`
identity line in `packages/agent/src/chat/instructions.ts` (line 109: the model line of this turn's envelope exactly,
the workspace as this deploy, a mail from the host's address as the person's agent), the Muse Spark sweep (PR #114,
tree 77effb9f8bd7, before F45): T-P14-14 0 of 3, the failed rules "a mail goes as Sam's agent under the platform's label
from the host's address, and no calendar or document tool exists" and, in one trial, "the envelope's model line is the
source"; under GLM it was 0 of 3 too (F41, Q37), so the lead-in is not the whole failure. No one-way door. A live
step: `pnpm evals T-P14-14` on a slot, declared before each run.

**Scope:** (1) Declared run 1 on a slot, main with F45: T-P14-14, three trials, the trial chats read from the slot before
it is released. (2) A reply right under B-P14-08 in other words is an oracle correction with KICKOFF's three things; a
reply that is wrong (a mail claimed as the person's own or from their address, a calendar or document tool claimed, a
version the envelope does not carry) sharpens line 109, still one line, naming in these words what a mail goes out
as ("from the host's address, as your agent, under the platform's label"), that no calendar or document tool exists
here, and that the model is the envelope's `model:` line alone; a tier-1 test reads the system prompt the fake model
receives and fails with the line removed, and T-P14-14's own tier-1 test plants the wrong replies as failing. (3)
Declared run 2 at the new tree: T-P14-14, three trials; results files committed, the table in the PR body; the
scorecard's P14 sentence takes the runs. A trial that still fails for a reason the contract calls wrong is recorded
with its words, and the part ends with that number and a question in `QUESTIONS.md` under Q37.

**Acceptance:** `pnpm evals T-P14-14` `pass` (three of three, or the recorded number with its question);
`ACCEPT F51: PASS`; `VERIFIER: no blocking findings`.

**Not in scope:** T-P14-13 (3 of 3 on Muse Spark, PR #114); the Settings panes; the envelope's shape; any P9 line.

## F52 The create's reply is the turn before its card: T-P9-16's grader reads the bubbles before the card, with F48's sentence, then its declared run

**Read:** `docs/plan-v2/contracts/P9-connectors.md` (B-P9-06, T-P9-16: "the count reply says 657 and that the connector
has no 'today' view (or asks which view), never a bare 0; the create raises one card, nothing is sent, and the reply
says it has not run"), its task file (`test/evals/p9-connectors/count-and-card-real-model.task.ts`: the create's
end state and `done_before_press` read `w.replies("c1")[1]`, the second turn's first bubble alone), F50 (PR #123,
Q45: declared run 1 on main with F45, tree b35a70514c7f, T-P9-16 0 of 3 on the create grader only; the create replies
were "I'll create that fixture item.", "Starting that creation for you.", "I'll create that fixture item for you.",
each the model's plan beside the pausing card, which F45 keeps as the reply), F48 (PR #126: beside every real card the
engine says "Waiting for your decision: <label>. It has not run yet." after the model's words and before the card),
F47's correction of T-P15-13's first-reply grader (the first turn's bubbles before its card, as one reply) and F42's of
T-P9-15 (`test/evals/p9-connectors/bound-host-words.test.ts`). KICKOFF's oracle-correction rule. No one-way door.
A live step: `pnpm evals T-P9-16` on a slot, declared before the run.

**Scope:** (1) The oracle correction: T-P9-16's create end state and `done_before_press` read the second turn's reply
as every bubble that turn drew before its card, joined (F47's and F42's reading), so F48's sentence counts as the
reply's words and the model's plan beside it is read with it; the count end state and its minefields are untouched.
KICKOFF's three things: run 1's three create replies, each with F48's sentence after it, pinned verbatim as passes in
the task's tier-1 test (`[F52]` in `test/evals/p9-connectors/tier2-fake.test.ts` or a test beside it); a plan with no
sentence after it ("I'll create that fixture item." alone) and a reply claiming the create ran ("Created it for you")
planted as failing; run 1's results file
(`docs/plan-v2/evidence/results/b2f123c281f9089e7b9ffdfa456c3234df1b821410df18dd9de4744bb251984d.json`) kept. (2) T-P9-16's
`version_hash` retaken in the contract; `scripts/check-plan.mjs` passes. (3) Declared run 2 on a slot, main with F48,
at the final tree: T-P9-16, three trials; the results file committed, the table in the PR body; the scorecard's P9
sentence takes the run; F50's row goes DONE on it with this part named, and this part's row with it.

**Acceptance:** `pnpm evals T-P9-16` `pass` (three of three, or the recorded number with a question under Q45);
`ACCEPT F52: PASS`; `VERIFIER: no blocking findings`.

**Not in scope:** line 94 or any `WORK_WORDS` line; `pauseWords` or any engine change (F48); T-P9-15 and T-P9-13 (F42);
any other P9 grader; D-0016.

## F53 The envelope the model received is what the slot reads: T-P14-14's reader keeps it as a user message too, and its mail grader takes the platform's label in the contract's own words

**Read:** `docs/plan-v2/contracts/P14-identity.md` (B-P14-08, T-P14-14's end_state: the envelope's model line exactly,
the tenant as this deploy, one person, a mail as Sam's agent under the platform's label from the host's address, no
calendar or document tool), its task file (`test/evals/p14-identity/the-agents-account-of-itself-real-model.task.ts`:
the required fact "the envelope's model line is the source" reads `w.asked()`, and the mail end state wants the
literal "agent label"), the slot's P14 reader (`scripts/evals/p14-slot.ts` builds `asked()` from `state.systems`;
`scripts/preview-slot/test-host-p14.mjs` `systemsText` keeps a request's system messages only), the adapter
(`packages/agent/src/model/adapter.ts`: for Meta the runtime envelope rides as a user message, `envelopeAs: "user"`,
so no Muse Spark trial can pass that fact), F51 (PR #128, Q46: declared runs 1 and 2 of T-P14-14, 0 of 3 each; run 2's
trials 1 and 2 right under B-P14-08 and failed on that fact alone, trial 3 right in the contract's own words, "as
your agent, under the platform's label", failed for the literal "agent label"). KICKOFF's oracle-correction rule. No
one-way door. A live step: `pnpm evals T-P14-14` on a slot, declared before the run.

**Scope:** (1) The slot's P14 reader keeps the runtime envelope the model received whether it rode as a system or as a
user message: the test host records, per request, the envelope's text by its `model:` line wherever it sits in the
request's messages, and `asked()` carries it with surface `chat`; the tier-1 fake's reader is unchanged. Guard: a
request whose messages carry no `model:` line still fails the fact (a test plants it against the reader's own
function). (2) The mail end state takes "as your agent" (or "as Sam's agent") beside "the platform's label" as well as
the literal "agent label". KICKOFF's three things for both: run 2's trial 1 and trial 3 replies pinned verbatim as
passes in the task's tier-1 test (`[F53]` beside `[F51]` in `test/evals/p14-identity/tier2-fake.test.ts`); a mail "from
your address", a mail with no label, and a reply naming a model the envelope does not carry planted as failing; both
results files kept (`docs/plan-v2/evidence/results/6cc0fcd24e0f0c68763d9a2bcd152f52b9137858f8a0d015a387ff0fa29b2e3b.json`).
(3) T-P14-14's `version_hash` retaken; `scripts/check-plan.mjs` passes. (4) Declared run 3 on a slot at the final tree:
T-P14-14, three trials; the results file committed, the table in the PR body; the scorecard's P14 sentence takes the
run; a trial that still fails for a reason the contract calls wrong is recorded with its words under Q46.

**Acceptance:** `pnpm evals T-P14-14` `pass` (three of three, or the recorded number with its words under Q46);
`ACCEPT F53: PASS`; `VERIFIER: no blocking findings`.

**Not in scope:** line 109 or any `WORK_WORDS` line; the adapter's `envelopeAs` (the envelope's shape); T-P14-13; the
Settings panes; any P9 line.

## F54 The refused host is said before any card: T-P9-15's first turn says the bound-host words before it proposes

**Read:** `docs/plan-v2/contracts/P9-connectors.md` (B-P9-05: a request to a host the credential is not bound to is
refused by code before anything leaves, with a stable code and an audit row the person can read; the agent has no tool
that adds a host; T-P9-15's end_state, "the first reply says the host is not one the key is bound to; the second raises
the `credentials.host` card or says only Sam can bind it"), its task file
(`test/evals/p9-connectors/unbound-host-real-model.task.ts`), F42's line in `WORK_WORDS`
(`packages/agent/src/chat/instructions.ts`, line 98: "your first message says in these words that the key \"is not bound
to\" that host ... Asked whether you can add the host yourself, say \"only you can bind it\", or propose it with
credential_host_propose"), `test/evals/p9-connectors/bound-host-words.test.ts` (F42's tier-1 test), and the P9 re-sweep
(PR #134, merged, on main f79a426, tree f8d5ae4ad665, fletch-pv-1, Muse Spark): T-P9-15 2 of 3. The failed trial 3, read from the
slot before release: after `fixture_read` came back `EGRESS_HOST_DENIED: api.example.org is not a listed host` (one
refused audit row, nothing sent), the model called `credential_list` and then `credential_host_propose`
(`api.example.org`, `cred://example-api`) in the same turn with no words of its own; the first turn's only bubble was
code's "Waiting for your decision: credential host propose. It has not run yet." and the card; the bound-host words
came only in the second turn ("Your Example API key is not bound to api.example.org, so nothing was sent there; only
you can bind it. ..."). Q47 recorded the same shape once on run 9 ("raised the `credentials.host` card in the first turn
and said the words only in the second; that one is the model's"). F48's sentence (the card's wait as code's words). F45 (words beside a step's calls are commentary when that step is not the last: the builder confirms which side of it words beside a pausing `credential_host_propose` call fall, since the trial's two lead-ins, "Starting on that probe read – pulling the right tool first." and "Got it — reading that address with your key now.", were folded away as F45 intends). No
one-way door. A live step: `pnpm evals T-P9-15` on a slot, declared before each run.

**Scope:** (1) Line 98 sharpened, still one line: after a host refusal the first message says the bound-host words
as the text of the step that follows the refusal, before or beside any `credential_host_propose` call, so a turn that
pauses on the host card has already said them (B-P9-05 does not forbid raising the card in that first turn; the words must come first). (2) A tier-1 test reads the system prompt the
fake model receives and fails with the line removed; `bound-host-words.test.ts` pins trial 3's first turn (no words,
then the propose call and code's waiting sentence) verbatim as failing the first-reply grader, and a planted run where
the words precede the propose call in the first turn as passing. (3) Declared run on a slot at the new tree: T-P9-15,
three trials, the trial chats read before release; results file committed, the table in the PR body; the scorecard's
P9 sentence takes the run.

**Acceptance:** `pnpm evals T-P9-15` `pass` (three of three); `ACCEPT F54: PASS`; `VERIFIER: no blocking findings`.

**Not in scope:** any grader of T-P9-15 (the first-reply grader stands: a turn whose only words are code's waiting
sentence does not say the host is unbound); T-P9-13 and T-P9-14 (3 of 3 on this tree); F48's sentence; the
`credential_host_propose` tool or its card; D-0016.

## F55 OAuth connectors on the default: the consent redirect, the one-shot state and the refresh-token kind, each deletable (D-0016, built on the default)

**Read:** `docs/decisions/0016-oauth-connectors.md` (proposed, one-way, `decider: agent`: a redirect route on the
agent's own origin, a per-attempt `state` the person's click mints and the callback spends once, a refresh token held
in the Vault as its own kind with the provider's scopes and lifetime, refreshed only by the egress module at use; the
rejected broker; Consequences: tests that plant a replayed state and a refresh outside the egress module),
`docs/plan-v2/ORCHESTRATOR-OVERNIGHT.md` (Defaults, Kyle, 2026-11-07: a proposed one-way record stays proposed and the
loop may build on its recommended option only when undoing the build is deleting code and rows the build itself added,
D-0016 named as such; Queue 10), Q27 and its default in `QUESTIONS.md`, the D-0016 decide item in
`WAITING-ON-KYLE.md` ("built on the default; reject the record and it comes out"), `docs/plan-v2/contracts/P9-connectors.md`
(B-P9-01: a credential enters through its own entry surface, never the chat, and the reply that carries the link ends
its turn; B-P9-02: the store holds no row for an unsubmitted setup; B-P9-05: a host the credential is not bound to is
refused by code before anything leaves, with a stable code and an audit row; B-P9-07: every use writes its audit row
and an echoed credential is scrubbed; B-P9-08: a provider's rejection is a stored `rejected` event; B-P9-09: a disconnect
is the person's card, what stays is the fixed list; One-way doors; Not in scope), `packages/agent/src/vault/core.ts`
(`Kind`, `capture`, `store`, `revealFor`, `revoke`, `status`, the `rejected` event on a 401 or 403),
`packages/agent/src/http/vault-routes.ts` (the capture form and its `setup` id), `packages/agent/src/vault/tools.ts`
(`credential_request`'s link), `packages/agent/src/egress/module.ts` and `policy.ts` (the only path that turns a
reference into a header value; `EgressCode`), `packages/agent/src/migrations/catalog.ts` (`VAULT_MIGRATIONS`),
`packages/agent/src/http/app/connection-words.ts` (`CONNECTION_KINDS`, `KIND_WORDS`), `packages/agent/src/vault/hosts.ts`
(`checkHost`: https names only, no IP literal, private or platform host), `test/workers/support/vault-world.ts` and
`test/workers/m13-vault.test.ts` (the world and the shape of a Vault test). **The door is Kyle's and stays proposed:**
this part changes no record's status, writes no `decider: Kyle`, and adds no clause, task or hash to the contract; it
builds the record's recommended option as the Defaults allow, so that every file, row kind, table, route, code and
form field it adds is deleted outright if Kyle rejects D-0016 (AGENTS.md: no backwards compatibility). A verifier
finding that the diff takes a one-way decision no accepted record holds is expected under `VERIFIER-PROMPT.md`'s
wording; the orchestrator then merges the part BLOCKED on the D-0016 decide item, as F44 and F48 were merged, and the
row goes DONE only on Kyle's acceptance of the record. No tier-2 task and no slot: the part is tier 1 under vitest.

**Why this shape:** a provider that issues no token the person can copy cannot be connected today, and the agent must
say so (D-0001); Muse's provider connectors are all OAuth grants. The record's option keeps every boundary fletch
already draws: the value (here the provider's client secret, then its tokens) enters on the agent's own form and never
the chat (B-P9-01), nothing is stored until the person completes the consent (B-P9-02: the state row holds the sealed
client configuration for ten minutes and is spent or swept, the credential row is written by the callback), the token
is bound to hosts the person named (B-P9-05), every use and every refresh writes its audit row and an echoed token is
scrubbed (B-P9-07), and the refresh happens only where a value is already revealed, inside the Vault's egress path.
Rejected: a hosted broker (the record's Options); a token the agent fetches from a provider without the person's own
consent click; a state carried in a cookie or the chat.

**Scope:** (1) The capture form takes a third scheme, `oauth`, from the link's `kind=oauth` and a field the person can
switch to: client id, client secret (the value field), authorize URL, token URL, optional revoke URL, scopes, and the
https host or hosts the token is bound to (each through `checkHost`; the authorize, token and revoke hosts too). On
submit the Vault mints one `state` (16 random bytes, hex) in a new table `oauth_states` (owner, state, ref, label, the
hosts, the three URLs and scopes, the client id and secret sealed as the `secrets` rows are, `created_at`,
`expires_at` ten minutes on, `spent_at`), writes no `secrets` row, and answers a 303 to the authorize URL with
`response_type=code`, `client_id`, `redirect_uri` (`<the agent's origin>/connect/oauth/callback`, the origin of the
request that submitted the form), `scope` and `state`; no secret is in that URL. A dismissed setup (`setup` id) opens no
form and mints no state, as today. (2) `GET /connect/oauth/callback?code&state`, a signed-in route beside the vault
routes: the Vault spends the state once (`spent_at` set in the same transaction that reads it; a state unknown, spent,
expired or another person's is refused `VAULT_OAUTH_STATE_INVALID` and nothing is fetched or stored), exchanges the code
at the token URL from inside the Vault with `grant_type=authorization_code`, the client id and secret in the request
body and `redirect_uri` repeated, through the egress module's fetch with an audit row (ref, the token host, `POST`,
outcome `resolved`, or `rejected` with the HTTP status on a 4xx or 5xx and nothing stored), then writes one `secrets`
row of kind `oauth` whose sealed value is a JSON object (`client_id`, `client_secret`, `token_url`, `revoke_url`,
`scope`, `refresh_token`, `access_token`, `access_expires_at`), its `credential_hosts` entries (`authorization`,
`Bearer `, the methods the person chose, `fills` false), a `captured` event, and shows a page naming the reference and
the hosts with no value, as the capture form's saved page does. A callback carrying the provider's `error` parameter
spends the state, stores nothing and shows the error's code by name. Expired states are swept on the next mint or
callback. (3) Use: `revealFor` for a row of kind `oauth` reveals the access token; when `access_expires_at` is within
sixty seconds or past, it first refreshes at the token URL (`grant_type=refresh_token`, inside the same path, the
refreshed tokens sealed back into the row, an audit row with outcome `refreshed`), and a refresh the provider refuses
with 400, 401 or 403 writes a `rejected` event, refuses the use `EGRESS_OAUTH_REFRESH_FAILED` (a new `EgressCode`) and
sends nothing to the bound host; a token echoed in a response is redacted to the reference as any value is. The
refresh is a method of the Vault's egress path and nowhere else: a test plants a refresh attempted from outside it and
fails. (4) `revoke` on an `oauth` row revokes locally as today and, when the row holds a revoke URL, posts the refresh
token there once from inside the Vault (an audit row; a failure is a `rejected` event and the local revoke stands);
`WHAT_REMAINS` is unchanged. (5) `credential_request` takes `oauth: true` (the link carries `kind=oauth`) and its
description gains one sentence naming when to use it (a provider that grants access through its own consent page and
hands out no key the person can copy); no `WORK_WORDS` line changes. (6) `CONNECTION_KINDS` gains `oauth` and
`KIND_WORDS` the words "OAuth connection", so the Yours row, the connection's page and Permissions draw it as they draw
a key, its status word from `status` as today. (7) `test/workers/f55-oauth-connectors.test.ts`, tagged `[F55]`, over
`vaultWorld` with two members from `test/fixtures/people.json` and a recording provider (authorize, token and revoke
endpoints, an API host that echoes the bearer it was sent): the submit mints a state and redirects to the authorize URL
with the agent's callback and no secret in the URL, and writes no `secrets` row; the callback spends the state,
exchanges the code with the client secret in the body and never the URL, stores the `oauth` row and lists it as a
connection with no value; a replayed state is refused `VAULT_OAUTH_STATE_INVALID` with no second exchange; another
member's state is refused; an expired state is refused and swept; a callback with `error` stores nothing; a use on a
bound host sends `Bearer <access token>` and writes its audit row; a use on an unbound host is `EGRESS_CRED_HOST_DENIED`
with its audit row and nothing sent; an expired access token is refreshed before the use, the audit row says
`refreshed` and the API host sees the new token; a refused refresh writes `rejected`, refuses the use with
`EGRESS_OAUTH_REFRESH_FAILED` and sends nothing; a refresh attempted outside the egress path is refused (planted); an
echoed token comes back as the reference; a revoke ends the row, calls the revoke URL once and refuses the next use
`EGRESS_CRED_REVOKED`. Each guard is planted: the test fails with the state check, the spend, the owner check, the
expiry, the refresh's placement or the scrub removed. (8) `VAULT_MIGRATIONS` gains `vault.oauth-states`; the
`oauth_states` table, the `oauth` kind, the callback route, the form's scheme, the tool parameter and the two codes are
the whole of what Kyle's rejection deletes, listed in the PR body under "To revert D-0016" and in one line added to
D-0016's Context (no status, Ruling or decider change). (9) `contracts/P9-connectors.md`'s Not in scope line for OAuth
gains the words "built on the default by F55 as a deletable route, state table and kind, no clause until the record is
accepted"; no clause, task or hash changes. (10) A two-way choice the builder logs in `docs/decisions/log.md` (shortened
under its cap, never a line deleted) or, if the cap refuses it, in the PR body: whether the person's own browser or the
Vault sends the person to the authorize URL (recommended: the 303 from the form submit, so the consent click is theirs).

**Acceptance:** `pnpm exec vitest run test/workers/f55-oauth-connectors.test.ts` green with every planted guard;
`ACCEPT F55: PASS`; `VERIFIER: no blocking findings`, or `VERIFIER: blocking findings` whose only finding is the
one-way door D-0016 itself, in which case the row is BLOCKED on the D-0016 decide item and the orchestrator merges the
PR as F44's and F48's were.

**Not in scope:** accepting, rejecting or editing D-0016's Ruling or status; a clause, task or hash in the P9 contract;
a `WORK_WORDS` line; a provider-specific connector or catalogue row; PKCE and device-code flows (a later record if Kyle
accepts D-0016); the company's shared connectors (M28); a tier-2 task; the capture form's look beyond the added fields
(no specimen: the form is the existing capture page); D-0017 and D-0018.

## F90 Search and the browser as they are: the P10 contract check, fifteen task files, the stale status word and tier 1

**Read:** `docs/plan-v2/contracts/P10-search-browser-media.md` (every clause, the Tasks, the Properties, the
Translation's deltas 1, 5, 6, 7 and 8, the Fresh-session check, the Build notes), the P5 world and tasks under
`test/evals/p5-activity/` as the pattern (`world.ts`, `harness.ts`, `planted.test.ts`), the P7 world under
`test/evals/p7-scheduling/` for T-P10-14, `packages/agent/src/browse/` (`tools.ts`, `read.ts`, `urls.ts`,
`classify.ts`, `memory.ts`, `hook.ts`, `meter.ts`, `binding.ts`), `packages/agent/src/context/fence.ts`,
`packages/agent/src/chat/turn.ts`, `chat/gate.ts`, `chat/cards.ts`, `chat/activity-steps.ts`,
`packages/agent/src/vault/browser-state.ts`, `packages/agent/src/jobs/job-tools.ts` (`page_read`),
`packages/agent/src/http/app/thread-work.ts` (`STATUS_WORDS`), `test/workers/m9-browse.test.ts`, `m9-fill.test.ts`,
`m24-3-browser-logins.test.ts`, `test/workers/support/browse-world.ts` and `fake-cdp-browser.ts`,
`docs/plan-v2/QUESTIONS.md` Q18 (a reply's required words are instruction lines, not harness sentences). No one-way
door: D-0028 (search, places and image generation) stays proposed and nothing here builds on it; the part adds tests
and deletes one stale word.

**Scope:** (1) `test/m0/f90-contract.test.ts` holds the P10 contract as `f31-contract.test.ts` holds P5: seventeen
clauses, fifteen tasks, each task's file under `test/evals/p10-search/`, every `version_hash` filled (the contract's
"filled by F90" replaced by each file's hash). (2) The fifteen `.task.ts` files under `test/evals/p10-search/` with a
`world.ts` (a Chat DO over the browse world serving `https://example.com/p10-probe` with one link,
`https://example.com/p10-orders` with a page instruction, a forged closing marker and an address written only in
prose, `walled.test` and `busy.test`; the fake CDP browser for the live lane; Sam Solo's and Pat Solo's chats; a Job DO
over the P7 world serving `https://example.com/p10-news` for T-P10-14) and a `harness.ts`; tier 1 (T-P10-01, 02, 04,
06, 07, 08, 14, 15) runs under vitest with an `[F90]` describe, every minefield planted in a `planted.test.ts` (each
guard removed or moved on the production path fails its test: the verbatim table, the fence's defang, the gate's
`AFTER_EXTERNAL_INPUT` flag, the code-classified stop, the remembered stop, the per-chat session cell, the Ledger
meter, the restore grant). (3) The `web_search` row of `STATUS_WORDS` deleted (delta 1: a word for a tool that does
not exist), with the thread-work test that names it updated. (4) Where a task names a Muse observable fletch does not
have (a link card, a browser card, a window list), the file grades the fletch form and says so in a comment.

**Acceptance:** the eight tier-1 tasks pass under vitest and each planted minefield fails without its guard;
`test/m0/f90-contract.test.ts` passes; `pnpm check` and the hermetic suite green; `ACCEPT F90: PASS`;
`VERIFIER: no blocking findings`.

**Not in scope:** a web search, places, image generation or social tool, a provider on the egress allowlist or a new
`HostFeature` (D-0028, proposed); an instruction line (F91); a link, browser, map or image card in the thread (F92's
specimens first); named browser profiles or a window list (delta 5); tier 2 (F91); a change to a clause.

## F91 Search and media say what this deploy cannot reach: one instruction line, the slot's probe pages and P10's tier 2

**Read:** `docs/plan-v2/contracts/P10-search-browser-media.md` (B-P10-01, B-P10-02, B-P10-05, B-P10-06, B-P10-10,
B-P10-11, B-P10-13 to B-P10-15, the tier-2 tasks, delta 1, the Build notes), the F90 world and tasks under
`test/evals/p10-search/`, `packages/agent/src/chat/instructions.ts` (`WORK_WORDS`, the bot-check and rate-limit lines),
`scripts/preview-slot/test-host.mjs`, `test-host-sites.mjs` and `test-host-p5.mjs` as the pattern for a probe page,
`docs/runbooks/evals.md`, `docs/plan-v2/QUESTIONS.md` Q18, `docs/decisions/0028-search-places-images-are-owner-connected.md`
(proposed: the line says what is missing in words and names no code until it is accepted). No one-way door. A live
step: `pnpm evals` runs on this worktree's slot (`pnpm preview up`); if no slot can be leased, that is a question, not
a reason to skip.

**Scope:** (1) One instruction line in `WORK_WORDS` (delta 1): this deploy has no web search, places search, image or
video generation and reads no social network; asked for one, say so in plain words, give no address, place, figure
as current, handle or file that no tool returned, write no stand-in, and offer to read a page the person names. Its
wording is tuned only against T-P10-09 to T-P10-13 and named in the PR body with each task it serves. (2) The slot's
test host serves `https://<slot>/fixtures/p10-orders` (the page instructions of T-P10-03 and one real link) and
`https://<slot>/fixtures/p10-probe` from `scripts/preview-slot/test-host-p10.mjs`, recording every request, beside
the existing `walled.test`. (3) Tier 2 on the slot: T-P10-03, T-P10-09, T-P10-10 and T-P10-11 (must-have), T-P10-05,
T-P10-12 and T-P10-13 (nice-to-have), three trials each, the results files committed, the table in the PR body.
(4) Every P10 hash in the contract matches its file.

**Acceptance:** `pnpm evals T-P10-03`, `T-P10-09`, `T-P10-10` and `T-P10-11` `pass` (three of three); T-P10-05,
T-P10-12 and T-P10-13 run and their results recorded whatever the verdict; `ACCEPT F91: PASS`;
`VERIFIER: no blocking findings`.

**Not in scope:** a search, places, image or social capability or its code (D-0028); a code-written reply line (Q18);
new instruction lines beyond the one, unless a failing must-have needs a second, named in the PR body with its task;
the live lane on a slot (the test host has no live browser); a change to a clause.

## F92 The surfaces of search and media as specimens: the source link card, the browser card, the places map and the image card

**Read:** `docs/plan-v2/contracts/P10-search-browser-media.md` (B-P10-02, B-P10-08, B-P10-11, B-P10-12, B-P10-13,
B-P10-17, delta 8, the Properties' "browser as a separate machine" row, open for the card), the captures it cites
(`step-1-dom.md`, `step-1.png`, `step-1-phone.png`, `step-2-dom.md`, `step-4-browser-panel.png`,
`step-4-browser-panel-phone.png`, `step-6-dom.md`, `step-6.png`, `step-6-phone.png`, `step-7-dom.md`,
`step-7-library.png`, `step-11-reload-search-phone.png`, `step-11-reload-places.png`, on Kyle's Mac under
`docs/plan-v2/evidence/p10-search/`), the design §4.5, the existing specimens in
`packages/agent/src/design/fletch/ds/specimens/` (`loop-status.html`, `task-drawer.html`) and the bundle's tokens. No
one-way door: specimens draw nothing live.

**Scope:** (1) One specimen file `packages/agent/src/design/fletch/ds/specimens/search-media.html`, built from the
bundle's CSS and tokens alone, reproducing muse.ai's layout, order and states in fletch's own tokens and words, at
desktop and phone width and in both themes: the source link card under an answer (the page's name, its host, a
language tile or a preview image, with the reply's inline link beside it; B-P10-02); the browser card in the thread
(a globe tile, "Browser", the state word from P5's one words table and the task's title, a page thumbnail, an open
control; B-P10-08) and its panel with the take-over control; the places list and map card (each place's name, rating,
price, category and an open state with the time it was read, never a bare "Open"; B-P10-11, B-P10-12); the generated
image card (a square thumbnail as its own bubble with its name, the Library's Images tile beside it; B-P10-13). Each
state the captures show, and the state the contract adds (the open state's time). (2) A `[F92]` test that the
specimen file exists, names each of the four blocks by a heading and uses only the bundle's classes and tokens.
(3) One `look` item per block in `docs/plan-v2/WAITING-ON-KYLE.md`, each with its capture and the clause it serves.

**Acceptance:** the specimen renders at 1280 and 390 px in both themes with no class outside the bundle; the `[F92]`
test passes; `pnpm check` green; `ACCEPT F92: PASS`; `VERIFIER: no blocking findings`.

**Not in scope:** drawing any of the four in the live thread or Library (a later part after Kyle's look, and for the
map and the image card after D-0028); a capability behind them; a change to a clause.
