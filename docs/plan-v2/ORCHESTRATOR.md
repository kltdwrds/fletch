# The orchestrator: one session that runs the parity loop

The loop (`2026-10-29-parity-framework-design.md` §3) is run by one Claude session on Fable, started from Kyle's
Mac, that picks, dispatches, verifies and records, and never builds. Builders are the per-part `/goal` sessions of
`GOAL-PROMPT.md`, one fresh process each, so the worker and the one who judges it are never the same session. Kyle is
away for hours at a time; everything that needs him lands in `WAITING-ON-KYLE.md`, and the orchestrator carries on with
what those items do not touch. Why this shape and not one open-ended goal: `/goal`'s evaluator reads the transcript
only, stops a session that makes no tool calls for a few turns (a session waiting on UAT), and Locked (level 3) needs
Kyle's UAT by definition, so no unattended condition can honestly end at "parity". The reviewer's note of 2026-10-29 and
Anthropic's long-running-harness guidance both land on one unit of work per worker and a coordinator that reads
reports, not transcripts.

## The goal (paste as one `/goal` command)

/goal Run the fletch parity loop as orchestrator (docs/plan-v2/2026-10-29-parity-framework-design.md §3; docs/plan-v2/ORCHESTRATOR.md is the method). The goal is met only when this transcript shows one of: (A) `cat docs/plan-v2/SCORECARD.md` with every spine cluster (P2, P15, P6, P7, P5, P3, P9 core, P12, P14, and P1's transcript) at level 2 or higher, each row naming a results file under docs/plan-v2/evidence/ and a merged PR number; or (B) `cat docs/plan-v2/WAITING-ON-KYLE.md` listing at least one open item, `git log -1 --oneline` and `git status --short` showing it committed and pushed, and `cat docs/plan-v2/PROGRESS.md` showing no TODO or IN PROGRESS row that an open item does not block; then say exactly `ORCHESTRATOR: waiting on Kyle`. Each cycle, shown in full: (1) `git pull --ff-only origin main` and `node scripts/check-decisions.mjs`; (2) read docs/plan-v2/WAITING-ON-KYLE.md for Kyle's answers since the last cycle and act on each; (3) pick the first docs/plan-v2/PROGRESS.md row not DONE and not BLOCKED; when none is left and the next spine cluster in design §6 order has a contract whose Translation section is filled, write its parts into docs/plan-v2/parts.md on a branch and open a PR titled `plan: P<n> parts` for Kyle; (4) never build a part yourself: start a builder with `claude -p "$(grep -m1 '^/goal ' docs/plan-v2/GOAL-PROMPT.md)" --max-budget-usd 40 --output-format stream-json --verbose` in the background, one builder per leased preview slot and at most two at once, and when it ends paste its final `ACCEPT F<n>` line, its `VERIFIER:` line and its PR link; (5) for a builder's draft PR: when its part changed no owner-visible surface (nothing under packages/agent/src/http/app/ or ds/) and its `pnpm evals` table, where the part has tasks, shows every must-have task `pass`, mark it ready and merge it and show `gh pr view <n> --json merged`; otherwise append it to WAITING-ON-KYLE.md as a UAT item with the preview address and move on; (6) append to WAITING-ON-KYLE.md, commit and push, every `proposed` one-way record, every question under `BLOCKED (open)`, every plan PR from step 3, and every scorecard change (a scorecard row changes only in a PR Kyle reads); (7) run a cluster's Interrogate stage against Muse only after WAITING-ON-KYLE.md holds Kyle's line `interrogate P<n>: go` for it, and store nothing under docs/plan-v2/evidence/ that did not pass `pnpm redact`. Constraints: never edit scripts/accept.ts, a scripts/check-*.mjs, scripts/scans.ts, .claude/, docs/plan-v2/KICKOFF.md, docs/plan-v2/VERIFIER-PROMPT.md, docs/plan-v2/GOAL-PROMPT.md or docs/plan-v2/ORCHESTRATOR.md; never write `decider: Kyle`, set a one-way record to accepted, or move a question to Answered (those are Kyle's own commits); never mark a PROGRESS row DONE or raise a scorecard level without quoting the accept, verifier and evals lines it rests on; never merge a PR whose CI is not green; deploy only to preview slots; use only the identities in test/fixtures/people.json; never commit a secret. Stop and say `ORCHESTRATOR: budget` after 12 hours or when the builders this run started have spent $300 between them; stop and say `ORCHESTRATOR: blocked` with the reason on an authentication or permission error, or when the same builder failure repeats three times.

## Running it

On Kyle's Mac, in the main checkout, in a shell that holds no credential (AGENTS.md gotcha 1; wrangler's own login
serves the preview slots, and Muse is reached through the built-in browser of the desktop app, so the orchestrator is
an interactive desktop session or a `-p` process with the browser available). Tier 2 runs here until O9 is accepted.

```bash
cd /Users/kyleedwards/Development/fletch && git checkout main && git pull --ff-only
GOAL="$(grep -m1 '^/goal ' docs/plan-v2/ORCHESTRATOR.md)"
LOG="$HOME/fletch-orchestrator.log"
claude --model fable -p "$GOAL" --max-budget-usd 60 --output-format stream-json --verbose | tee -a "$LOG" | grep -q 'ORCHESTRATOR: waiting on Kyle' || for run in 2 3 4 5 6; do claude --model fable --continue -p "Continue the goal from the ledgers; the files, not the summary, are the record." --max-budget-usd 60 --output-format stream-json --verbose | tee -a "$LOG" | grep -q 'ORCHESTRATOR: waiting on Kyle' && break; done
```

Six runs is the day's cap across restarts; each builder carries its own `--max-budget-usd 40`. A `/goal` survives
auto-compaction and `--continue`; the handoff hook writes the note before compaction, and the next cycle re-reads
`PROGRESS.md`, `WAITING-ON-KYLE.md` and `SCORECARD.md` rather than trusting the summary. State lives in files only:
`PROGRESS.md` is the queue, `QUESTIONS.md` the stops, `SCORECARD.md` the result, `contracts/` and `evidence/` the
work, `WAITING-ON-KYLE.md` the hand-off. A restart costs one `cat` of each.

## Kyle's check-in

Open `WAITING-ON-KYLE.md`. For each open item: UAT the preview it names and tick it, or write what is wrong as a task
for the builder; accept or reject a `proposed` record in your own commit (`decider: Kyle`, D-0007); move an answered
question to Answered in your own commit; write `interrogate P<n>: go` under a cluster before the orchestrator may drive
your Muse account for it. Then send the orchestrator one message ("check-in done") or start the wrapper again; it
reads the file and continues. A scorecard or plan PR waits for your merge.

## What the orchestrator may not decide

One-way doors (money, a security boundary, a published contract, a storage schema), a record's acceptance, a BLOCKED
question's answer, whether fletch speaks in a room (O4), a vertical's purchase scope (O5), a connector class's record
(O6), the CI key (O9), and any edit to the guard rails named in the goal. `scripts/check-plan.mjs` holds the two
ledger rules it is most tempted to bend: a scorecard level of 2 or more cites an evidence file that exists and a PR,
and every part from F21 names a contract file that exists.
