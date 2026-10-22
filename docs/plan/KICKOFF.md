# KICKOFF: the session protocol for a part

A part is one `F<n>` (or split `F<n>.<p>`) in `docs/plan/parts.md`: one session's worth of roadmap work, proven by
`pnpm accept` and a fresh verifier. Read this file first in every session that works a part, unattended or not.
Work that is not a part is a plain PR (AGENTS.md, "Start here"); none of this applies to it. Adapted from
qyvr-co's plan-v2 KICKOFF.

## Read in this order

1. `docs/plan/PROGRESS.md`: the first part not DONE is the target, unless the goal names one ("Target part: F3").
   If the target is BLOCKED, read `docs/plan/QUESTIONS.md` and stop.
2. `docs/plan/parts.md`: the target's Scope, Acceptance, Not in scope and its **Read** line, which names every other
   document the part needs. Read those and nothing else unless a scope line sends you there.
3. `docs/plan/QUESTIONS.md`: if a question under `BLOCKED (open)` names the target, stop.
4. `docs/decisions/README.md`: the index of decision records and how one becomes binding. An accepted record binds
   the part; if the scope contradicts one, that is a question and a proposed superseding record, not a choice. Run
   `node scripts/check-decisions.mjs` at the start: a record past its review date is the part's first question.
5. `VISION.md`, when the part adds or changes something the owner sees.

`docs/plan/VERIFIER-PROMPT.md` is what you give the verifier, unchanged.

## Rules

- **Do not settle one-way doors.** A reversible implementation choice is yours: a dated line with its reason in
  `docs/decisions/log.md`, or a record with `decider: agent` when others will rely on it. Anything irreversible,
  anything that spends money, a security boundary, a published package's contract or a storage schema is a
  `proposed` record plus a question in `docs/plan/QUESTIONS.md` with your recommended answer; carry on only with what
  it does not touch. Never write `decider: Kyle` yourself.
- **Do not edit the plan's guard rails.** `scripts/accept.ts`, `.claude/settings.json`, this file and
  `docs/plan/VERIFIER-PROMPT.md` change only when the part's scope names them. A part may split itself in
  `docs/plan/parts.md` (below) and add its own rows to the ledgers; nothing else in `docs/plan/`.
- **No secrets in the repository.** Credentials come from the environment; the scans run in the pre-commit hook and
  in accept. A live step needs its variables set by Kyle; a missing one is a question, not a reason to skip.
- **Hermetic by default.** Tests see no credential and no network; the model is the scripted fake; live calls only
  in `*.live.test.ts`. Own the store, not the clock: no sleeps, no retries. A test that passes on retry is a bug.
- **Fixtures use only the identities in `test/fixtures/people.json`.** A claim involving two people is tested with
  two members.
- **Plant the guard.** Every check, gate and refusal the part adds has a test that plants the violation and fails
  without the guard, on the production path.
- **Fix what a hook reports; never bypass it.** `.claude/hooks/no-hook-bypass.mjs` enforces it.
- **Deploy only to a throwaway account.** Never to an owner's deploy.

## How to work a part

1. State the part id and restate its Scope and Not in scope in your own words before touching code. If it will
   not fit one session, split it first: replace its section in `docs/plan/parts.md` with `F<n>.1`, `F<n>.2`, … (each
   with its own Scope, Acceptance and Not in scope), log the split in `docs/decisions/log.md`, and do exactly one.
2. Work on a branch named for the part (or the branch the session was given). Write the acceptance tests first,
   tagged `[F<n>]` in their top-level `describe`, then the implementation.
3. Commit small and conventional, naming the part (`feat(agent): F3 …`), signed off (`git commit -s`). Show
   `git log -1 --oneline` and `git status --short` after each commit.
4. Run `pnpm accept F<n>` when a sub-system is complete and at the end. Show the final run's full output: the tree
   hash, the step counts and the last line. Never summarise it. Red before green while writing tests is expected.
5. Before declaring the part done, spawn a fresh-context verifier sub-agent on Opus (the Agent tool's
   `model: "opus"`), whatever model this session runs on, with `docs/plan/VERIFIER-PROMPT.md` unchanged, the part's
   section, `git diff <base>..HEAD` and the final accept output. Paste its report. Fix blocking findings and re-run
   accept.
6. Update `docs/plan/PROGRESS.md`: `| F<n> | DONE | <commit> | <date> | <one line> |`, the line holding the accept
   tree hash, the test counts, the verifier result, the duration and `model: <model>`. Commit it and show the row.
7. Push the branch and open a draft PR titled `F<n>: <scope in one line>`, its body the restated scope, the accept
   summary and the verifier's last line. Never merge it yourself: Muse merges it after its UAT pass, or Kyle does
   (`docs/runbooks/muse-execution.md`), and that merge is the hand-off.
8. If the final `pnpm accept` fails three times in a row on the same cause after the implementation is complete,
   stop: write what you learned under `BLOCKED (open)` in `docs/plan/QUESTIONS.md` and mark the row BLOCKED, rather
   than working around the acceptance.

## Questions

Each question in `docs/plan/QUESTIONS.md` is `### Q<n> (F<n>), <date>: <title>`, then **Blocks:** (what it stops),
**Recommended answer:** (yours, with its reason) and, once given, **Answered (Kyle, <date>):**. A question that stops
the target goes under `BLOCKED (open)`; Kyle moves it to Answered, and the loop resumes. When Kyle's answer settles a
proposed record, he (or the session, quoting him) sets it to `accepted` with `decider: Kyle` in the same commit, so the
answer is never the only record.

## Long sessions and compaction

The handoff hook nudges before compaction; write the note with the handoff skill. After a compaction re-read
`docs/plan/PROGRESS.md`, the target's section and `docs/decisions/README.md` before continuing: the files, not the summary,
are the record.

## Cost

Prefer reading the plan to re-deriving it, and delegate large reads to sub-agents. One full accept at the end of a
part; interim runs may use `ACCEPT_PASS_CACHE=1`, the final one never.

## Raising a rule

When the verifier or your own review finds the same defect class twice, propose one change in
`docs/plan/QUESTIONS.md`: add, sharpen or delete a rule in AGENTS.md, add a check under `scripts/`, or add a hook. A
rule changes only when Kyle agrees.
