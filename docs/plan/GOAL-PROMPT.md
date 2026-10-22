# The `/goal` prompt for unattended parts

How `/goal` behaves (qyvr-co verified it against https://code.claude.com/docs/en/goal.md on 2026-10-11; see
qyvr-co's `docs/plan-v2/GOAL-PROMPT.md` for the detail): after each turn a small, tool-less model judges the
condition from the transcript only and returns met, not met or impossible. The condition is at most 4,000
characters. It is session-scoped, schedules nothing, and does not change the permission mode, so an unattended
run needs auto mode or allow rules.

Design consequence: one goal per part, the same condition text every session, and proof through output the
evaluator can read.

## The goal condition (paste as one `/goal` command)

/goal Read docs/plan/KICKOFF.md and follow its session protocol, then advance fletch by exactly one part. The goal is met only when ALL of the following are visible in this transcript: (1) you named the first part in docs/plan/parts.md whose row in docs/plan/PROGRESS.md is not DONE, and restated its scope and not-in-scope lines; (2) that scope is implemented with tests tagged with the part's id that exercise the acceptance claims, hermetic by default with the fake model, using two members from test/fixtures/people.json wherever a claim involves more than one person; (3) you ran `pnpm accept <id>` with full output shown, it printed the TREE line and the per-step counts, and its final line reads exactly `ACCEPT <id>: PASS`; (4) a fresh-context verifier sub-agent on Opus, given docs/plan/VERIFIER-PROMPT.md unchanged, reviewed the diff against that part's section and its report is quoted, ending with `VERIFIER: no blocking findings`; (5) PROGRESS.md marks the part DONE with the commit hash, the row is shown, `git status --short` prints nothing after the final commit, and a draft PR for the branch is open. Constraints: never commit a secret; deploy only to a throwaway account, never to an owner's deploy; never edit scripts/accept.ts, a scripts/check-*.mjs, scripts/scans.ts, .claude/settings.json, .claude/hooks/, docs/plan/KICKOFF.md or docs/plan/VERIFIER-PROMPT.md unless the part names them; never merge the PR; use only the identities in test/fixtures/people.json; take no one-way decision (irreversible, spends money, a security boundary, a published package's contract, a storage schema) that no accepted record in docs/decisions/ decided by Kyle holds, and never write `decider: Kyle` yourself. Impossible for this session (stop, write to docs/plan/QUESTIONS.md under the heading `BLOCKED (open)`, and say `BLOCKED: needs Kyle`) if: a question under `BLOCKED (open)` names the part; the part needs a one-way decision nobody has taken; the final `pnpm accept` fails three consecutive times on the same cause after the implementation is complete; a live step needs credentials that are not set; or an authentication or permission error blocks the work. Do not work around the acceptance script, weaken a test, or mark a part DONE without the PASS line.

## Each session

Run `claude` in the checkout on an up-to-date `main` and paste the `/goal` line above. It picks the next part from
`docs/plan/PROGRESS.md`, works it on a branch and ends with a draft PR. Between sessions, Kyle reviews and merges
the PR, reads `docs/plan/QUESTIONS.md`, answers under each blocked question and moves it to Answered, and commits.
Kyle's merge is the gate; the evaluator's reading bounds the session, not the product.

For an attended machine, a loop that stops at the first blocked part:

```bash
for i in 1 2 3; do claude -p "$(grep -m1 '^/goal ' docs/plan/GOAL-PROMPT.md)" --max-budget-usd 40 --output-format stream-json --verbose || break; awk '/^## /{s=($0=="## BLOCKED (open)")} s&&/^### /{f=1} END{exit !f}' docs/plan/QUESTIONS.md && break; done
```

A parallel part prefixes the line with `Target part: <ID>. ` and replaces "the first part in docs/plan/parts.md
whose row in docs/plan/PROGRESS.md is not DONE" with "part <ID> in docs/plan/parts.md (other parts may run in
parallel)"; it touches only that part's scope and rows.

## Why the condition is shaped this way

- Every clause is provable from visible output; the evaluator has no tools.
- "Exactly one part" keeps sessions bounded and gives Kyle one PR to review per part.
- The gate scripts are named in the constraints because a session quietly weakening the gate is the one failure
  the evaluator cannot see; the verifier checks the diff for it.
- The one-way-door clause stops the loop instead of letting it decide what is Kyle's, which is how decisions go
  stale: taken silently, contradicted later.
- It states goals and constraints, not steps; `docs/plan/KICKOFF.md` carries the method.
