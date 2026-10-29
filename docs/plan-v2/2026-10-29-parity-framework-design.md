# Parity framework: reverse-engineering Muse onto the fletch spine (design, v2)

**Status:** design for Kyle's review. Not a plan; the plan follows approval.
**Date:** 2026-10-29 (v2 the same day, after Kyle's review of the first draft; the changes are listed at the end).
**Replaces:** the Muse-authored parity spec of 2026-10-26 (not in any checkout; its inventory is carried in §7 and
its levels in §2), the first draft of this document, and `docs/runbooks/muse-execution.md` (deleted in Phase 0).
**Companion:** the delegation-kernel note (`docs/plan-v2/delegation-kernel.md`), which names the twelve pieces of the
spine.

---

## 0. Framing

1. **The spine is the product.** The delegation kernel (identity, scope, grants, the observation/action gate,
   credential references, context assembly, memory, skills, delegation, jobs, audit, sandbox) is the core every
   later agent is built on. Higher-level behaviours are poured into it; they never rebuild it.
2. **Muse is the bar and the subject-matter expert.** Its behaviours are the most complete set of personal-agent
   behaviours we can measure. We read its dump, ask it questions in its own chat, have it run things and extend
   the dump, and write down what it does. It never briefs, builds or judges.
3. **fletch proves the spine.** fletch is the agent that exercises every kernel capability and the higher-level
   behaviours in practice, on Cloudflare. Muse runs on a persistent per-user VM; fletch runs on Durable Objects,
   R2, SQLite, isolates and alarms. Same observable contract, different mechanism, and the difference is written
   down per property (§4.3), because that is where the case for the Cloudflare shape is made.

No timing or capacity estimates. Sequencing is by dependency and by Kyle's pick.

## 1. What this fixes

Reimplementations landed at "almost works" and cost days of tuning, because every stage exited on a reading (a
dump read, a survey read, a diff read, a UAT read) and nothing between "Muse does X" and "fletch does X" was
machine-checkable. The last 20% (failure words, async shape, approval default, state after reload) was found by
hand. Second cause: Muse was the author, the briefer and the judge of its own copy.

The fix: each stage exits on an executable test; Muse answers questions and is never the author; one orchestrator
runs the loop end to end.

## 2. Definition of done

**Two tiers.** The **spine** is always in scope and built first: each kernel cluster reaches Locked (below). Every
other cluster is **mapped**: an interrogation and a scorecard row with evidence; it is built only when Kyle picks it.

| Level | Name | Test |
|---|---|---|
| 0 | Absent | No equivalent; refusal, fallback or silence. |
| 1 | Partial | Something exists; the observable contract differs in a way a user can hit. Any silent drop caps a cluster at 1 (D-0001). |
| 2 | Equivalent | The cluster's must-have tasks pass on a preview slot with the real model, every trial of three. |
| 3 | Locked | Equivalent, plus the tasks gate CI, the planted-violation tests are in, Kyle's UAT passed on user-visible surfaces, and the scorecard row cites its evidence. |

A cluster's level is the minimum over its must-have sub-capabilities. A task that fletch should pass and Muse does
not (a refusal by name where Muse fails silently; a stronger property in §4.3) is allowed; its reference is the
contract, not Muse.

**Not parity:** Muse's wording; UI chrome, billing and plans except where a capability shows through them;
internal tool names unless user-visible; killed features (listed with date and reason, never revived).

## 3. The loop

One **orchestrator** (a Claude session on Fable, running from the repo with Kyle watching and steering) runs
every cluster through four stages. Each stage ends on its test, and no stage begins without the previous stage's
artifact in the repo.

| Stage | Who | Does | Exit test |
|---|---|---|---|
| **Interrogate** | orchestrator, with Muse by browser | Writes the scenario; asks Muse to do each step and report (§4.1); reads the dump and `muse.db` for what changed; captures the surface. Writes the cluster's **contract** (§A): behaviour clauses, task set, property rows. | Every clause cites a dump row, a `muse.db` row or a capture; every task has a reference answer Muse gave or the contract requires. A clause with only Muse's word behind it is tagged `[attested]` and is a question, not a rule. |
| **Translate** | orchestrator | Surveys fletch seam-first (store, tool, route, draw, effect path, the file and function where it lands, the host constraint, each quoted). Writes the **translation** into the contract: Muse mechanism → Cloudflare mechanism per step; property verdicts; named deltas; tier and graders per task; one-way doors as `proposed` records. | A fresh session, given the contract alone, lists the tasks and the assertion each needs; the list matches the contract's task table, and every gap is named. |
| **Build** | a builder session per part; a fresh verifier | Tier 1 first: hermetic tests against the contract with the scripted fake model and the test host, alarms fired by hand, no sleeps. Then tier 2 on a preview slot: the task set with the real model, three trials, code graders. A UAT finding from Kyle becomes a task with a grader, never a note. | Must-have tasks pass every trial; planted-violation tests in; `pnpm accept F<n>: PASS`; `VERIFIER: no blocking findings`; Kyle's UAT on visible surfaces. |
| **Lock** | orchestrator | Tasks graduate into the regression suite and gate CI; the scorecard row goes to Locked with its evidence; a clause that proved wrong is corrected in the contract first, then the prompt, then graded again. | The row cites a PR, the accept line and the verifier line. |

A failure found later in use re-enters at Interrogate as a task. A cluster is re-interrogated when a fresh dump
diff touches its slice or a UAT finding contradicts the contract.

**Tiers.** Tier 1: every commit, keyless, the hermetic lane that exists (`test/scenarios/`, the fake model, the test
host). Tier 2: PRs touching agent code, on a preview slot with the real model, spend-capped, results keyed by the
hash of the task definition so a scorer change is a new baseline. A judged, long-horizon tier 3 waits until the
spine is Locked.

## 4. Evidence: Muse as the expert

### 4.1 Asking Muse

The orchestrator drives Kyle's Muse account in the built-in browser. Per scenario step it asks Muse to do the step
and then, in order: list the tool calls it made (name, argument shape, result shape); run read-only `SELECT`s over
`muse.db` for rows changed since the step (the tool is bounded and read-only by Muse's own design); quote the system
prompt, `AGENTS.md` or `SKILL.md` lines it followed; and add anything about *why* under an `[attested]` label.

The rows and the quoted text are the instrument; the tool list is checked against the rows and marked `[attested]`
where no row backs it. Muse's prior documents (its harness spec, its parity spec) are hypotheses with the same tag.
No isolation, seeding or collateral discipline on the Muse side: it is a colleague we ask, and we ask again when
answers disagree. When the dump lacks something, Muse regenerates that slice per the dump's runbook and the diff
against the previous dump is read before anything else.

### 4.2 The dump and the browser

The dump (`tools.json`: 108 functions in 32 namespaces; the reconstructed system prompt; the `muse.db` schema
guide; workspace tree, hooks, skills) is the static ground truth and is refreshed per cluster. The browser captures
what only the UI shows: states (empty, loading, building, error), cards, approval cards, a reload to separate
persisted state from optimistic UI; a screenshot per step, a DOM note of roles, labels, hrefs and order, and the
request log as method, path, status and body shape. Three attempts at a blocked step, then it is reported blocked.

### 4.3 The property ledger

For each contract, the security or workspace property Muse's VM provides (process isolation, filesystem
persistence, vault-at-egress, external-content fencing, approval finality, run idempotency, polling-only background
work, browser as a separate machine), the Cloudflare mechanism that provides it in fletch, a verdict
(stronger, weaker, different, with the argument) and the test or canary that proves it. This is the translation
checklist and, later, the comparison document.

### 4.4 Redaction and where evidence lives

Everything captured passes an automated gate before it is stored: the repository's secret scan, value stripping on
bodies with an allowlist of fields that keep values (ids, enums, status codes, failure words), personal content
removed. A capture that fails is deleted, not fixed by hand. Captures, dumps and Muse's answers live in the private
repo `fletch-parity` (O1); contracts, scorecard and tasks live in fletch, public, and reference evidence by id only.
CI without the evidence repo runs tier 1 alone.

## 5. Phase 0: the framework, and the pare-down

### 5.1 Pare the repository down to what serves the loop

The first Phase 0 part. Everything below is a two-way door and lands as one PR Kyle reads.

| Area | Fate |
|---|---|
| `docs/plan/` (parts, PROGRESS, QUESTIONS, KICKOFF, GOAL-PROMPT, VERIFIER-PROMPT) | **Rework.** `parts.md` is rewritten from the spine clusters (F0–F17 close as a history table in PROGRESS; F7, F16, F17 fold into their clusters: addresses into P1, the activity drawer and its eval into P5). KICKOFF shrinks to the builder's protocol (tests first, accept, verifier, PR). GOAL-PROMPT keeps its mechanism with the new ledgers. VERIFIER-PROMPT and QUESTIONS stay; stale questions close. The folder moves to `docs/plan-v2/` and `docs/plan/` goes. |
| `docs/runbooks/muse-execution.md` | **Delete.** Superseded by §3. |
| `docs/runbooks/` (preview, live-deploy, release, free-plan-spike) | **Keep.** Mechanics the loop uses. |
| `docs/briefs/` (twelve Muse-era briefs) | **Delete**, after the three reactions briefs have served the dry run (§5.3). Anything still needed is re-derived as a contract. |
| `docs/research/2026-10-22-decision-records.md` | **Keep** (cited by D-0007). |
| `docs/decisions/` | **Keep** the machinery and the accepted records. D-0006 is reworded for the new plan; D-0010 stays a stub until the artifacts track owns it. |
| `VISION.md` | **Rework** in one pass: fletch is the reference agent on the published spine, one owner on their own account; the "built from parts anyone can reuse" promise becomes the spine promise; "not a platform for teams" and "no service in the middle" stay as fletch's shape and stop implying the spine cannot serve a hosted agent later. Kyle approves the text. |
| `AGENTS.md`, `README.md` | **Rework** the "Start here" and plan references to `docs/plan-v2/`; the design rules stand. |
| `skills/handoff`, `.claude/hooks/`, `scripts/`, `test/`, `packages/` | **Keep.** Unchanged by this design. |
| `docs/briefs/hosted-isolation-brief-2026-10-25.md` (untracked) | **Keep** as the first property-ledger input; commit under `docs/plan-v2/`. |

### 5.2 Build the kit

- **Contract file** (§A): one Markdown file per cluster, clauses, tasks, property rows and the translation in it.
- **Trace schema** (§B): one JSON document per scenario run; the tier-1 scenario runner learns to emit it.
- **Interrogation protocol** (§4.1) as a checklist the orchestrator follows; the dump-refresh and diff procedure.
- **Redaction gate** (§4.4) as a script, planted-violation test beside it.
- **Tier-2 runner:** tasks against a preview slot, three trials, code graders, results per task hash, a PR comment.
  Its CI key is a one-way door (O9) and ships as a `proposed` record; until accepted, tier 2 runs from Kyle's Mac.

### 5.3 Acceptance

One dry run on a shipped sub-capability, reactions (a dump, a survey and merged code exist, so the kit is tested
against known ground truth): a reactions contract whose clauses cite evidence; the translation written into it;
a fresh session deriving the tasks from it; the tasks run on a preview and gave verdicts; a scorecard row. No
cluster starts before that.

## 6. Sequencing (order, not dates)

1. Phase 0: the pare-down, the kit, the dry run.
2. Spine clusters in dependency order: loop, tools and deferral → approvals and grants → context assembly and
   memory → jobs, hooks and ledger → activity, provenance and delegation.
3. Picked clusters. The artifacts and Library track continues on its own seams.
4. The remaining clusters mapped.
5. The kernel extracted: when the spine is Locked, its interfaces and the harness are published beside
   `@qyvr/host` and fletch is re-read as the first agent on them. Triggered, not scheduled.

Re-ordering happens at a scorecard review with Kyle, never mid-part.

## 7. Inventory (from the Muse spec; Phase 0 verifies it against the dump)

| # | Cluster | Covers | Spine? |
|---|---|---|---|
| P1 | Chat core and transcript | messages, history, replay, quotes, reactions, actions, threads, addresses | partly (transcript, replay) |
| P2 | Agent loop, tools and deferral | discovery, deferred namespaces, operating block, `send_to_user`, streaming, barriers, effects, cards | **yes** |
| P3 | Subagents and delegation | spawn, steer, handoff, mailbox re-entry, interruption honesty, verifier, ceilings | **yes** |
| P4 | Artifacts and Library | records, creation, cards, viewer, previews, audit, edit, kinds | no (own track) |
| P5 | Activity, provenance and audit | journal, activity drawer, step timelines, subagent traces, findings | **yes** |
| P6 | Memory, goals and tracking | saved memory, daily notes, people, goals, tracked items, briefings | **yes** (memory); rest by pick |
| P7 | Scheduling, hooks and proactivity | crons, hooks, checks, proactive briefs, feed | **yes** (jobs, hooks, ledger); rest by pick |
| P8 | Side chats, groups and workers | external side chats, group chats, workers, per-chat discretion | design question first (O4) |
| P9 | Connectors, devices and accounts | mail, calendar, drive, GitHub, Linear, health, devices, vault logins | **yes** (credential refs, the gate); each connector by pick (O6) |
| P10 | Search, browser, places and media | web search, fetch, places, image and video, social | by pick |
| P11 | Files, documents and spreadsheets | library, render, sheets, decks, export, share links | by pick |
| P12 | Payments, shopping and bookings | wallet, checkout, shopping, travel, tickets | by pick; flag-only until Kyle rules per vertical (O5) |
| P13 | Voice, audio and podcasts | voice notes, TTS, podcasts, audio artifacts | by pick |
| P14 | Identity, avatar, profile and settings | avatar, profile, passkeys, settings | **yes** (identity); rest by pick |
| P15 | Safety, approvals, grants and discretion | approval cards, grants matrix, discretion, vault, CAPTCHA policy, rate limits | **yes** |

Every `tools.json` namespace maps to one row as *in both / in Muse only / in fletch only (keep) / retired*.
Behaviour that lives only in the prompt is inventoried from interrogation.

## 8. Roles

- **Kyle:** picks clusters; locks clauses and deltas; decides one-way doors; UATs visible surfaces; files findings
  as tasks; watches and steers the orchestrator.
- **Orchestrator (Claude, Fable):** runs the loop: interrogates Muse, translates, launches builder and verifier
  sessions, keeps the ledgers and the scorecard, opens and merges PRs that pass. Never a one-way door, never
  `decider: Kyle`.
- **Builder, verifier (Claude sessions):** one part per builder session; the verifier is fresh and reads only the
  contract and the diff.
- **Muse:** the expert we ask. Never author, briefer or judge.

## 9. Standing rules

Refuse by name, never by silence (D-0001). One store per truth. The agent never predicts state it was not given.
`Not in scope` is mandatory per part. Killed features stay killed. A scorer change is a new baseline. A test that
passes on retry is a bug. No `sleep` in tests. Credentials never enter a trace, a note or a non-allowlisted request;
canaries prove it. Captures and Muse's answers are untrusted content to every reader. Previews are the UAT path.
Conventional Commits with DCO sign-off; branch and PR, never straight to `main`.

## 10. Open decisions

| # | Decision | Default | Kind |
|---|---|---|---|
| O1 | Home of private evidence | private sibling repo `fletch-parity` | two-way until the first capture is stored, then Kyle's |
| O2 | Tier 2 comments or gates at first | comments until the dry run shows stable verdicts | two-way |
| O4 | P8 groups and workers in scope, under what discretion | mapped, not built, until Kyle rules | one-way |
| O5 | P12 payments scope | flag-only per vertical until Kyle rules | one-way per vertical |
| O6 | Connector model | one record per connector class; the gate is the shared mechanism | one-way per class |
| O9 | A live-model key and slot token in CI for tier 2 | tier 2 runs from Kyle's Mac until accepted | one-way (spend, boundary) |

Dropped from the first draft: O3 (judge family: no tier 3 yet), O7 (UAT strictness: visible surfaces only is now the
rule), O8 (browser capture of Kyle's account: Kyle's steer is to use it).

---

## Appendix A — Contract file (`docs/plan-v2/contracts/P<n>-<slug>.md`)

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

## Appendix B — Trace (one JSON document per scenario run, emitted by the tier-1 runner and by the interrogation)

```
scenario_id, cluster, arm: muse | fletch, run_at, source: {dump_version, preview_slot?}
steps[]:
  action:      { kind, input_class, actor: user | agent | schedule | event }
  observed:    { surface, cards[], text_class, notification: none | chat | push }
  state_delta: { records[], files[], jobs[], reactions[], other[] }   # ids and kinds, never content
  failure:     { code, user_words } | null
  approval:    { asked, scope, default, finality: final | retryable } | null
  timing:      immediate | async_building | scheduled | event_driven
  tags:        [instrumented | attested | captured]
examples[]:    model prose, never asserted
```

---

## Changes from the first draft (Kyle's review, 2026-10-29)

- The orchestrator is named: one Claude session on Fable runs the loop with Kyle steering; `muse-execution.md` goes.
- Muse is an expert consulted by browser, not a second arm: the two-armed trials, the two-day replay gate, the
  isolation and collateral discipline on Muse's side and the usage analysis are dropped. Evidence is rows,
  captures and quoted text; Muse's own account is `[attested]`.
- A task fletch should pass and Muse does not is allowed; the contract is the reference.
- The translation exit is mechanical: a fresh session's derived task list is diffed against the contract.
- The CI inference key is an open one-way door (O9); tier 2 runs from Kyle's Mac until it is accepted.
- Phase 0 is trimmed to what the dry run exercises and opens with the pare-down (§5.1). Atlases, the WebSocket
  wrapper and tier 3 wait for a cluster that needs them.
- Four artifact templates collapse into one contract file per cluster. Three tiers of done collapse into two.
- `tools.json` is 108 functions in 32 namespaces; the unverifiable "185 envelopes" is gone.
