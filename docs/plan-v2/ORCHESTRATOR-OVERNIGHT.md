# The overnight orchestrator: the parity loop with Kyle's defaults pre-taken

A variant of `ORCHESTRATOR.md` for a run Kyle is not watching: the same loop (design §3), the same protocol
(`KICKOFF.md`, `VERIFIER-PROMPT.md`), the same ledgers, with two changes Kyle made on 2026-11-07 for one run before his
weekly usage resets: every open question is answered by its recommended default so the build work it blocks can go,
and the loop runs as many builders in parallel as the three preview slots and the cloud allow. Everything
`ORCHESTRATOR.md` says still holds unless a line here says otherwise.

## The goal (paste as one `/goal` command)

/goal You are the overnight orchestrator of the fletch parity loop: docs/plan-v2/ORCHESTRATOR-OVERNIGHT.md is your method and queue, docs/plan-v2/2026-10-29-parity-framework-design.md the design, docs/plan-v2/ORCHESTRATOR.md and KICKOFF.md the protocol, parts.md, PROGRESS.md, SCORECARD.md, QUESTIONS.md and WAITING-ON-KYLE.md the record. Kyle is asleep and has pre-authorised defaults (ORCHESTRATOR-OVERNIGHT.md, Defaults, 2026-11-07): every open question's recommended answer is taken as his answer, written under the question as "Default taken (for Kyle, <date>): <answer>" and the question moved to "## Answered by default"; a proposed one-way record stays proposed and is built on only as Defaults allows. Run as much in parallel as the three preview slots and the cloud allow: cloud builder sessions on Opus in the "Fletch Cloud" environment for parts that need a slot, Agent sub-agents on Opus for verifiers, translations and sweeps, yourself for ledgers, merges and contracts; keep three builders busy while work remains, because this run is meant to spend Kyle's weekly usage before it resets. Work the Queue in ORCHESTRATOR-OVERNIGHT.md in order, skipping an item only for a reason you write beside it; show each part's final ACCEPT F<n> line and VERIFIER: line; raise a scorecard level only by quoting the accept, verifier and evals lines it rests on; merge a PR when its gates are green; keep every ledger current; commit and push small. The goal is met only when this transcript shows, after your last commit: cat docs/plan-v2/SCORECARD.md, cat docs/plan-v2/PROGRESS.md, cat docs/plan-v2/WAITING-ON-KYLE.md and the Queue section of docs/plan-v2/ORCHESTRATOR-OVERNIGHT.md, git status --short empty, every PROGRESS.md row DONE or FOLDED except rows whose blocker Defaults cannot take (each named in WAITING-ON-KYLE.md), every Queue item marked done with its PR or blocked on Kyle with the item that blocks it; then you say exactly ORCHESTRATOR: waiting on Kyle. Hard lines: never write decider: Kyle, set a record to accepted or move a question to Answered (Answered by default is yours); never take a one-way decision Defaults does not list; never edit scripts/accept.ts, a scripts/check-*.mjs, scripts/scans.ts, .claude/, docs/plan-v2/KICKOFF.md, VERIFIER-PROMPT.md, GOAL-PROMPT.md or this goal; never commit a secret; store nothing under docs/plan-v2/evidence/ that did not pass pnpm redact; deploy only to preview slots; use only the identities in test/fixtures/people.json; never enter, request or read a credential or sign-in code, and never press Allow or Deny in Muse; never merge on red CI or bypass a hook.

## Defaults (Kyle, 2026-11-07)

Kyle's words: "I'm okay with all questions being best-effort answered with defaults so we can do all build work."
What that authorises, and what it does not:

- **A question under `BLOCKED (open)` or `Open, not blocking`** is answered by its own **Recommended answer** (or
  the orchestrator's line under it when one supersedes it). Write `Default taken (for Kyle, <date>): <the answer in
  one sentence>` under the question and move it to a new `## Answered by default` section above `## Answered`. Never
  move anything to `## Answered`: that section is Kyle's. A question with no recommendation gets the orchestrator's
  best reading, said so.
- **A `proposed` two-way record** (`decider: agent`) is taken as its ruling says; it stays `proposed` with no change.
- **A `proposed` one-way record** stays `proposed` and nobody writes `decider: Kyle`. The loop may build on its
  recommended option only when undoing the build is deleting code and rows the build itself added, and the WAITING
  decide item then says "built on the default; reject the record and it comes out". That covers D-0016 (OAuth
  connectors: a redirect route and a refresh-token kind, both deletable) and D-0018 (no agent name: nothing to build).
  It does not cover anything that spends money, publishes a package version, changes a storage schema other rows
  already use, or adds a credential to CI (D-0015, Q10 stays with Kyle).
- **A record's acceptance, a UAT verdict (level 3), Kyle's own commit on D-0011, a Muse sign-in, a tarball on his
  Mac**: Kyle's, listed in `WAITING-ON-KYLE.md`, not taken.

Each default taken is also one line in the item it unblocks in `WAITING-ON-KYLE.md`, so Kyle sees at his check-in
what was decided for him and can reverse it by a line under `## Steering`.

## Running it

Two places, both from Kyle's Mac. The orchestrator itself is a desktop-app session (the built-in browser and the
cloud start are only there); it runs the goal above in auto mode and keeps the Mac awake (`request_keep_awake`).
Builders that need a preview slot run as **cloud sessions** (`start_session`, `target: "cloud"`, environment
`Fletch Cloud`, never the default one), one per leased slot, on Opus; they survive the Mac sleeping and have the
wrangler login the slots need. `claude -p` builders on this Mac do not work until Kyle runs `claude` and `/login`
(the OAuth session expired on 2026-10-30); until then a builder that needs no slot is an `Agent` sub-agent on Opus
briefed with `GOAL-PROMPT.md`'s goal text and `Target part: F<n>`, as F41 was.

Slots: `node scripts/preview.mjs list`; `gc` takes back an expired lease; a cloud builder runs `pnpm preview up` in
its own worktree and `down` when its part merges. Three slots, so at most three tier-2 parts at once; tier-1 parts,
contracts and translations need none. Evals run on the default model (Muse Spark through the gateway `qyvr`,
`CHAT_PROVIDER=meta`); a level earned on GLM alone is noted as such in the scorecard row.

Each cycle: `git fetch origin +refs/heads/main:refs/remotes/origin/main`, merge main, `node scripts/check-decisions.mjs`,
read `WAITING-ON-KYLE.md`'s `## Steering` (Kyle may wake and write), then the Queue. Prefer a builder per part over
serial work; while builders run, do the next ledger or contract item yourself rather than waiting. A builder's
PR opens as a draft: review, `gh pr ready`, gate with `gh pr checks <n> --repo kltdwrds/fletch --watch --fail-fast > "$LOG" 2>&1`
(never piped), `gh pr merge <n> --merge`. Builder branches start before ledger PRs merge, so expect `QUESTIONS.md` and
`PROGRESS.md` conflicts: take main's file, insert the branch's blocks, renumber question ids.

## What Kyle can do before sleeping (each one unblocks a Queue item; none blocks the rest)

1. Sign the built-in browser in to https://muse.ai in the desktop app (it was signed out on 2026-11-07): unblocks
   the interrogation of P8, P13 and P16 (Queue 9). Without it those three stay at level 0.
2. Unpack the P10 and P11 evidence tarball from the cloud session's chat into `docs/plan-v2/evidence/` and run
   `pnpm evidence-mirror`: unblocks Translate P10 and P11 (Queue 7). Without it they stay at level 0.
3. `claude` then `/login` in a terminal: lets builders run as `claude -p` on this Mac as well as in the cloud.

## Queue (the orchestrator marks each `done (PR #n)` or `blocked on Kyle (<item>)` in place)

1. **Defaults, first cycle, one docs PR.** *Done (this PR): 31 questions under `## Answered by default`, each mirrored in `WAITING-ON-KYLE.md`; Q10 stays.* Take the defaults for Q16, Q18, Q29, Q40 (keep the grader corrections,
   count one declared run), Q1 (fold F1 into D-0022 the way F7, F16 and F17 folded: row FOLDED, nothing to build),
   Q13, Q34, Q38 (closed by their orchestrator lines), Q39, Q37, Q35, Q31, Q30, Q22 to Q28 inclusive, Q19, Q21, Q17,
   Q15, Q14, Q12, Q11, Q6, Q2 (reads and reversible choices: taken as written), Q33 and Q32 (D-0018 and D-0017 built
   on as their recommended option, which is nothing new), Q27 (D-0016 per Defaults, Queue 10). Q10 stays blocked
   (D-0015 spends money on CI). Mirror each in its WAITING item.
2. **F24 and F26 DONE** *(done: F26 in the Queue 1 PR, F24 in the F45 PR; both rows DONE, P2 and P15 at level 2)*. For each, a fresh Opus verifier on the merged code with the default under Q16 or Q18 stated
   as Kyle's; on `VERIFIER: no blocking findings`, the PROGRESS row DONE, then P2 and P15 to level 2 quoting the
   accept lines in PR #36 and PR #42, the verifier lines and the must-have results files.
3. **F34 close-out (slot).** *(done: PR #107 ran both on main, T-P3-16 3 of 3, T-P3-14 0 of 3 on the launch words; the line part F46 (PR #112 written, PR #115 built: `ACCEPT F46: PASS`, `VERIFIER: no blocking findings`, T-P3-14 3 of 3) closed it; F34 and F46 DONE, P3 at level 2. The cloud session asked at 02:00Z showed no branch after three hours; local Opus agents ran it)* One cloud builder: one declared run each of T-P3-14 and T-P3-16 on current main, the
   results files committed, verifier, F34 DONE, P3 to level 2. Target part F34 with the default under Q29 in the brief.
4. **F44 DONE** *(done in the Queue 1 PR: the row DONE on Q40's default, P6's row notes it)* on the Q40 default (T-P6-09 at 2 of 3 accepted for a nice-to-have); P6's row notes it.
5. **F45, the lead-in bubble (write the part, then a slot).** *(F45 DONE: PR #111 merged, `ACCEPT F45: PASS`, `VERIFIER: no blocking findings`, T-P9-13 3 of 3, T-P12-10 3 of 3, T-P2-13 3 of 3 on fletch-pv-3; a local Opus agent built it after the cloud builder asked at 04:30Z showed no branch. F42 merged BLOCKED (PR #96, f79a426): its line, tier-1 test and T-P9-15 oracle correction in; declared run 12 on tree e98053c6 was 9 of 9 (T-P9-15, T-P9-13, T-P9-14), `ACCEPT F42: PASS` on a runner, `VERIFIER: no blocking findings`; then main's F50 and F51 lines merged and declared run 13 on the final tree was T-P9-13 3 of 3, T-P9-14 2 of 3, T-P9-15 2 of 3, replies unread, so the row is BLOCKED on Q49, a must-have at 2 of 3 being Kyle's bar, and P9's tier 2 runs again on main with the slot kept under Queue 6's rule. Queue 5 is done but for Kyle's Q49)* Muse Spark opens most turns with a lead-in bubble
   beside its first tool call; graders that read the first bubble or count replies take it for the reply (F42's
   finding, PR #96; F43 and F44 met it). Write F45 in `parts.md` from the P2 contract (the reply clause) as one
   cross-cutting part: one `WORK_WORDS` or engine rule that keeps the lead-in out of the graded reply, or one shared
   grader helper every task uses, whichever the contract's wording supports; its tier 2 is T-P9-13 and T-P12-10 on a
   slot. Then rebase F42 (PR #96) onto it, drop the out-of-scope clause the verifier named, run T-P9-15, merge.
6. **The Muse Spark sweep (three slots).** *(in progress, two of three merged: sweep A, P1 P2 P15 P6, PR #110 on tree acac47b9, its reruns on main with F45 in PR #118 (T-P6-04 3 of 3; T-P15-13 1 of 3, whose wrong replies are a plan beside the pausing share: the line part F47 (PR #121, `ACCEPT F47: PASS`, `VERIFIER: blocking findings`, tier 2 unmet at 1 of 3) and the engine rule F48 written for it); sweep C, P9 P12 P14, PR #114 on tree 77effb9 (T-P9-13 0 of 3, the lead-in, 3 of 3 under F45 and covered again by F42's declared run; every other must-have 3 of 3); sweep B, P5 P7 P3, PR #113 merged on tree 77effb9 (T-P5-13, T-P7-09, T-P7-11, T-P3-16 3 of 3; T-P5-15 2 of 3 then 3 of 3 after an oracle correction to `count()` and a declared rerun on tree b6032ff; T-P3-14 0 of 3, the launch lead-in, closed by F46 (PR #115); nice-to-haves T-P5-14 2 of 3, T-P7-14 0 of 3, T-P3-15 0 of 3 recorded, Q44). F48 landed (PR #126, 0362c48) merged BLOCKED with F47: `ACCEPT F48: PASS` on a runner twice (TREE 86ddbc30 at ed0d6c5, TREE 9102d780 on the final tree at 09ccefc), T-P15-13 3 of 3 on declared runs 2 (tree d1be8b4c) and 3 (the final tree ff7d1ed8); four verifier passes, the last `VERIFIER: blocking findings` on one finding only, the mid-part amendment of F48's own section being Kyle's ruling (Q48, BLOCKED (open)); PR #121 closed into it. The sweep's last open must-have was T-P9-14's 2 of 3 on F42's run 13 (Q49): the P9 re-sweep on main (PR #134, tree f8d5ae4ad665, fletch-pv-1, Muse Spark, the slot kept until every failed reply was read) gave T-P9-13 3 of 3, T-P9-14 3 of 3 and T-P9-15 2 of 3; the failed trial raised the host card in its first turn with no words of its own and said the bound-host words only in the second, wrong under the task, so no grader change: the line part F54 is written (parts.md), not built tonight. Every must-have is 3 of 3 on Muse Spark on main; F42's row stays BLOCKED until Kyle's Q49 sets the bar. Done but for Kyle's Q48 and Q49)* Every cluster at level 2 earned its tier 2 on GLM or on a mixed tree. Three
   cloud builders, clusters split by slot, each one declared run of every tier-2 task of its clusters on current main
   (`pnpm evals P<n>`), results committed, a table per cluster in the scorecard row. A must-have that fails is an
   oracle correction under KICKOFF's rule when the reply is right in other words, else a line part F46+ written from
   the cluster's contract (one instruction line, the task's re-grade), built by the same builder, merged. The sweep
   is done when every must-have is 3 of 3 on Muse Spark or has its line part merged.
7. **Translate P10 and P11** *(blocked on Kyle: the evidence tarball is not on this Mac, the `look` item of 2026-11-02 in `WAITING-ON-KYLE.md`)* (if their evidence is on the Mac, Queue note 2): the contract, tasks and deltas from
   the raw `answers/step-*.md`, drafted by an Opus sub-agent and reviewed by you; the one-way doors proposed; the
   parts written (tier 1, then tier 2 on a slot); a specimen for any owner-visible surface; builders dispatched.
8. **Nice-to-have line parts** *(in progress: Q22's remainder was closed by F44 (T-P6-12, 13, 14 3 of 3 at tree 513692a; on Muse Spark T-P6-12 2 of 3, recorded at the bar Q40's default set for T-P6-09, no part); T-P14-13 3 of 3 on Muse Spark (PR #114), so Q37's remainder is T-P14-14: F51; T-P9-16 (0 of 3, regressed before F45): F50; T-P15-14 and T-P15-16 (right in other words): F49; F49, F50 and F51 written in this PR, each to a local Opus builder on the first free slot. F49 DONE (PR #124: `ACCEPT F49: PASS`, `VERIFIER: no blocking findings`, T-P15-14 and T-P15-16 3 of 3 on fletch-pv-2). F51 DONE (PR #128: `ACCEPT F51: PASS`, `VERIFIER: no blocking findings`; T-P14-14 0 of 3 recorded with Q46, two oracle faults in the slot reader and the mail grader's literal, which F53 corrects under Q46's default). F50 IN PROGRESS (PR #123 merged: `ACCEPT F50: PASS`; T-P9-16 0 of 3, the create reply a plan beside the pausing card, F48's rule; Q45's default: F52 corrects the create grader and declares the run after F48, F50 DONE on it). F52 and F53 written in PR #131, each to a local Opus builder. F52 DONE (PR #133): T-P9-16's create grader reads the turn's bubbles before its card, so F48's sentence counts; KICKOFF's three things in `[F52]`; declared run 2 on tree 4b2f7d68c570, fletch-pv-2, Muse Spark, T-P9-16 3 of 3; `ACCEPT F52: PASS` on a runner (TREE b399173c1108, 1738 tests); `VERIFIER: no blocking findings`; F50 DONE on that run. F53 DONE (PR #132: the P14 slot reader keeps the envelope as a user message, the mail grader takes "as your agent" beside the platform's label; `ACCEPT F53: PASS` on a runner (TREE c4d94894546706e5b8966e6a3d2d6c2302bab1f9, 1737 tests); `VERIFIER: no blocking findings`; declared run 4 on the final tree c5cd02e4e483, fletch-pv-3, Muse Spark, T-P14-14 3 of 3, no Q50). F54 written from the P9 re-sweep (T-P9-15's first turn says the words before any card) and built when slots 2 and 3 came free (PR #136, merged BLOCKED: `ACCEPT F54: PASS` on a runner (TREE 9bbe1ce35f0d105c8b4796e39f691979071c0bc3, 1747 tests); `VERIFIER: no blocking findings`; declared run on tree d174647ece72, fletch-pv-2, Muse Spark, T-P9-15 2 of 3, trial 2's first turn "That read was refused — I'll prepare the binding request now." beside the card, wrong under the task, no grader change; Q50, BLOCKED (open), Kyle's: a nice-to-have's bar, or a part that moves the sentence to code against the contract's line). Done but for Kyle's Q50)* still open after the sweep: Q37 (T-P14-13 the lost-device reply, T-P14-14 the pronoun
   line), Q22's remainder after F44, Q31 if F42 did not close it. One part per cluster, built by a cloud builder.
9. **Interrogate P8, P13 and P16** *(done: P8 interrogated and drafted, mapped only under O4, D-0025 proposed, Q41 (PR #106); P13 interrogated and drafted, by pick and not picked, D-0026 proposed, Q42 (PR #108); P16 interrogated and drafted, find-and-hand-over under O5, D-0027 proposed, Q43; each with a WAITING decide item and a level-0 scorecard row; Translate waits on Kyle's doors for all three)* (if the built-in browser is signed in to Muse, Queue note 1): a scenario each,
   one Opus `Agent` per cluster with the browser tools under `INTERROGATE.md` and the ground rules (fixtures only,
   nothing pressed on a card, no credential, probes tagged and removed), evidence through `pnpm redact`; then
   Translate as in 7. P4 is its own track and is not interrogated here.
10. **D-0016, OAuth connectors** *(reopened 2026-11-08 12:50Z: the skip written at ~09Z (no slot hour left) was wrong once F54 released slots 2 and 3 with every other item closed, so F55 is written in `parts.md` (the record's recommended option as the Defaults allow: the consent redirect, the one-shot state row, the callback, the `oauth` kind and the refresh inside the egress path, each deletable) and built by a local Opus builder under KICKOFF; D-0016 stays proposed, its WAITING decide item gains the line "built on the default; reject the record and it comes out" with the list of what comes out. Blocked on Kyle (the D-0016 decide item in `WAITING-ON-KYLE.md`): built on the default, PR #138 merged BLOCKED as F44 and F48 were, `ACCEPT F55: PASS` (TREE 9d490cba821b, run 42484733609, 1761 tests), `VERIFIER: blocking findings` on the door alone; the row goes DONE only on Kyle's acceptance of the record)*, last and only after 1 to 8: a part under P9 built on the record's recommended
    option per Defaults (a redirect route, a refresh-token kind in the Vault, both deletable), its WAITING decide
    item saying so. Skip if a slot or the night is not left for it.
11. **Ledger truth pass** *(in progress: the P14 citations, §7's count, `docs/briefs/` and the log shortened in the truth-pass PR; the uat slot and the handoff note at the night's end when the builders release a slot. CI: `test/workers/f1-login-browser.test.ts` timed out at its 60 s budget in three of six full runs after 06:45Z (PR #121, PR #123, main at ca6b33c, docs only) with no step named; step markers were added so the next timeout says where the page stopped; a run red on it alone is rerun once, and nothing merges red. Night's end: fletch-pv-1 leased 48 h on main for the uat items, named once at the top of `WAITING-ON-KYLE.md` (the 2026-11-08 look item); the handoff note current. Done)*, interleaved while builders run: the P14 contract's two `test/live/*` citations (lines
    532 and 605) rewritten for the deleted lane; every uat item in `WAITING-ON-KYLE.md` pointed at one live slot on
    main (lease it for 48 h and name it once at the top); the decision log shortened under its cap, no line deleted;
    the handoff note kept current.

## One-hour run (2026-11-08)

Run from the Fletch Cloud environment by the cloud orchestrator session, 23:10Z to about 00:30Z, under Kyle's ruling
of 2026-11-08: "answer all of these with defaults and best effort to unblock, then continue work for the next hour in as
much fan-out and parallel work as possible; no blockers, just move; we can always go back later and reconcile." The
Defaults above still hold except where the ruling goes past them (a record's acceptance, a BLOCKED question's answer):
each such ruling is one line under `## Reconcile (2026-11-08 one-hour run)` in `WAITING-ON-KYLE.md`.

1. **The unblocking pass** *(PR #141)*: Q48, Q49, Q50 answered as Kyle's; F42, F47, F48, F54, F55 DONE; D-0016, D-0017,
   D-0018, D-0025, D-0026, D-0027 accepted with `decider: Kyle`; every decide item ticked with its ruling.
2. **Translate P8, P13, P16** under the accepted doors: three Opus sub-agents, one per cluster, branches
   `claude/translate-p8`, `-p13`, `-p16`, parts F60+, F70+, F80+ (ranges reserved per cluster to avoid clashes).
3. **Translate P10 and P11** from the evidence this container still holds (S-P10-01 and S-P11-01 of 2026-11-01, 114 and
   121 files; Kyle's Mac gets them from the session's tarball): two Opus sub-agents writing the contracts, Translation
   and parts F90+ and F100+, branches `claude/translate-p10` and `-p11`.
4. **Plain parts**: F56 the renderer behind the paid bindings (`claude/f56-render`, tier 2 on a `--paid` slot if the token
   allows); F59 the refused host's sentence as code's, Q50's answer (`claude/f59-refusal-words`, tier 2 on a slot);
   `pnpm preview staging convert` waiting for the new deploy (`claude/staging-convert-waits`, a plain PR); `pnpm preview
   staging secrets` (`claude/staging-secrets`, a plain PR, tests over fakes). Slots 2 and 3 are the tier-2 slots; slot 1
   is staging and untouched.
5. **Ledgers**: this section, the PROGRESS, SCORECARD and WAITING lines as each PR merges; builder branches start before
   PR #141 merges, so parts.md, PROGRESS.md and QUESTIONS.md conflicts are resolved at merge (main's file, the branch's
   blocks inserted, question ids renumbered).

## What is not for tonight

Level 3 (Locked) needs Kyle's UAT; D-0015 (tier-2 evals in CI) spends money; D-0011 needs Kyle's own commit; a Muse
sign-in or a Meta approval is his. Each stays in `WAITING-ON-KYLE.md` where it already is.
