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
3. **F34 close-out (slot).** One cloud builder: one declared run each of T-P3-14 and T-P3-16 on current main, the
   results files committed, verifier, F34 DONE, P3 to level 2. Target part F34 with the default under Q29 in the brief.
4. **F44 DONE** *(done in the Queue 1 PR: the row DONE on Q40's default, P6's row notes it)* on the Q40 default (T-P6-09 at 2 of 3 accepted for a nice-to-have); P6's row notes it.
5. **F45, the lead-in bubble (write the part, then a slot).** Muse Spark opens most turns with a lead-in bubble
   beside its first tool call; graders that read the first bubble or count replies take it for the reply (F42's
   finding, PR #96; F43 and F44 met it). Write F45 in `parts.md` from the P2 contract (the reply clause) as one
   cross-cutting part: one `WORK_WORDS` or engine rule that keeps the lead-in out of the graded reply, or one shared
   grader helper every task uses, whichever the contract's wording supports; its tier 2 is T-P9-13 and T-P12-10 on a
   slot. Then rebase F42 (PR #96) onto it, drop the out-of-scope clause the verifier named, run T-P9-15, merge.
6. **The Muse Spark sweep (three slots).** Every cluster at level 2 earned its tier 2 on GLM or on a mixed tree. Three
   cloud builders, clusters split by slot, each one declared run of every tier-2 task of its clusters on current main
   (`pnpm evals P<n>`), results committed, a table per cluster in the scorecard row. A must-have that fails is an
   oracle correction under KICKOFF's rule when the reply is right in other words, else a line part F46+ written from
   the cluster's contract (one instruction line, the task's re-grade), built by the same builder, merged. The sweep
   is done when every must-have is 3 of 3 on Muse Spark or has its line part merged.
7. **Translate P10 and P11** *(blocked on Kyle: the evidence tarball is not on this Mac, the `look` item of 2026-11-02 in `WAITING-ON-KYLE.md`)* (if their evidence is on the Mac, Queue note 2): the contract, tasks and deltas from
   the raw `answers/step-*.md`, drafted by an Opus sub-agent and reviewed by you; the one-way doors proposed; the
   parts written (tier 1, then tier 2 on a slot); a specimen for any owner-visible surface; builders dispatched.
8. **Nice-to-have line parts** still open after the sweep: Q37 (T-P14-13 the lost-device reply, T-P14-14 the pronoun
   line), Q22's remainder after F44, Q31 if F42 did not close it. One part per cluster, built by a cloud builder.
9. **Interrogate P8, P13 and P16** *(in progress: P8 interrogated and its contract drafted, mapped only under O4, D-0025 proposed, Q41, WAITING decide item; P13 and P16 running)* (if the built-in browser is signed in to Muse, Queue note 1): a scenario each,
   one Opus `Agent` per cluster with the browser tools under `INTERROGATE.md` and the ground rules (fixtures only,
   nothing pressed on a card, no credential, probes tagged and removed), evidence through `pnpm redact`; then
   Translate as in 7. P4 is its own track and is not interrogated here.
10. **D-0016, OAuth connectors**, last and only after 1 to 8: a part under P9 built on the record's recommended
    option per Defaults (a redirect route, a refresh-token kind in the Vault, both deletable), its WAITING decide
    item saying so. Skip if a slot or the night is not left for it.
11. **Ledger truth pass** *(in progress: the P14 citations, §7's count, `docs/briefs/` and the log shortened in the truth-pass PR; the uat slot and the handoff note at the night's end when the builders release a slot)*, interleaved while builders run: the P14 contract's two `test/live/*` citations (lines
    532 and 605) rewritten for the deleted lane; every uat item in `WAITING-ON-KYLE.md` pointed at one live slot on
    main (lease it for 48 h and name it once at the top); the decision log shortened under its cap, no line deleted;
    the handoff note kept current.

## What is not for tonight

Level 3 (Locked) needs Kyle's UAT; D-0015 (tier-2 evals in CI) spends money; D-0011 needs Kyle's own commit; a Muse
sign-in or a Meta approval is his. Each stays in `WAITING-ON-KYLE.md` where it already is.
