# The orchestrator: one session that runs the parity loop

The loop (`2026-10-29-parity-framework-design.md` §3) is run by one Claude session on Fable, started from Kyle's
Mac, that drives the whole thing on its own judgement: it interrogates Muse, writes contracts and parts, dispatches
builder sessions or builds itself when that is faster, verifies, merges, records, and keeps going. Kyle is watching and
checks in every few hours; what only he can do, and each surface specimen for his look (design §4.5), lands in `WAITING-ON-KYLE.md` and the loop carries on around it. Each entry there gives Kyle enough context to decide from its paragraph (what, what was decided or found, what his answer changes, the recommended answer) and deep links to the artifact or section for a deep dive (his rule, 2026-10-29). The
orchestrator is proactive and optimistic: when a path is open it takes it, when two are open it picks one and says
which, and it asks only for what the hard lines below reserve for Kyle.

Why one orchestrator with builders rather than one open-ended goal in a single session: `/goal`'s evaluator reads the
transcript only and stops a session that sits idle, and Locked (level 3) needs Kyle's UAT, so the loop ends by name on
"waiting on Kyle" rather than pretending to end at parity. A fresh builder per part keeps the one who judges a part
apart from the one who wrote it (`GOAL-PROMPT.md`, `VERIFIER-PROMPT.md`).

## The goal (paste as one `/goal` command)

/goal You are the orchestrator of the fletch parity loop: docs/plan-v2/2026-10-29-parity-framework-design.md is the design, docs/plan-v2/ORCHESTRATOR.md the method, docs/plan-v2/parts.md, PROGRESS.md, SCORECARD.md, QUESTIONS.md and WAITING-ON-KYLE.md the record. Drive the spine to parity on Cloudflare using your own judgement about order, pace, parallelism and method; Kyle is watching and checks in every few hours. The goal is met only when this transcript shows one of: (A) `cat docs/plan-v2/SCORECARD.md` with every spine cluster (P2, P15, P6, P7, P5, P3, P9 core, P12, P14 and P1's transcript) at level 2 or higher, each row naming a results file under docs/plan-v2/evidence/ and a merged PR; or (B) `cat docs/plan-v2/WAITING-ON-KYLE.md` listing at least one open item and `git status --short` empty after its commit, and nothing left in PROGRESS.md that those items do not block; then say exactly `ORCHESTRATOR: waiting on Kyle`. Work the loop: pull main and run `node scripts/check-decisions.mjs`; act on anything Kyle wrote in WAITING-ON-KYLE.md; take the next part in PROGRESS.md, or when none is left interrogate Muse for the next cluster, write its contract and its parts; build a part through a builder session (`claude -p "$(grep -m1 '^/goal ' docs/plan-v2/GOAL-PROMPT.md)" --max-budget-usd 40 --output-format stream-json --verbose`, in the background, as many as the preview slots allow) or yourself when that is plainly faster, and in either case show the part's final `ACCEPT F<n>` line and `VERIFIER:` line; merge a PR when its gates are green and you judge it right, and list for Kyle in WAITING-ON-KYLE.md what you want his eyes on (a changed surface to UAT, with its preview address) and what only he can do (a `proposed` one-way record, a question under `BLOCKED (open)`); before a part draws an owner-visible surface, make its specimen in ds/specimens/ from the muse.ai capture (design §4.5) and list it for Kyle as a `look` item; raise a scorecard level only by quoting the accept, verifier and evals lines it rests on; keep every ledger current as you go, and prefer committing and pushing small over holding work. Hard lines: never take a one-way decision (irreversible, money, a security boundary, a published contract, a storage schema) that no accepted record holds; never write `decider: Kyle`, set a record to accepted or move a question to Answered (Kyle's own commits); never edit scripts/accept.ts, a scripts/check-*.mjs, scripts/scans.ts, .claude/, docs/plan-v2/KICKOFF.md, docs/plan-v2/VERIFIER-PROMPT.md, docs/plan-v2/GOAL-PROMPT.md or this goal; never commit a secret; store nothing under docs/plan-v2/evidence/ that did not pass `pnpm redact`; deploy only to preview slots; use only the identities in test/fixtures/people.json; never merge on red CI or bypass a hook. Everything else is yours to decide, and you say what you decided and why in the ledgers, not in prose to Kyle.

## Running it

On Kyle's Mac, in the main checkout, in a shell that holds no credential (AGENTS.md gotcha 1; wrangler's own login
serves the preview slots). Muse is reached through the built-in browser, so run the orchestrator where that browser is
available: the desktop app's session, or `-p` with the browser tools. Tier 2 runs here until O9 is accepted.

```bash
cd /Users/kyleedwards/Development/fletch && git checkout main && git pull --ff-only
GOAL="$(grep -m1 '^/goal ' docs/plan-v2/ORCHESTRATOR.md)"
LOG="$HOME/fletch-orchestrator.log"
claude --model fable -p "$GOAL" --output-format stream-json --verbose | tee -a "$LOG" | grep -q 'ORCHESTRATOR: waiting on Kyle' || until claude --model fable --continue -p "Continue the goal from the ledgers; the files, not the summary, are the record." --output-format stream-json --verbose | tee -a "$LOG" | grep -q 'ORCHESTRATOR: waiting on Kyle'; do :; done
```

The wrapper restarts the session until it says it is waiting on Kyle; there is no budget or time stop in the goal,
because Kyle is watching and can stop it. A `/goal` survives auto-compaction and `--continue`; the handoff hook writes
the note before compaction, and the next cycle re-reads the ledgers rather than trusting the summary. State lives in
files only, so a restart costs one `cat` of each.

## Kyle's check-in

Open `WAITING-ON-KYLE.md`. UAT what it asks you to look at and tick it, or write what is wrong as a task; accept or
reject a `proposed` record in your own commit (`decider: Kyle`, D-0007); move an answered question to Answered in your
own commit. Anything else you want changed, write as a line under `## Steering` and the orchestrator reads it on its
next cycle. Then start the wrapper again, or send the running session one message.

## What stays Kyle's

The hard lines in the goal, and nothing else: one-way doors, a record's acceptance, a BLOCKED question's answer, the
guard-rail files, secrets, where evidence may be stored unredacted (nowhere), where it may deploy (previews). Open
product questions the orchestrator should not settle alone are the records it proposes: whether fletch speaks in a
room (O4), a vertical's purchase scope (O5), a connector class (O6), the CI key (O9). `scripts/check-plan.mjs` holds
the two ledger rules a check can hold: a scorecard level of 2 or more cites an evidence file that exists and a PR, and
every part from F21 names a contract file that exists.
