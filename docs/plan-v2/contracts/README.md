# Contracts: one file per cluster

A cluster's contract is `P<n>-<slug>.md` in this folder (design §3, Appendix A): what Muse does, proven by evidence,
what fletch builds for it, and how it is graded. The orchestrator writes it through the Interrogate and Translate
stages (`../INTERROGATE.md`); a builder reads it and never edits it (`../KICKOFF.md`, "Do not edit the guard rails").
Parts from F21 name their contract in their **Read** line (`scripts/check-plan.mjs`).

## The template

```
# P<n> <cluster> — contract
Evidence: dump <version>; captures <ids>; interrogation <date>

## Clauses
B-P<n>-01: <one sentence, imperative, verifiable>
  over-cautious: <under-acting looks like>     over-bold: <over-acting looks like>
  evidence: <row | capture | prompt line>       tags: [instrumented | attested]
  tasks: <ids>

## Tasks
T-P<n>-01  must-have  tier 2
  setup: <seeded records, files, jobs>   turns: <prompt | event | schedule fire>
  end_state / required_facts / minefields / collateral
  graders: <code first; a rubric only where output is short and cites a clause>
  reference: <what Muse did, or what the contract requires>   version_hash
  file: test/evals/p<n>-<slug>/<task>.task.ts

## Properties
<property> | muse: <mechanism> | fletch: <DO | R2 | isolate | egress | alarm | grants | journal> | verdict | proof | status

## Translation
survey: store | tool | route | draw | effect path | seam (file + function) | host constraint (quoted)
mapping: <Muse mechanism → Cloudflare mechanism>, one row per step
deltas: <what differs, why, cost, benefit, who accepted>
one-way doors proposed: <record ids>
not in scope:
fresh-session check: <session, tasks derived, gaps>

## Scorecard
level | must-have tasks passing | evidence (PR, accept line, verifier line) | last verified
```

## Rules per section

**Header.** `Evidence:` names the dump version, every capture id the file cites and the interrogation date. A capture
id is its path under `../evidence/p<n>-<slug>/`, relative to that folder, so a reader on Kyle's Mac opens it and a
reader elsewhere knows what they cannot see.

**Clauses.** One behaviour each, numbered `B-P<n>-<nn>`, one sentence, imperative, verifiable. Every clause cites
its evidence: a `muse.db` row (`<table>:<id>`), a capture (its id), or a quoted line of the system prompt,
`AGENTS.md` or a `SKILL.md`, and carries `tags: [instrumented]`. A clause with only Muse's word behind it carries
`[attested]` instead and is a question, not a rule: it is listed in `../QUESTIONS.md` or re-asked until a row or a
capture backs it. The `over-cautious` and `over-bold` lines name what under-acting and over-acting look like, so a
grader can tell a miss from an overreach. `tasks:` names every task that grades the clause; a clause no task grades is
an open gap and is said so.

**Tasks.** Numbered `T-P<n>-<nn>`, each `must-have` or `nice-to-have` and `tier 1` or `tier 2` (design §3,
"Tiers"). A task names its file: `test/evals/p<n>-<slug>/<task>.task.ts`, which exports `defineTask()`
(`test/support/task.ts`) with the same fields, and a `.test.ts` beside it runs it under vitest; the tier-2 runner
(F19) reads the same `.task.ts`. The `version_hash` written here is the file's `versionHash()` at the time of writing;
a results file is keyed by the hash the runner computes, so a stale hash here is a reading, not a verdict. Graders are
code first; a rubric only where the output is short and the rubric cites a clause by id. `reference` is what Muse did,
with its evidence id, or what the contract requires when fletch should pass a task Muse does not.

**Properties.** One row per property of design §4.3 that the cluster touches (process isolation, filesystem
persistence, vault-at-egress, external-content fencing, approval finality, run idempotency, polling-only background
work, browser as a separate machine): Muse's mechanism, fletch's, the verdict (`stronger`, `weaker`, `different`, with
the argument) and the proof. A property row names its proof: a test file, a check under `scripts/`, or a canary, by
path. A row without a proof is `status: open`.

**Translation.** The seam-first survey of fletch (store, tool, route, draw, effect path, the file and function where
each lands, the host constraint quoted), the mapping from Muse's mechanism to the Cloudflare one per step, the named
deltas with who accepted each, one-way doors as `proposed` records in `docs/decisions/` by id, what is not in scope,
and the fresh-session check: which session derived the task list from the contract alone, what it derived, and every
gap between its list and the task table, each named. The Translate stage ends only when that gap list is empty or
every gap is a task.

**Scorecard.** The cluster's row as it stands, copied to `../SCORECARD.md` by the Lock stage. A level of 2 or more
cites a results file under `../evidence/results/` and a PR (`scripts/check-plan.mjs`, `scorecard-evidence`).

## Citing evidence

Cite, never copy: a clause names a row or a capture by id; it never quotes a message, a page or a model's words
beyond the system-prompt line it followed. Everything under `../evidence/` passed `pnpm redact` first
(`../evidence/README.md`); a contract that needs the content a capture lost is a contract that needs another row.
