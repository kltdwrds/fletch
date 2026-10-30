# KICKOFF: the builder's protocol for a part

A part is one `F<n>` (or split `F<n>.<p>`) in `parts.md`: one session's worth of work, proven by `pnpm accept` and a
fresh verifier. Read this file first in every session that works a part, unattended or not. The loop that writes
parts (interrogate, translate, build, lock) is `2026-10-29-parity-framework-design.md` §3; this file is the Build
stage. Work that is not a part is a plain PR (AGENTS.md, "Start here"); none of this applies to it.

## Read in this order

1. `PROGRESS.md`: the first part not DONE is the target, unless the goal names one ("Target part: F19"). If the
   target is BLOCKED, read `QUESTIONS.md` and stop.
2. `parts.md`: the target's Scope, Acceptance, Not in scope and its **Read** line, which names every other document
   the part needs, the cluster's `contracts/P<n>-<slug>.md` among them. Read those and nothing else unless a scope line
   sends you there.
3. `QUESTIONS.md`: if a question under `BLOCKED (open)` names the target, stop.
4. `docs/decisions/README.md`: an accepted record binds the part; if the scope contradicts one, that is a question and
   a proposed superseding record, not a choice. Run `node scripts/check-decisions.mjs` at the start: a record past its
   review date is the part's first question.
5. `VISION.md`, when the part adds or changes something the owner sees.

`VERIFIER-PROMPT.md` is what you give the verifier, unchanged.

## Rules

- **Do not settle one-way doors.** A reversible choice is yours: a dated line with its reason in
  `docs/decisions/log.md`, or a record with `decider: agent` when others will rely on it. Anything irreversible, anything
  that spends money, a security boundary, a published package's contract or a storage schema is a `proposed` record
  plus a question in `QUESTIONS.md` with your recommended answer; carry on only with what it does not touch. Never
  write `decider: Kyle` yourself.
- **Do not edit the guard rails.** `scripts/accept.ts`, `.claude/settings.json`, this file, `VERIFIER-PROMPT.md` and
  a cluster's contract change only when the part's scope names them. A part may split itself in `parts.md` (below) and
  add its own rows to the ledgers; nothing else in `docs/plan-v2/`.
- **No secrets in the repository.** Credentials come from the environment; the scans run in the pre-commit hook and
  in accept. Accept deploys nothing and has no live step; a tier-2 run needs its variables set by Kyle, and a missing
  one is a question, not a reason to skip.
- **Hermetic by default.** Tests see no credential and no network; the model is the scripted fake; real-model calls
  only under `pnpm evals`, on a preview slot. Own the store, not the clock: no sleeps, no retries. A test that passes
  on retry is a bug.
- **Fixtures use only the identities in `test/fixtures/people.json`.** A claim involving two people is tested with
  two members.
- **Plant the guard.** Every check, gate and refusal the part adds has a test that plants the violation and fails
  without the guard, on the production path.
- **Fix what a hook reports; never bypass it.** `.claude/hooks/no-hook-bypass.mjs` enforces it.
- **Deploy only to a preview slot or a throwaway account.** Never to an owner's deploy.

## How to work a part

1. State the part id and restate its Scope and Not in scope in your own words before touching code. If it will not
   fit one session, split it first (`F<n>.1`, `F<n>.2`, … in `parts.md`, each with its own Scope, Acceptance and Not
   in scope; the split logged in `docs/decisions/log.md`) and do exactly one.
2. Work on a branch named for the part. Write the acceptance tests first, tagged `[F<n>]` in their top-level
   `describe`, then the implementation.
3. Commit small and conventional, naming the part (`feat(agent): F19 …`), signed off (`git commit -s`). Show
   `git log -1 --oneline` and `git status --short` after each commit.
4. Run `pnpm accept F<n>` when a sub-system is complete and at the end. Show the final run's full output: the tree
   hash, the step counts and the last line. Never summarise it.
5. Before declaring the part done, spawn a fresh-context verifier sub-agent on Opus (the Agent tool's
   `model: "opus"`), whatever model this session runs on, with `VERIFIER-PROMPT.md` unchanged, the part's section,
   `git diff <base>..HEAD` and the final accept output. Paste its report. Fix blocking findings and re-run accept.
6. Update `PROGRESS.md`: `| F<n> | DONE | <commit> | <date> | <one line> |`, the line holding the accept tree hash,
   the test counts, the verifier result, the duration and `model: <model>`. Commit it and show the row.
7. Push the branch and open a draft PR titled `F<n>: <scope in one line>`, its body the restated scope, the accept
   summary and the verifier's last line. Never merge it yourself: the orchestrator merges it after tier 2 and Kyle's
   UAT where a surface changed (design §3, §8), and that merge is the hand-off.
8. If the final `pnpm accept` fails three times in a row on the same cause after the implementation is complete,
   stop: write what you learned under `BLOCKED (open)` in `QUESTIONS.md` and mark the row BLOCKED.

## Questions

Each question in `QUESTIONS.md` is `### Q<n> (F<n>), <date>: <title>`, then **Blocks:**, **Recommended answer:** and,
once given, **Answered (Kyle, <date>):**. A question that stops the target goes under `BLOCKED (open)`; Kyle moves it
to Answered in his own commit, and the loop resumes. When his answer settles a proposed record, he sets it to
`accepted` with `decider: Kyle`, also in his own commit (Q9, answered: a session never does either, however it heard
him). What waits on him is listed in `WAITING-ON-KYLE.md`; the orchestrator (`ORCHESTRATOR.md`) keeps that list.

## Long sessions, cost, rules

The handoff hook nudges before compaction; write the note with the handoff skill, and after a compaction re-read
`PROGRESS.md`, the target's section and `docs/decisions/README.md`: the files, not the summary, are the record. One
full accept at the end of a part; interim runs may use `ACCEPT_PASS_CACHE=1`, the final one never. When the verifier
or your own review finds the same defect class twice, propose one change in `QUESTIONS.md` (AGENTS.md, "Raising a
rule").
