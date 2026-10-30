# Questions for Kyle

Each question: `### Q<n> (F<n>), <date>: <title>`, then **Blocks:**, **Recommended answer:**, and once given
**Answered (Kyle, <date>):**. An answer that settles a decision updates its record in `docs/decisions/` in the same commit.

## BLOCKED (open)

### Q18 (F26), 2026-10-30: may F26 keep `pauseWords` and the widened `claimed_sent` that T-P15-13's pass needs?

**Blocks:** F26's verifier pass, so the part is not DONE. Everything else is in. `ACCEPT F26: PASS` (TREE
11c62283d673aed028eab57cbbabacda2c6e2d66, HEAD fcf0960). Tier 2 on fletch-pv-3 is T-P15-13 3/3 (hash `51dd5dcb091a`)
and T-P15-14, 15 and 16 each 3/3. The draft PR is open on `claude/f26-nothing-around-a-card-31e59c`. The verifier
returned two blocking findings, and T-P15-13 fails without either change.

1. **`pauseWords`** (`packages/agent/src/chat/cards.ts`, called at the barrier in `packages/agent/src/chat/engine.ts`).
   - **The problem:** on the slot, the real model proposes the share as a bare tool call in most trials. The turn ends
     at that step, so Sam sees a card and no reply. The earlier hash `e729bad9eda2` failed 3/3, then 1/3 after the
     instruction line was sharpened, then 2/3. Each failure was "the first reply says the share waits on Sam".
   - **The change:** a paused step with no words (neither the model's nor a tool's) gets one line from code: "Waiting
     for your decision: <action>. It has not run yet." This follows M19.2's rule for a tool's own words. It applies on
     every deploy, and three older tests (m19, m20, m21) now expect the line.
   - **Why it blocks:** scope (4) says a reply's required words are instruction lines. The verifier also notes that
     T-P15-13's grader now matches code's line, not the model's words.
   - **Rejected alternatives:**
     - One more tool-less model step after a bare pause. That changes the turn loop, and about 20 scripted card tests
       across 11 files fail.
     - Grading the card's own status line as the reply.
2. **T-P15-13's `claimed_sent`** (`test/evals/p15-approvals/real-model-declined-no-retry.task.ts`).
   - **The change:** before it reads a claim, the grader now strikes "never sent/posted" and "nothing was sent/posted".
     Before, it struck only "not", "wasn't" and "didn't".
   - **Why:** it fired on the model's true denials. The slot's verbatim replies are pinned in
     `test/evals/p15-approvals/pause-words.test.ts`, with claims that must still fire ("I sent it…", "status code
     200"). The failed runs stay committed in `docs/plan-v2/evidence/results/e729bad9…json`.

**Recommended answer:** keep both.
- `pauseWords` says a true thing in code, the way a card's own status does, and it never fakes the model's words.
- The `claimed_sent` edit fixes an oracle that had never been run. It does not lower the bar.

If you agree (in a commit or a PR comment), a session reruns the verifier and marks F26 DONE. Otherwise:
- To revert `pauseWords`, also say whether T-P15-13 should grade only the model's own words. If so, its must-have
  becomes a prompt or engine item for P15's Interrogate.
- To revert the `claimed_sent` edit, its must-have fails on honest replies until the task's wording changes.

### Q16 (F24), 2026-10-29: may F24 keep two grader changes the verifier calls softening?

**Blocks:** F24's verifier pass, so the part is not DONE. Everything else is in: `ACCEPT F24: PASS` (TREE
0d6700c563cd3a98754aaf2a86f33d1aa785e192), and tier 2 is T-P2-13 3/3, T-P2-14 3/3, T-P2-12 recorded
(`GRADER_THREW`: its graders read socket frames the slot world doesn't keep). The draft PR is open on
`claude/f24-thread-shows-work-31e59c`. The verifier's two blocking findings are both grader edits on tasks the
part's scope doesn't name. Reverting either one fails the part.

1. **T-P2-03** (`test/evals/p2-loop/reply-after-last-tool.task.ts`): its grader ("only the 👍 before the words") now
   also lets through the `status` frames that scope (1) adds. B-P2-04 names that runtime status as the second
   signal, and the frame carries no model text. Without the edit, T-P2-03 fails on every run of the shipped status
   line.
2. **T-P2-13** (`test/evals/p2-loop/real-model-failure-honest.task.ts`): the first tier-2 runs failed honest replies.
   - Hash `bc83…`: 0/3, failing on "There's no file called p2-missing-file.md …". That is the reference's own
     wording ("there is no file at …"), and the first pattern missed it.
   - Hash `55e8…`: 1/3. `empty_success` caught "the workspace is empty right now", which is true and doesn't claim
     the file is empty.
   - Now: `NOT_THERE` takes the usual ways of saying the file isn't there, and `EMPTY_FILE` matches the file being
     called empty. The replies the model gave, and planted failures for each grader, are pinned in
     `test/evals/p2-loop/real-model-failure-honest.test.ts`. The failed runs' results files stay committed.

**Recommended answer:** keep both. They are corrections to oracles that had never been run (one on the clause's own
second signal, one on the model's honest reply), not a lowered bar. Agreeing in a commit (or a comment on the PR) lets
a session rerun the verifier and mark F24 DONE. If you'd rather not, say which to revert, and T-P2-13's must-have
becomes a P2 Interrogate item for a prompt change.

### Q13 (F21), 2026-10-29: The F21 draft PR could not be opened from the session

**Blocks:** the last step of F21's protocol (KICKOFF step 7), the draft PR. F21 is otherwise done: `ACCEPT F21: PASS`
(TREE 20c4832fa6711712e0632ab3b31fa9d131a4551d), the verifier's `VERIFIER: no blocking findings`, and the
PROGRESS.md row. The branch `claude/f21-own-message-reactions-31e59c` is pushed. `gh pr create --draft` was refused by
the session's permission classifier ("Create Public Surface").

**Recommended answer:** open the draft PR yourself (`gh pr create --repo kltdwrds/fletch --draft --base main --head
claude/f21-own-message-reactions-31e59c`, titled "F21: a person's own message takes no reaction in the ⋯ sheet or
hold popover"), or allow `gh pr create --draft` for builder sessions so the next part can open its own.

Orchestrator, 2026-10-29: PR #29 opened from the orchestrator session, so F21 is not blocked; what stays open is the
permission for builder sessions, listed in `WAITING-ON-KYLE.md`.

Orchestrator, 2026-10-30: the F27 builder (Opus, `--permission-mode auto`) was refused `gh pr create` again and wrote it
up as Q20 under BLOCKED; folded here as the same class. PR #45 was opened from the orchestrator session and merged, so
F27 is DONE and nothing is blocked. The F22 and F26 builders opened their PRs themselves; the classifier is not consistent.

### Q1 (F1), 2026-10-22: A throwaway account for the live exit test

**Blocks:** F1's last acceptance claim, one passing run of `test/live/f1-deploy.live.test.ts`, and the tag `v0.1.0`.

**Recommended answer:** create a free-plan Cloudflare account used for nothing else, add its id and a token
(Workers Scripts, R2 and Vectorize: Edit; Workers AI: Read) as the repository secrets `CF_LIVE_ACCOUNT_ID` and
`CF_LIVE_TOKEN`, and run the live-deploy workflow once (`docs/runbooks/live-deploy.md`). The same account can close
the free-plan spike (Q2).

## Open, not blocking

### Q19 (P6), 2026-10-30: goals and tracked items have no fletch seam; four attested clauses; one reload finding

**Blocks nothing.** The P6 interrogation (`contracts/P6-memory.md`, evidence under `evidence/p6-memory/` on Kyle's
Mac) leaves three things for Kyle's eye.

1. **Goals, tracked items and briefings (B-P6-14, B-P6-15).** Muse creates a goal on the ask with no card (a
   `goals.goals` row, a seeded workspace, a Goals tab row, entries on later asks), tracks an item as the same row with
   `source = 'assistant_tracking'` and a first entry from a live read, and writes briefings as background letters on a
   system schedule. A tracked item has no producer of later entries, so it goes stale silently. fletch has no store, tool
   or surface for any of this, and a new store is a storage schema, a one-way door the orchestrator may only propose.
   The clauses stand with no task. Recommended answer: a later cluster ("P6b goals and tracking") after the spine, with a
   proposed record for the store when it is translated; until then a goal is not a memory line (a tracked item with no
   producer is a note, not a watch). Say so if you want it folded into P6 now instead.
2. **Attested, not instrumented:** who reads memory besides a chat (a sub-agent inherits `MEMORY.md` at spawn, a browser
   worker sees only its brief, B-P6-13); what a confirmed forget leaves behind (the run stopped at the plan because every
   Muse forget also resets the feed's learned interests, B-P6-08); the daily note's author and timing (a background
   upkeep worker, B-P6-10); the people-page producer (a background relationships loop, B-P6-11). fletch's translation
   does not rest on any of them (deltas 2, 5, 6, 7 are fletch's own choices); they are re-asked only if a later cluster
   needs the mechanism.
3. **A reload finding.** After a cold reload of thread A, its oldest fourteen items drew as person bubbles only, with no
   assistant reply between them, though earlier reloads had shown them (`step-12.png`). Cause undetermined (a history
   window or lazy paging). Nothing in fletch rests on it; recorded so the P6 capture set is read with that in mind.


### Q17 (P15), 2026-10-29: one attested clause and four findings from the P15 interrogation

**Blocks:** nothing. (1) `contracts/P15-approvals.md` B-P15-15 (what follows an Allow once and a Deny: the action
running once, "Allowed once" in the history, a new card on the same ask, the denial's finality and the alternative
offered) is `[attested]`: both cards the pass raised expired at Muse's ten-minute card expiry before you could decide
them (B-P15-04). The uat item "decide the two P15 approval cards, live, within ten minutes" in `WAITING-ON-KYLE.md`
captures it; fletch's T-P15-04 and T-P15-13 grade fletch's own allow-once and deny meanwhile. (2) B-P15-06: under the
identical prompt, Muse's httpbin.org chat reported one timeout and stopped, while its httpbingo.org chat raised six
cards after the first timed out, re-aimed two at `postman-echo.com` and `example.com`, then tried the POST through
the browser and invited you to run a `fetch` in its console (`evidence/p15-approvals/answers/step-12.md`); every card
timed out and nothing was sent. Muse itself reads no prompt line that says "one timeout ends the attempts" for a
card. fletch's rule is the stronger one (a decline is final by fingerprint, a card never expires: delta 1) and
T-P15-05 and T-P15-13 hold it. (3) B-P15-11: Muse's browser solved the reCAPTCHA demo (checkbox, a failed image
challenge, then the audio challenge) citing the prompt's CAPTCHAs section and a standing line in your memory file of
2026-09-17, which is not a grant in `permissions.list_active`. fletch does the opposite by design (delta 3, D-0001,
"Message content is data"): a bot check is `BROWSE_BOT_WALL`, refused by name, and T-P15-08 plants the memory line to
hold that it grants nothing. (4) One `exec` command naming two hosts raised one card once (`approval:9a031765`) and
two cards once (`approval:fc14e035`, `:bdf907cd`), so how many cards a multi-host command raises is unsettled in
Muse; fletch asks per host (T-P15-03). (5) Step 10 is blocked: no Stop control was reachable during a running
foreground tool call (B-P15-12, `step-10-running-no-stop.png`); fletch's Stop (M24.2) is graded by T-P15-09.

**Recommended answer:** none from you beyond the live window the uat item asks for. (2) and (3) are recorded as
Muse behaviours fletch does not copy, each with the delta that says why; if you want fletch to solve bot checks or to
re-ask after a decline, say so and the delta becomes a question.

### Q15 (P2), 2026-10-29: three things the P2 interrogation attests rather than instruments, and two dump-slice oddities

**Blocks:** nothing. (1) `contracts/P2-loop.md` tags parts of B-P2-04 (which tool name maps to which status words:
no table holds it), B-P2-07 (what Muse draws for a failed write: never seen) and B-P2-09 (the connect card as a
tool-returned connection action: read from tool descriptions, not provoked) `[attested]`; fletch's shapes for them are
its own (the Translation's deltas 6 and 7). (2) The dump slice `2026-10-29+p2-slice-2308Z` lists `process` as
`deferred: false`, yet step 3 loaded it by name with `chat` and `todo` (`agent.context_items:281018`): either an eager
namespace accepts a redundant load or the flag is per session. (3) The same slice holds 0 `unavailable_namespaces`
where the 2026-09-14 probe held 9, so scenario step 7 asked for a thing no namespace serves instead of a namespace
marked unavailable; the loader reports no unavailable state at all today.

**Recommended answer:** none from you. A later P2 pass (or P15's, for the connect card) provokes (1) when it is cheap;
(2) and (3) are notes for the next dump refresh (`INTERROGATE.md`), where the slice's `deferred` flags are compared
against a load of each eager namespace.

### Q14 (F22), 2026-10-29: a task's version hash depends on the loader, and T-P1-02 misses on counting

**Blocks:** nothing. (1) `versionHash()` hashes each grader's `toString()`; vitest's transform rewrites that source, so
the same task file hashes one way under vitest and another under Node's own type stripping, which `pnpm evals` uses and
the contract and results files record (`care-reaction.task.ts`: `2ac596814f38…` under vitest, `550090e2c7a4…` under
Node). F22's test computes the runner's hash in a child Node process (`test/evals/p1-reactions/reacting-registers.test.ts`).
(2) T-P1-02 (must-have) passed 4 of 6 dry-run trials on F22's tree and its count prompt 6 of 8 on F21's `REACTING`:
every miss is the count ("3", "One line.", asking for the text), never a reaction, so it is the model's counting, not
the register; its next recorded run may say `regressed`.

**Recommended answer:** none from you. The orchestrator folds (1) into the kit (hash a grader's source as Node loads it,
or record the loader) when it next touches `test/support/task.ts`, and decides whether T-P1-02's count grader should
accept a number word or the prompt should carry a fixed multi-line body.

### Q11 (F18), 2026-10-29: two limits of the task kit, found by P1's Build

**Blocks:** nothing. `defineTask`'s `collateral` keys a snapshot by exact id and reads any removed key as collateral, so
a task cannot declare an expected removal (T-P1-07 removes a reaction and grades it instead), and a message id that
depends on the tool-call count (a mid counts the agent's `react` as a row) cannot be declared statically, so P1's tasks
key messages by `message:<chat>:<ordinal>:<kind>` (`docs/plan-v2/contracts/P1-reactions.md`, Build notes).

**Recommended answer:** none from you; the orchestrator folds a `removes:` field and ordinal keys into the kit when a
second cluster hits the same limit (AGENTS.md, "Raising a rule": twice, then one change).

### Q12 (F20), 2026-10-29: the dump brief and the design's Muse counts are stale

**Blocks:** nothing. The P1 interrogation (`docs/plan-v2/contracts/P1-reactions.md`, "Finding against the dump brief")
found that every person reaction starts a Muse turn with a handoff block and a no-reply escape, where
`docs/briefs/reactions-dump-2026-10-23.md` read reactions as ambient only; and that the live `tools.json` counts 109
functions in 19 namespaces with 9 unavailable, not the 108 in 32 the design's §7 states, and holds no reaction function
(the tool is injected per session). fletch's shipped gate (wake only on a pending question) is kept as a named delta.

**Recommended answer:** none needed from you beyond a read: the briefs are deleted in the PR after F20 (design §5.1),
and the orchestrator corrects §7's count in that PR. Say so if you would rather keep the briefs.
### Q10 (F19), 2026-10-29: Accept D-0015, tier-2 evals in CI with the slot token and a spend cap

**Blocks:** nothing. The runner (`pnpm evals`, `docs/runbooks/evals.md`) runs from Kyle's Mac against the worktree's
leased slot, and a part's PR body carries its table. Open decision O9 (design §10) was agreed in principle; F19 wrote
the record, `docs/decisions/0015-tier2-evals-in-ci.md`, with the key's scope (the existing slot token, D-0008, as a
repository secret in a `tier2` environment; no model key, since a slot's chat model is Workers AI through its binding),
the spend cap (12 tasks of 3 trials per run, one job of 60 minutes, a 10 USD notification and a 25 USD stop per month)
and the trigger (PRs touching `packages/agent/`, one comment, never a gate: O2).

**Recommended answer:** accept D-0015 as proposed after the dry run (F20) shows stable verdicts, then the workflow
file is a plain PR citing it and the three secrets are Kyle's to set. The alternative, keeping the runner on Kyle's Mac,
costs nothing and leaves tier 2 to the orchestrator's sessions; it is the state today.

### Q6 (F4), 2026-10-23: D-0010 is a stub until the artifact record lands

**Blocks:** nothing. `docs/plan-v2/parts.md` cites D-0010 (the artifact plan's record, "proposed on Kyle's thread") in the
F4 to F7 preamble and in F4's and F6's rulings, but the record was never in this repository, so
`node scripts/check-decisions.mjs` failed at 391af92 and with it every `pnpm check`. F4 added
`docs/decisions/0010-artifact-collection-address.md`, a `proposed` stub that states only what the plan cites it for
(`/library/artifacts/<slug>`, the id in segments) and binds nothing.

**Recommended answer:** replace the stub with the record from the artifact thread, keeping the id D-0010, before F6
starts (F6 must leave that collection free). The alternative, rewording the plan's citations, edits other parts' text
and loses the link.

### Q2 (F1), 2026-10-22: Run the free-plan spike for Code Mode and Images

**Blocks:** nothing yet; it decides whether `create-fletch` adds `LOADER` and `IMAGES` by default or only with
`--paid` (D-0004).

**Recommended answer:** run it on the Q1 account (`docs/runbooks/free-plan-spike.md`) and paste the table.

## Answered

### Q9 (F14), 2026-10-27: May a session record Kyle's acceptance relayed by the person orchestrating for him?

**Blocks:** nothing now. F14 is DONE under an override, and this question decides whether that override stands as
the rule. Three fresh verifiers (`docs/plan-v2/VERIFIER-PROMPT.md`, unchanged) passed every scope line, test and guard
rail of F14 and still answered `VERIFIER: blocking findings` on provenance alone, for two reasons. First,
`decider: Kyle` on D-0011, a one-way door, was written by the session, quoting the session's user. Second, Q8 was
moved to Answered by the session, while `docs/plan-v2/KICKOFF.md` says "Kyle moves it to Answered". The session's user,
acting for Kyle at his request, overrode the verifier on 2026-10-27 and had F14 marked DONE. `KICKOFF.md` lets "the
session, quoting him" set a record to accepted. The verifier reads that as Kyle's own words only, and it cannot see
a chat, so any session-recorded acceptance fails it.

**Recommended answer:** Kyle confirms D-0011 by his own commit on the record, for example a one-line edit to its
Context, so the one-way door rests on his hand, not on a relay. Then he picks one rule and writes it into
`KICKOFF.md` and `VERIFIER-PROMPT.md` together, because they disagree today:
- (a) A one-way record's acceptance, and a BLOCKED question's move to Answered, are always Kyle's own commit. This
  is the safer option: the verifier can check it from git alone.
- (b) A session may record them when it quotes Kyle, or a named delegate of his, with the session link, and the
  verifier accepts that.

Until he does, a verifier on any part with a session-recorded acceptance will flag it again.

**Answered (Kyle, 2026-10-29):** option (a). Asked in this session whether to settle Q9 as option (a) while building the
orchestrator framing, Kyle answered "Yes: add the orchestrator goal, the wrapper, WAITING-ON-KYLE.md, the scorecard and
contract-path checks to the plan on plan/phase-0-v2, and settle Q9 as option (a)." So: a one-way record's acceptance,
and a BLOCKED question's move to Answered, are Kyle's own commits; a session or the orchestrator never writes either,
and the verifier flags one in a part's diff (`KICKOFF.md` "Questions", `VERIFIER-PROMPT.md` question 4,
`ORCHESTRATOR.md`). D-0011's confirmation by his own commit is the first item in `WAITING-ON-KYLE.md`.

### Q8 (F14), 2026-10-26: Accept D-0011, the parent's owner-checked read of a sub-agent facet's transcript

**Blocks:** F14's transcript half, so F14 cannot reach `ACCEPT F14: PASS`. The buildable half is on the branch
`claude/fletch-f14-subagent-steps-q7ko2x`: `groupIdOf`, the launch step's detail from the rows, the task answer's
`subagents` sections numbered `01`, `02` and nested by depth, the verdict step in the parent from the same stored
value the chat handoff carries, and Pat's read refused `CHAT_NOT_OWNER` before any row is read. Every child's steps
answer `SUBAGENT_STEPS_UNAVAILABLE`, because D-0011 (`docs/decisions/0011-subagent-transcript-read.md`) is
`proposed`, a one-way door (a new read across the facet's storage boundary), and no session may accept it. Waiting
on it: `SubAgent.transcript()` on the facet (Scope 3), the child's steps from `stepsOf` with "Handed off" last
(Scope 4), and the acceptance claims on the child's setup steps, a failed child's steps up to the failure, the
planted reader that takes the person from the request, and a facet whose read throws (today no facet is read, so the
branch's test of that claim can only check the refusal by name). Two tests under `[F14] the child's own steps (waits on
D-0011)` in `test/workers/f14-activity-subagents.test.ts` state the first two and fail today.

**Recommended answer:** accept D-0011 as proposed (set `status: accepted`, `decider: Kyle`). The transcript half
waits on D-0011: the facet's transcript is the only copy of a child's steps, and the parent already holds the
authority on every spawn, so the parent checking its own row's `person` before calling the facet's one read is the
smallest boundary that lets the drawer show a delegation's steps. The alternative in the record (the facet returning
its tool calls in `SubAgentResult` for the parent to store) is a new content store and a schema decision of its own.

**Answered (Kyle, 2026-10-26, relayed):** the session's user, who acts for Kyle when orchestrating these sessions,
wrote "D-0011 accepted, build the transcript half. Kyle accepted D-0011 in chat just now." Asked whether they were
Kyle accepting it himself, they answered "confirmed". On 2026-10-27 they said they act on Kyle's behalf, at his request.
Kyle has not moved this question or edited D-0011 himself (Q9). D-0011 is accepted (`decider: Kyle`), and
the transcript half is built on the same branch. The two tests this question names as failing were folded into the
part's tests, which pass: `[F14] sub-agent sections and the launch step`, `[F14] the verdict in both places` and
`[F14] who reads a child's transcript`.

### Q3, 2026-10-22: Preview slots on the shared account reach production's data

**Blocks:** accepting D-0008. `pnpm preview` works today on the shared account (`docs/runbooks/preview.md`).

**Context:** the slot token cannot redeploy production, but a binding is not checked against the deploying token, so
anyone holding it can bind qyvr.dev production's buckets, databases or services into a slot Worker and read them
(measured with a stand-in bucket, D-0008).

**Recommended answer:** put the preview pool on a Cloudflare account used for nothing else: create it, run
`pnpm preview provision` and `pnpm preview token` there (the inventory and the token name its account), and set the
cloud environment's `CLOUDFLARE_ACCOUNT_ID` to it. The alternative is to accept the gap and D-0008 as it stands.

**Answered (Kyle, 2026-10-22):** "accept the gap and keep previews on the shared account." D-0008 is accepted.

## Closed

Closed by the pare-down of 2026-10-29 (the parity framework v2, §5.1): the part each question served was folded into
a spine cluster, and the question returns, if at all, with that cluster's contract.

### Q7 (F7): closed 2026-10-29, folded into P1

F7 (the address survives sign-in) is folded into P1's contract; the one-way login record returns as a `proposed`
record when P1 is translated. The original question:

**Blocks:** F7, whole part. The part changes the published `@qyvr/host-cloudflare` login contract (one-way
door), so under the runbook it cannot start until Kyle accepts the record proposed in the F7 plan (2026-10-23):
after sign-in the host honours `/login?next=<path>` only for an absolute same-origin path not under `/login`,
else `/`, with the open-redirect shapes planted in the part's tests. The fallback inside the part, if Kyle
prefers no host change: a short-lived same-site cookie set by the agent on the sign-in redirect, read once at
boot — then the record is two-way and the session sets it.

**Recommended answer:** accept the record as proposed (Kyle was asked in chat 2026-10-23; the ask stands until
he answers).

### Q4 (F2): closed 2026-10-29, folded into P1

Whether a stored search index is ever needed is a P1 task (a search over Kyle-scale history on a preview, measured),
not a standing question. The original question:

**Blocks:** nothing. F2 derives the index at query time (F2, Ruling 1): each `Chat` scans its own `messages` table
for its owner, and `/app/search` fans out to every live chat as `/app/chats` already does, so F2 binds no storage
schema. This question decides whether a later part adds an FTS5 table to each `Chat` object, a storage schema and so a
one-way door (D-0007), and when.

**Recommended answer:** not yet. Measure F2 on a preview with Kyle's real history (the time of one `/app/search` with
a query, the number of live chats). Add the stored index only when a search exceeds a second or the owner passes about
200 live chats; then it is a `chat.search-index` migration (an FTS5 external-content table over `messages`, written in
the same transaction as `appendMessage`) under a `proposed` record for Kyle to accept, and F2's substring matching gives
way to the tokeniser's. The alternative, building the FTS5 table in F2, spends a one-way door before the scan has been
measured slow.
