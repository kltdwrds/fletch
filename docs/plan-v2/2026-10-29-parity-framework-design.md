# Parity framework: reverse-engineering Muse onto the fletch core (design)

**Status:** design spec for Kyle's review. Not a plan; the plan follows approval.
**Date:** 2026-10-29.
**Supersedes, as process:** the Muse-authored master parity spec of 2026-10-26. Its inventory (§8 here), parity levels, translation principles and anti-patterns are carried over; its evidence model and execution topology are replaced.
**Companion:** the delegation-kernel note in the qyvr project (`claude/delegation-kernel.md`), which defines the spine this spec builds to.

---

## 0. Framing

Three sentences that every later decision answers to:

1. **The spine is the product.** The delegation kernel (identity, scope, grants, observation/action gate, credential references, context assembly, memory, skills, delegation, jobs, audit, sandbox) is the core any offspring agent is forked from. Teams pour domain tasks and behaviours into it; they do not rebuild it.
2. **Muse parity is the north star, not the deliverable.** The behaviours and tasks Muse can perform are the bar the spine is held to, because they are the most complete set of personal-agent behaviours we can measure. Full parity is documented as a map; the spine and the clusters Kyle picks are what get built.
3. **fletch is the first offspring.** It is the qyvr flagship: the same core, with the qyvr content-network tasks and behaviours poured in.

Corollary for the architecture: Muse runs on a persistent per-user VM; fletch runs on Durable Objects, R2/SQLite, isolates and alarms. Same observable contracts, different mechanisms, different security arguments. The difference is a first-class input (the property ledger, §4.5), not a caveat, and it is where the eventual cost/deploy/blast-radius case against VM-shaped agents is made.

No timing or capacity estimates appear in this document or its plan. Sequencing is by dependency and by Kyle's pick.

---

## 1. The problem this framework fixes

fletch's reimplementations have landed at "almost works" and cost days of double-click tuning. Root cause, stated as a design claim: every stage of the previous loop exited on a *reading* (a dump read, a survey read, a diff read, a UAT read). Nothing between "Muse does X" and "fletch does X" was machine-checkable, so the last 20% — failure words, async timing shape, approval default, state after reload — was discovered by hand.

Second cause: the oracle was the subject. Muse introspecting itself produced the dumps, briefed the builds, and judged the results. The one leg that could have corrected it (the live app) was blocked.

The framework gives each stage an executable exit criterion and makes Muse an instrument and a baseline arm instead of an author.

---

## 2. Definition of done

### 2.1 Three tiers, documented together, executed in order

| Tier | Meaning | Done when |
|---|---|---|
| **Spine** | The kernel clusters: loop/tools/deferral, approvals and grants, context assembly and memory, jobs/hooks/ledger, activity/provenance and delegation | Each is at Level 3 (§2.2) with its property-ledger rows verified. Always in scope; built first. |
| **Daily-use replacement** | Clusters Kyle picks from the inventory (§8), informed by the usage analysis (§4.6) | Picked clusters at Level 3. Kyle can do a normal day in fletch without opening Muse for those clusters. |
| **Full-clone map** | Every remaining cluster | At least an interrogation (M.1) and a scorecard row with evidence; out-of-scope rows carry reason and date. Nothing built unless picked. |

### 2.2 Parity levels (carried from the Muse spec, with executable tests added)

| Level | Name | Test |
|---|---|---|
| 0 | Absent | No equivalent; refusal, fallback or silence. |
| 1 | Partial | Something exists; the observable contract differs in a way a user can hit. **Any silent drop caps a cluster at 1.** |
| 2 | Equivalent | The cluster's task set passes two-armed (§5.3) at the threshold set in its translation record, on a preview. |
| 3 | Locked | Level 2 **plus** the tasks are in the regression suite and gate CI, **plus** planted-violation tests, **plus** Kyle's UAT on user-visible surfaces, **plus** the scorecard row cites its evidence. |

A cluster's score is the minimum over its must-have sub-capabilities.

### 2.3 Not parity

Muse's voice and wording; UI chrome, billing and plans except where a capability surfaces through them; internal tool names unless user-visible; killed features (listed with date and reason, never revived); anything whose contract cannot be reproduced against the oracle (§4.4).

---

## 3. The three stages and their exit tests

| Stage | Input | Exit artifact | Executable exit test |
|---|---|---|---|
| **RE** | Muse under instruction (§4.1), refreshed dump (§4.2), browser capture (§4.3) | a **contract**: scenario script + golden trace (§A) + behaviour clauses (§D) + task set (§E) + property-ledger rows (§F) | the scenario replays against Muse on a second day and reproduces its own golden trace; every task has a reference solution that passes against Muse |
| **Translation** | the contract + fletch survey (seam-first) + the CF constraint set | a **translation record** (§C): Muse mechanism → CF mechanism, property preserved, named deltas, tier per task, one-way doors proposed | a fresh reviewer, given the record alone, derives the fletch acceptance tests; if they cannot, the record is ambiguous |
| **Reimplementation** | the translation record | code + the same scenario in `test/scenarios/` + task results | the task set passes two-armed in CI at the record's threshold (pass^k, §5.3), planted-violation tests pass, `pnpm accept` PASS, Kyle UAT on visible surfaces |

A capability cannot advance a stage on a judgment.

---

## 4. Evidence pipeline: Muse as the instrument

Three channels, weighted in this order. All feed one trace format (§A) and pass one redaction gate (§4.7) before anything is stored.

### 4.1 Muse under instruction (primary)

The unit is the **pointed interrogation**: a scenario run inside Muse's own chat in which Muse is asked to *do* the thing and report what it executed. Each step asks for four measurements and no recollections:

1. **Perform** the step now.
2. **List the tool calls** made this turn: names, argument shapes, result shapes. (The tool runtime shows Muse these; it is a reading.)
3. **Query state:** read-only `SELECT`s over `muse.db` for rows changed since the step's timestamp — records, files, jobs, run ledger, handoffs, mailbox.
4. **Quote the governing text:** the system-prompt lines, `AGENTS.md` lesson, or `SKILL.md` section it followed.

Answers to 1–4 are tagged **[instrumented]**. Anything Muse adds about *why* is tagged **[attested]** and treated as a hypothesis to test. Workspace structure (`~`, standing files, `~/memory`, `~/hooks`, cron bodies, skills registry) is captured the same way, by having Muse list and print it, redacted.

Muse's own prior documents (its harness spec, its parity spec) are read as hypotheses with the same tag. They never enter a contract directly.

### 4.2 The dump, refreshed per milestone

Static ground truth: `tools.json` (108 functions, 19 namespaces), the reconstructed system prompt, the `muse.db` schema (185 envelopes), workspace tree, hooks, skills. Each milestone opens with a fresh dump of its cluster's slice (Muse can regenerate it per the existing runbook) and a diff against the previous one. That diff is the re-dump trigger made mechanical.

### 4.3 Browser capture (scoped)

Built-in browser against Kyle's signed-in account, for what only the UI shows: surfaces, states (empty, loading, building, error), cards, viewers, drawers, approval cards as rendered; API and WebSocket frame shapes where frontend parity needs them. Per scripted step: screenshot at desktop width and, where the surface differs, phone width; a DOM note scoped to roles, labels, hrefs and order; network log as method, path, status and body *shape*; WebSocket frames via an injected wrapper that logs frame shapes; a reload-and-re-read to separate persisted state from optimistic UI. Blocked steps (bot wall, passkey-only, policy page) are reported blocked after three attempts, never retried endlessly.

### 4.4 Golden traces and replay

A trace is golden only after the scenario runs against Muse on two different days and the contract fields (§A) match. Differences are classified: model-text variance (ignored by design; prose is stored as example, never asserted), contract variance (the script is under-specified; fix it), or genuine non-determinism (recorded as a tolerance). A contract that cannot be reproduced is not a target.

### 4.5 Atlases and the property ledger

Generated from captures and the dump by checked-in generators; never hand-typed.

- **Agent contract atlas:** tools mapped to clusters; prompt rules decomposed into clauses with cluster tags; `muse.db` schema as an entity/relationship model; workspace layout; scheduler and hook semantics; skills registry.
- **Property ledger (§F):** for each contract, the security or workspace property Muse's VM shape provides (process isolation, filesystem persistence, vault-at-egress, external-content fencing, approval finality, run idempotency, polling-only background work, browser as a separate machine), the CF mechanism that provides it in fletch, and whether the guarantee is stronger, weaker or differently shaped. This is the engineering checklist for translation and, later, the comparison document.
- **Surface atlas:** routes, screens and states.
- **API atlas:** only where frontend parity needs it.

### 4.6 Usage analysis

A script over the `muse.db` chat, run and job envelopes producing per-cluster frequency and recency. It informs Kyle's pick from the inventory; it does not make the pick.

### 4.7 Redaction gate

Modeled on the dump's existing redaction manifest: secret-pattern scan; value stripping on bodies with an allowlist of fields that may keep values (ids, enums, status codes, failure words); personal content removed. A capture that fails redaction is deleted, not fixed by hand. The gate runs before any write to `fletch-parity`.

---

## 5. The per-milestone loop

After Phase 0 (§6), every milestone is one cluster or sub-cluster Kyle picks. Four phases; each exits on its test.

### 5.1 M.1 Interrogate (RE)

Write the scenario script from the inventory row. Run the pointed interrogation (§4.1) and browser capture (§4.3). From the golden traces write, each item citing trace steps:

- the cluster's **behaviour clauses** (§D): short, with IDs, each with its paired failure modes (over-cautious / over-bold);
- the **task set** (§E): tasks drawn from the traces and from Kyle's real Muse failures, each with end-state checks, required facts, minefields and collateral-damage checks, and a reference solution;
- the cluster's **property-ledger rows** (§F).

Exit: traces replay (§4.4); every task's reference solution passes against Muse. Muse is the baseline arm: a task Muse cannot pass is a broken task.

### 5.2 M.2 Translate

Fletch survey, seam-first: store, tool, route, draw, effect/card path, bones that already match, the one file + function where the behaviour lands, and the host/plan constraint that bounds it, each quoted not paraphrased. Then the **translation record** (§C): mechanism mapping, property preserved per the ledger, named deltas with cost/benefit, tier per task (§5.3), graders per task (code-first; a judge only where output is short and the rubric cites a clause), threshold, and one-way doors proposed for Kyle (`proposed`, never `decider: Kyle` written by the agent).

Exit: a fresh reviewer session derives the acceptance tests from the record alone.

### 5.3 M.3 Implement against the evals

Tier 1 first: hermetic tests against the contract using fletch's scripted fake model and test host, with backdated job rows and explicit alarm firing for anything scheduled; no sleeps. Then the tier-2 loop on a preview slot:

- the task set runs **two-armed** — Muse's golden result and fletch's run — through the same graders;
- infrastructure failures are separated from agent failures;
- N trials per task; must-haves are measured as pass^k (all k trials pass), not pass@k;
- the verdict per task is `improved / regressed / unchanged / inconclusive`; results are keyed by a hash of the task definition so a scorer change is a new baseline, never a moved goalpost.

Kyle's steer lands here, and only in one form: **a UAT finding becomes a task with a grader**, never a prose note. The next iteration is measured against it. Tier 3 (live, judged, long-horizon) produces a report, not a gate.

Exit: must-have tasks at the record's pass^k threshold; planted-violation tests in (a test that fails if the defect the part fixes is reintroduced); `pnpm accept F<n>: PASS` plus the independent verifier; Kyle UAT on visible surfaces.

### 5.4 M.4 Lock and learn

Passing tasks graduate into the regression suite and gate CI. Scorecard row to Level 3 with evidence cited. Property-ledger rows marked verified. Behaviour clauses that proved wrong are corrected in the spec, never patched around in the prompt. Failures found later in use re-enter at M.1 as tasks. Re-interrogate when the dump diff shows the cluster's slice changed, when a UAT finding contradicts the trace, or when a capture shows a surface the trace never described.

### 5.5 Tiers

| Tier | Runs | Model | Purpose |
|---|---|---|---|
| 1 | every commit, keyless | scripted fake | transport, retry, streaming, compaction, scheduling, storage, grants engine, journal |
| 2 | PRs touching agent code; maintainer-only; spend-capped | live via AI Gateway with an eval-tagged key, egress otherwise denied | task sets, two-armed, trials, verdicts |
| 3 | nightly or on `main` | live, pinned judge, cost cap | simulated user, long-horizon memory, proactive triggers, injection; report artefact |

---

## 6. Phase 0: the framework build

### 6.1 Components

| Layer | Components | Status |
|---|---|---|
| Interrogation kit | built-in-browser capture kit; interrogation protocol templates; dump-refresh procedure with diff; redaction gate; contract-trace schema (§A); replay check; atlas generators; usage-analysis script | new, in `fletch-parity` |
| Translation kit | survey template; translation-record template (§C) with ledger rows (§F) and delta register; tier and grader assignment; fresh-reviewer check | templates new; decision-record machinery exists (`docs/decisions/`, `scripts/check-decisions.mjs`) |
| Outer harness | tier 1: fletch's hermetic lane (`test/scenarios/`, scripted fake model, test host) extended to emit contract traces; tier 2: task runner against preview slots, graders library, two-arm comparison, results keyed by task hash; tier 3: live judged runs; behaviour-spec format (§D); scorecard (§G) | tier 1 mostly exists; the rest new |

### 6.2 Where things live: the core/domain split made physical

- **Core (public, forkable):** kernel packages and the outer-harness framework — runner, graders, comparison, trace schema, behaviour-spec format, scorecard tooling. In fletch now; published alongside `@qyvr/host` when the kernel is extracted (§7, step 5; consistent with qyvr B10). A fork inherits the suite and adds domain tasks.
- **Domain (public, fletch):** fletch's behaviour clauses, task sets, skills, connectors and surface — the qyvr content-network agent. Scenario files reference golden traces by id only.
- **Evidence (private, `fletch-parity`):** golden traces, captures, dumps, atlases, usage analysis, anything derived from Kyle's account. Never imported by code. The comparison runner reads it at eval time through a configured path or token; CI without it runs tier 1 only.
- **Design docs:** this spec and its successors in `fletch/docs/plan-v2/` (the privacy scan carves this path out for dump references). The delegation-kernel note stays in the qyvr project and is cited as the spine's definition.

### 6.3 Phase 0 acceptance

One end-to-end dry run of the full loop on a deliberately small, already-shipped sub-capability (reactions: a dump, a survey and merged code exist, so the framework is tested against known ground truth). Phase 0 is done when that sub-capability has: a golden trace that replays; a translation record a fresh reviewer derived tests from; a task set that ran two-armed on a preview and produced verdicts; a scorecard row with evidence. No cluster milestone starts before that.

---

## 7. Sequencing (order, not dates)

1. **Phase 0** — framework, proven on the dry run.
2. **Spine milestones**, in dependency order: loop/tools/deferral → approvals and grants → context assembly and memory → jobs, hooks and ledger → activity/provenance and delegation. Each is a kernel piece with Muse's behaviour as the bar and the property ledger as the security translation.
3. **Picked milestones** from the inventory, informed by the usage analysis. The artifacts/Library track continues in parallel on its own seams.
4. **Full-clone documentation** — every remaining cluster gets an M.1 interrogation and a scorecard row.
5. **Kernel extraction** — when the spine milestones are at Level 3, the kernel interfaces and the harness framework are published as the core and fletch is re-read as its first fork. Triggered, not scheduled.

Re-ordering happens at a scorecard review with Kyle's call, never mid-part.

---

## 8. Inventory (carried from the Muse spec; Phase 0 verifies, it does not score from memory)

| # | Cluster | Covers | Spine? |
|---|---|---|---|
| P1 | Chat core & transcript | messages, history, replay, quotes, reactions, message actions, threads, side chats as surface | partly (transcript, replay) |
| P2 | Agent loop, tools & deferral | tool discovery, deferred namespaces, operating block, `send_to_user`, streaming, barriers, effect buffer, cards | **yes** |
| P3 | Subagents & delegation | spawn, steer, handoff, mailbox re-entry, interruption honesty, verifier, depth/token ceilings | **yes** |
| P4 | Artifacts & Library | records, creation, cards, viewer, previews, audit, edit, data, kinds | no (own track) |
| P5 | Activity, provenance & audit | journal, activity drawer, step timelines, subagent traces, audit findings | **yes** |
| P6 | Memory, goals & tracking | saved memory, daily notes, people/groups, goals, tracked items, briefings | **yes** (memory); goals/tracking by pick |
| P7 | Scheduling, hooks & proactivity | crons, hooks, scheduled checks, proactive briefs, feed units | **yes** (jobs/hooks/ledger); feed/briefs by pick |
| P8 | Side chats, groups & workers | external side chats, group chats, worker agents, per-chat discretion | design question before build |
| P9 | Connectors, devices & accounts | mail, calendar, drive, GitHub, Linear, health, paired devices, vault logins | **yes** (vault/credential refs, observation/action gate); each connector by pick and one-way decision |
| P10 | Search, browser, places & media | web search, page fetch, places, image/video, social search | by pick |
| P11 | Files, documents & spreadsheets | file library, render, spreadsheets, decks, export, share links | by pick |
| P12 | Payments, shopping & bookings | wallet, checkout, shopping, flights, hotels, tickets | by pick; flag-only vs purchase per vertical is Kyle's |
| P13 | Voice, audio & podcasts | voice notes, TTS, podcast generation, audio artifacts | by pick |
| P14 | Identity, avatar, profile & settings | avatar, profile, passkeys, settings | **yes** (identity, via crest); avatar/settings by pick |
| P15 | Safety, approvals, grants & discretion | approval cards, grants matrix, per-chat discretion, secure vault, CAPTCHA policy, rate limits | **yes** |

Phase 0 may split or merge clusters when evidence says so. `tools.json` is the cross-check: every namespace maps to a cluster as *in Muse and fletch / in Muse not fletch / in fletch not Muse (keep) / retired (do not build)*. Capabilities that exist only in prompt or operated behaviour are inventoried from interrogation, not from the tool list.

---

## 9. Roles

- **Kyle:** picks clusters; locks behaviour clauses and deltas; decides one-way doors (irreversible, money, security boundary, published contract, storage schema); UATs user-visible surfaces; steers M.3 by filing findings as tasks.
- **Claude:** everything else, with role separation enforced by separate sessions: *interrogator* (M.1), *translator* (M.2), *builder* (M.3), *verifier* (fresh; reads only the record and the diff). Sessions are launched goal-first from the repo with the stage's templates as context; no stage begins without the previous stage's artifact.
- **Muse:** instrument and baseline arm. Never author, briefer or execution owner. Its documents are hypotheses.

---

## 10. Operating rules (standing; not re-derived per part)

Refuse by name, never by silence (D-0001). One store per truth. The agent never predicts state it was not given. `Not in scope` is mandatory per part. Killed features stay killed. Parallel sessions only on disjoint seams; check for duplicate PRs before review. A scorer change is a new baseline. FLAKY is a bug; pass-on-retry is reported, not accepted. No `sleep` in tests; own the store or the alarm, never the clock. Credentials never enter a trace, a memory note or a non-allowlisted request; canaries are planted to prove it. Trajectories and captures are untrusted content to every reviewer. Previews are the UAT path; `--deploy-only` for staging redeploys. Conventional Commits with DCO sign-off; branch + PR, never straight to `main`.

---

## 11. Open decisions

| # | Decision | Default in this spec | Kind |
|---|---|---|---|
| O1 | Home of private evidence | private sibling repo `fletch-parity` | two-way until the first golden trace is stored; then storage, Kyle's |
| O2 | Tier 2 gates merges or comments only, at first | comments until Phase 0's dry run shows stable verdicts, then gates | two-way |
| O3 | Judge family beside Claude for tier 3 | a Workers AI model as the cheap cross-family check | two-way |
| O4 | P8 groups/workers in scope at all, and under what discretion | interrogated and documented; not built until Kyle rules | one-way (product shape) |
| O5 | P12 payments scope | flag-only until a per-vertical ruling | one-way per vertical |
| O6 | Connector model | per-connector one-way decision, with the observation/action gate as the shared mechanism | one-way per connector class |
| O7 | Strictness of Level 3 UAT | Kyle's UAT required for user-visible surfaces only; verifier + preview run suffice for store/tool/audit parts | two-way |
| O8 | Capturing the client bundle and API traffic from Kyle's account | Kyle's call, made knowingly; the spec does not require the bundle for the spine | Kyle's |

---

## Appendix A — Contract trace schema

One JSON document per scenario run; the fletch scenario runner emits the same shape so the diff is mechanical.

```
trace:
  scenario_id, cluster, arm: muse | fletch, run_at, source: {dump_version, preview_slot?}
  steps[]:
    action:      { kind, input_class, actor: user | agent | schedule | event }
    observed:    { surface, cards[], text_class, notification: none | chat | push }
    state_delta: { records[], files[], jobs[], reactions[], other[] }   # ids and kinds, never content
    failure:     { code, user_words } | null
    approval:    { asked: bool, scope, default, finality: final | retryable } | null
    timing:      immediate | async_building | scheduled | event_driven
    provenance:  { record_kind, inspectable_at }
    tags:        [instrumented | attested | captured | verify]
    tolerance?:  { field, kind }                                           # recorded non-determinism
```

Model prose is stored under `examples[]`, never in an asserted field.

## Appendix B — Pointed-interrogation protocol (per step)

1. "Do the following now: <step>."
2. "List every tool call you made this turn: tool name, argument shape, result shape. Do not describe intent."
3. "Run read-only SELECTs over your database for rows changed since <timestamp> in <tables>; return rows with content fields replaced by their type."
4. "Quote the exact lines of your system prompt, AGENTS.md or the SKILL.md you followed for this step."
5. "Anything you want to add about why: label it [attested]."

Record 1–4 as [instrumented]; 5 as [attested]. Repeat the full scenario on a second day before marking golden.

## Appendix C — Translation record template

```
Cluster / sub-capability:
Contract (trace ids):
Fletch survey: store | tool | route | draw | effect path | bones that match | seam (file + function) | host/plan constraint (quoted)
Mechanism mapping: Muse mechanism → CF mechanism, one row per contract step
Property ledger rows (Appendix F) touched, with verdict: stronger | weaker | different
Deltas: what will observably differ, why, cost, benefit, who accepted
Tasks: id → tier → graders → threshold (pass^k, k, N trials)
One-way doors proposed:
Not in scope:
Fresh-reviewer check: session id, tests derived, gaps found
```

## Appendix D — Behaviour clause format

```
B-<cluster>-<nn>: <one sentence, imperative, verifiable>
  over-cautious failure: <what it looks like when the agent under-acts>
  over-bold failure:     <what it looks like when the agent over-acts>
  evidence: trace <id> step <n>; prompt line / skill section
  tasks: <task ids that grade this clause>
```

Prohibitions grade better than adjectives; where tone matters, use anchored rubric levels, one per dimension, versioned.

## Appendix E — Task definition

```
task:
  id, cluster, clauses[], tier, must_have: bool
  setup:         seeded state (records, files, jobs), persona? (hidden facts, cooperation knobs)
  turns[]:       prompt | inbound event | schedule fire
  end_state:     assertions on records/files/jobs
  required_facts: strings that must appear in agent output
  minefields:    actions that must never occur
  collateral:    assertions that nothing else changed
  budget:        tokens, turns
  graders:       code-first list; judge rubric id if any
  reference:     the solution that passes against the Muse arm
  version_hash:  of everything above
```

## Appendix F — Property ledger row

```
property:        e.g. credential non-exposure | injection fencing | approval finality | run idempotency | workspace persistence | process isolation | background execution model | browser isolation
muse_mechanism:  how the VM shape provides it (from interrogation / dump; tagged)
fletch_mechanism: DO | R2 | isolate sandbox | egress gateway | alarm | Workflow | grants engine | journal
verdict:         stronger | weaker | different, with the argument
proof:           test id or canary that demonstrates it in fletch
status:          proposed | verified
```

## Appendix G — Scorecard row

```
cluster | level (0–3) | must-have tasks pass^k | evidence (trace ids, record id, PR, verifier line) | last verified | next part
```

One scorecard, one home, linked from this spec once O1 is decided.
