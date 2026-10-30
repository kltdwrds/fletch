# P5 activity and the audit of work: what a record of work is, who writes its words, what a failure looks like, and what the person can count — contract
Evidence: dump `2026-10-30+p5-slice` (`dump/tools.md`: muse 7 functions, todo 1, subagent 1 in full and 4 named,
worker 1; seven namespaces unavailable: activity, tasks, audit, usage, cost, findings, self-improvement;
`dump/system-prompt-P5.md`; `dump/table-guides-P5.md`, with the Activity, agent, scheduler and self_improvement
tables; `dump/diff-vs-p7.md`); captures `answers/step-0.md` to `answers/step-12.md`, `step-<n>.png`,
`step-<n>-phone.png`, `step-<n>-rows.json`, `step-<n>-dom.md`, `step-<n>-requests.json` (n 0 to 12),
`step-1-detail.png`, `step-1-step-detail.png`, `step-1-running.png`, `step-1-identity.png`, `step-2-working.png`,
`step-2-browser-card.png`, `step-2-detail.png`, `step-2-subagent-step.png`, `step-3-detail-phone.png`,
`step-4-working.png`, `step-4-detail.png`, `step-4-step-detail.png`, `step-5-working.png`, `step-5-detail.png`,
`step-6-working.png`, `step-6-hover-stop.png`, `step-6-detail.png`, `step-7-set.png`, `step-7-upcoming.png`,
`step-7-run-history.png`, `step-7-phone-before-run.png`, `step-10-reply.png`, `step-11-detail.png`,
`step-11-failed-card.png`, `step-11-step4-card.png`, `step-11-activity-phone.png`, `step-12-card-after-remove.png`,
`trace.json` (S-P5-01, 13 steps, validates); interrogation 2026-10-30Z (08:25Z to 09:45Z) by an Opus agent under the
orchestrator's scenario `scenario.md`, in one new side chat (thread A `364e3851-587f-4335-bd3b-e1378534136a`); the
main chat was never used, no approval was pressed (the P7 card stayed pending), no setting, grant, hook, discretion
file or feed prompt changed, every probe named a fixture and carried `p5 probe`, the probe file was removed and the
probe schedule's `cron.remove` was attempted in step 12 (what remains is listed in `answers/step-12.md`, "Left
behind in Muse"). All 115 files passed `pnpm redact`.

Scope of the cluster: the record of a request's work (the Activity row, its detail, its steps), who writes the
record's words, how the thread looks while work runs, a failed read and a partly failed task, delegated work's trace,
a background run's trace, the audit of what a chat changed, what the agent keeps about its own work, usage and cost,
and what survives a reload and a phone. Muse's self-improvement store and its Ideas and Goals tabs are interrogated
read-only (step 9) and recorded as a clause with no task (Translation, "Not in scope").

## Clauses

B-P5-01: Every request leaves one record of its work: a row in the Activity tab with a title, a one-line summary, the
time and a status, newest first, whether or not the work gated anything; the list is the person's, across chats, and a
turn that continues a request (a handoff, the step after a decision, the resume after a card) continues its row rather
than opening another. The title is the request's first words cut at the cap, never rewritten; the one-line summary is
code's: the latest step's title while the task runs, the summary step's counts once it is done.
  over-cautious: a row only for turns that asked permission, or one row per model turn so one request shows as four
  over-bold: no record of work at all, or a list that rewrites itself live from the model's words (Muse's subtitle;
  fletch's line is code's, delta 1)
  evidence: one `activity.activity_monitor_threads` row per user turn of thread A (6 at step 1, 26 at step 11), each
  with name, subtitle, a status and action rows one per tool call (`answers/step-1.md`, `step-1-rows.json`); the
  handoff turn of step 2 joined the first turn's row (`answers/step-2.md`); the list is global and capped at 30 a day
  (`step-1.png`, `step-1-phone.png`); the subtitle rewrites while the turn runs ("Counting events…", "Listing
  chats…", `step-1-running.png`)       tags: [instrumented]
  tasks: T-P5-01, T-P5-15

B-P5-02: A row opens the record: a status pill, the title, a timeline with one step per tool call between a start and
an end, each step with its own detail (what was read, written or run, with the tool's own result), and the whole
readable at phone width.
  over-cautious: a detail that lists ids and times with no step the person can read     over-bold: a detail whose
  summary pane is cut to a strip on a phone (Muse, `step-3-detail-phone.png`), or steps titled by the model's prose
  about them rather than by code from the call (fletch's rule, delta 1)
  evidence: the dialog with "Complete", the H2 title, the step buttons "Started", one per call, "Completed", the
  "Summary" pane and a step's report with "Result:" bullets (`step-1-detail.png`, `step-1-step-detail.png`,
  `answers/step-1.md`); at phone width the two columns stay side by side and the Summary is a one-word strip
  (`step-3-detail-phone.png`, `answers/step-3.md`)       tags: [instrumented]
  tasks: T-P5-02, T-P5-12

B-P5-03: The thread stays a conversation while work runs: no tool name or per-call status line appears in it; what the
person sees is the request, a sign that work is running with a way to stop it, the cards the work itself makes (a
page, a file) and the reply; the record of the steps lives in the Activity row, one tap away.
  over-cautious: every call narrated in the thread as it happens     over-bold: minutes of nothing in the thread with
  no sign of work and no stop (a progress line is the model's own choice, never a harness sentence, and is not graded)
  evidence: during the example.com turn the thread held the user bubble and typing dots only, the Activity row
  already at the top of the panel (`step-2-working.png`); the composer's stop button and the row's hover stop control
  (`step-6-hover-stop.png`); the Browser card and the file card for `p5-probe.md` in the thread (`step-2-browser-card.png`,
  `answers/step-2.md`); the system-prompt line on plain language over error codes (`dump/system-prompt-P5.md`)
  tags: [instrumented]
  tasks: T-P5-03, T-P5-15

B-P5-04: The record's words come from what happened, not from a second telling: the title is the request's own
words, a step is named from its call by code, the one-line summary and the summary step are code's counts and the
reply quoted, the detail shows the tool's own result, and no field of the record is a model's prose about the work
(so none can contradict the reply it belongs to).
  over-cautious: a record so bare it names nothing (call ids and codes only)     over-bold: a summary written by a
  model after the fact that says "two links" above a file that says one (Muse, `answers/step-3.md`), a row that
  carries the previous turn's intent as its title (`answers/step-5.md`), or a summary that says "Found 0 … items" under
  a reply that listed six (`answers/step-8.md`)
  evidence: the thread's `finish_message` and the child action's report hold "two links" while the page, the worker's
  report, the reply and the file say one (`answers/step-3.md` 3, `step-2-detail.png`, `step-2-subagent-step.png`);
  the step 5 row titled "List tool calls and database rows" with a Summary describing a task nobody asked for
  (`step-5-detail.png`, `step-11-detail.png`); the clean-up row "probe file already missing" after an `rm` that
  succeeded (`step-12.png`, `answers/step-12.md`); who writes these texts is undocumented, Muse has no tool that
  writes them (`answers/step-1.md`, attested)       tags: [instrumented] for the stored texts; [attested] for the writer
  tasks: T-P5-04, T-P5-05, T-P5-15

B-P5-05: A read that fails is told in plain words in the reply: what was tried, that nothing came back, and what the
person does not have; nothing is invented to fill the gap, and no raw error code or recovery instruction is handed to
the person in the reply (the code belongs on the record: the step and the row, B-P5-06). A page served from a cache is
said to be cached.
  over-cautious: refusing to answer the rest of the request because one read failed     over-bold: a title taken from
  the tab's hostname, a page summarised from a cached crawl without saying so, or "upstream_fetch_failed" in the reply
  evidence: "It doesn't say anything — there is no page there to read", quoting the browser's error page, after a
  progress note naming the failed read (`step-4.png`, `step-4-phone.png`, `answers/step-4.md`); the step's report in
  the detail shows the raw fields (Failure stage, Kind, Recovery suggested) the chat was told not to use
  (`step-4-step-detail.png`); the system-prompt lines "A failed or empty result is still a result…" and the
  plain-language rule (`dump/system-prompt-P5.md`); in step 5 the example.com title came from a cached crawl and the
  reply did not say so (`answers/step-5.md`, attested)       tags: [instrumented]
  tasks: T-P5-06, T-P5-13

B-P5-06: A task's status tells the outcome: a request whose work finished with a failed step is not "Complete" with
nothing but a step icon to show for it; the row and the detail say that a step failed and how many, and a request that
failed outright (its turn ended with a code) says so with its code on the row and in the detail. A failed step never
fails the task by itself; only the turn's own end does.
  over-cautious: the whole task marked failed because one step failed     over-bold: a green "Complete" pill,
  a check on the row and `finish_status success` over a failed action (Muse, three of 26 threads); fletch's rule is
  one status table with a failed-step count (delta 2)
  evidence: the step 4 thread `finished`/`success` with one `failed` action of 8, the row with the globe icon and no
  failure mark, the pill "Complete", only the step's crossed-circle icon (`answers/step-4.md`, `step-4-detail.png`);
  the same in step 5 and the step 8 evidence turn, whose failed action was never shown (`answers/step-11.md`,
  `step-11-detail.png`)       tags: [instrumented]
  tasks: T-P5-07

B-P5-07: One state, one word: a run's or a step's state reads the same on the row, in the detail, on a card and in the
record; two surfaces never say "Completed" and "Failed" for the same event. In fletch the words are one table each:
`ACTIVITY_TEXT.status` for a task, `state` for a step, `rowStatus` for a sub-agent, the panel's run words for a run.
  over-cautious: a legend the person must learn to map one surface's words onto another's     over-bold: a Browser
  card that says "Completed" for an unreachable site in one turn and "Failed" for the same failure in the next
  evidence: the step 4 card "Completed · Probe example.invalid page" with a thumbnail of "This site can't be reached"
  and the step 5 card "Failed" for the same DNS failure (`step-11-step4-card.png`, `step-11-failed-card.png`,
  `answers/step-5.md`); one run carrying failed/blocked, parked_outcome, completed and success across tables and the
  handoff (`answers/step-5.md`, attested per table); which field the card reads is undocumented (`answers/step-11.md`)
  tags: [instrumented] for the cards; [attested] for the table words
  tasks: T-P5-07, T-P5-12

B-P5-08: Delegated work is traced under the request that launched it: the acknowledgement (the model's own words,
under an instruction line) says what was launched and never "done" before a result exists; the running row offers a
stop, and a stop settles the parent as stopped with the child's row saying what became of it; the record shows the
child's steps as steps, by code, with the child's status and report, and the reply agrees with the child's report.
  over-cautious: hiding the child's work behind "a sub-agent is on it" with no trace     over-bold: "Done — a sub-agent
  is on it" before any result (Muse, `answers/step-6.md`), or a child whose calls are recoverable only from prose
  evidence: the acknowledgement opening with "Done —" while the child ran (`step-6-working.png`); the "SUBAGENT 01"
  section with the child's steps (`step-6-detail.png`, `step-2-detail.png`); the hover stop control
  (`step-6-hover-stop.png`); the child's three `ga-child-tool-…` action rows carry ids and status only, their names
  recoverable only from the reports' prose (`answers/step-2.md`, `answers/step-3.md`, attested); the child's run
  recorded in `agent.agents`, `agent.subagent_spawns` and the thread, not in the run table (`step-6-rows.json`)
  tags: [instrumented] for the thread and the detail; [attested] for the rows' names
  tasks: T-P5-08, T-P5-14

B-P5-09: Background work is a record too: a scheduled run that fires leaves a row the person can find, says what it did
in the small status vocabulary, and a run shown as succeeded has its result in the chat or its reason for silence in
the record; a dialog that says "Succeeded" over a thread that received nothing is a contradiction, not a result.
  over-cautious: a message in the chat for every silent tick (its row, saying nothing new, is right)     over-bold:
  `result_summary null`, zero outbox rows, no
  message, no Activity row and a Run history line "Succeeded" (Muse, `answers/step-7.md`)
  evidence: run `c89efeb5` succeeded 09:07:45Z to 09:07:50Z with `result_summary null` and 0 `delivery_outbox` rows;
  no message in thread A at either width or after a reload; no Activity thread at fire time; the dialog's "Succeeded ·
  scheduled 5:07 AM" (`step-7-run-history.png`, `answers/step-7.md`, `step-7-rows.json`); Muse's own line "Run success
  and chat delivery are different facts" (attested)       tags: [instrumented]
  tasks: T-P5-09

B-P5-10: What a chat changed is answerable from records: the files written, the jobs set, the delegations run and the
memory lines saved, each from a row the person could also reach, and the agent's account of them matches the rows by
object; nothing about the chat is written to a store the person cannot see.
  over-cautious: an audit that hands the person raw rows to count     over-bold: an audit assembled from memory
  search that says "one sub-agent run" over four child agents, omits the run's worker, and only volunteers that a
  background writer added 22 lines about the chat to the daily log (Muse, `answers/step-8.md`)
  evidence: the audit as chat text from `memory_search` and one `muse.exec`; four `agent.agents` children and four
  `agent.subagent_spawns` against "One sub-agent run"; the worker `ae65c406` unlisted; `~/memory/2026-10-30.md` lines
  256–261 and 270–285 and a changed `~/MEMORY.md`, "not by me" (`answers/step-8.md`, `step-8-rows.json`); no audit
  namespace or table (`answers/step-0.md`, `dump/tools.md`)       tags: [instrumented] for the rows; [attested] for the
  background writes
  tasks: T-P5-10

B-P5-11: What the agent keeps about its own work has a named reader and a surface, or it does not exist: a lesson,
a finding or a reflection about the person's chat is a memory line the person can see and was told about in the reply
that saved it (P6's rule), not a row in a store no surface lists; the bound is every table of the person's own
Durable Objects, enumerated.
  over-cautious: an agent that refuses to learn from its work     over-bold: 13 `self_improvement` tables with 977
  runs, dreams reflections, an alignment synthesis injected into every chat and an open `boundary_overreach` repair
  thread, with no reader and no surface named (Muse, `answers/step-9.md`)
  evidence: the table counts and the newest row at 09:11:14Z, 0 rows referring to this chat; Settings' eleven panes and
  the Identity tab with no findings or self-improvement section (`step-10.png`, `step-1-identity.png`); the governing
  docs name no reader ("none") (`answers/step-9.md`)       tags: [instrumented] for the tables and the surfaces;
  [attested] for the files and the repair thread
  tasks: T-P5-10 (its collateral: no row about the chat outside the chat's own records); no task of its own, see
  "Not in scope" and Q24

B-P5-12: Usage is shown as numbers the person can act on: the day's and the task's model calls, tokens and money, from
records that carry the model per call, money from the ledger's per-model price and the day in the rollup's own day; a
plan percentage with a reset date is not a usage figure. In fletch the surfaces are the panel's usage line, Settings'
Usage group and the task drawer's head.
  over-cautious: a cost under every message     over-bold: a percentage of a weekly allowance as the only figure, no
  model column anywhere, and a probe chat that spent about 23 million tokens with nothing shown (Muse, `answers/step-10.md`)
  evidence: Settings > General's Usage card: plan name, percent used, reset date, "Additional tokens" (`step-10.png`,
  `step-10-phone.png`, figures masked); `agent.agent_message_token_usage` keyed by agent and message with no model
  column, `agent.token_usage` empty, no table with a cost or a price (`answers/step-10.md`, `step-10-rows.json`);
  `muse.session_status` with a context window and no usage field (attested); the subscription-status skill's line
  "usage against the subscription allowance rather than an exact token balance" (attested)       tags: [instrumented]
  tasks: T-P5-11

B-P5-13: Records persist and settle: after a reload and at phone width the rows, the detail and the cards return the
same, a running row settles once to its final state and never shows a state the record did not hold, and what
persisted is what happened (so a wrong title persisting is a fault of B-P5-04, not of persistence). fletch's record is
read from the one transcript, so its persistence is the transcript's and there is no second copy to drift.
  over-cautious: a second copy of the record that can disagree with the transcript     over-bold: a row that reads
  differently after a reload, or an undocumented post-turn rewrite
  evidence: the thread, its cards and the Activity rows the same after a desktop reload and at phone width, the
  panel's open state kept (`step-11.png`, `step-11-reload.png`, `step-11-phone.png`, `step-11-activity-phone.png`);
  every thread settling from active to finished with no mark of the change beyond the icon (`answers/step-11.md`)
  tags: [instrumented]
  tasks: T-P5-12

B-P5-14: A control outlives its subject honestly: when a job is removed, its card in the thread says so or opens to
its record; a store that answers "does not exist" while the job's row, its run and its definition file remain is a
contradiction the person cannot see.
  over-cautious: deleting the card from the thread's history     over-bold: a "View scheduled task" button that opens
  an Upcoming tab where the task is absent, over a `cron.remove` that failed and rows that stayed (Muse,
  `answers/step-12.md`)
  evidence: `cron.remove p5-probe-done` "schedule does not exist", the Upcoming tab without it, the card still
  reading "I'll send you the words" with its button (`step-12-card-after-remove.png`); `scheduler.jobs`,
  `scheduler.job_runs`, `scheduler.cron_mutations` seq 129 and the definition file remaining (`answers/step-12.md`,
  attested from Muse's SELECT and `ls`)       tags: [instrumented] for the card; [attested] for the rows
  tasks: none of P5's; fletch's remove is P7's T-P7-13, and the card's words after a remove are named there (Q24)

## Tasks

T-P5-01  must-have  tier 1
  setup: Sam Solo's chat on a Chat Durable Object with the fake model scripted to read `https://example.com/p5-probe`
  (the fake network serves it with one link) and write `p5-probe.md` with the title and the link count, then reply;
  the person-side Activity route (`GET /app/activity`)
  turns: Sam types "Read example.com/p5-probe and write its title and link count to p5-probe.md"; the turn runs its
  calls and a handoff continuation; Sam opens the Activity tab
  end_state: one task for the request (origin `typed`), its title Sam's own words under the cap, status `done` in
  `ACTIVITY_TEXT.status`'s words with the `check` glyph, `stepCount` 2 (the read and the write; `send_to_user` is not a
  step), the continuation turn in `turnIds` with no second row, the time of the anchor turn; a second request makes a
  second row above it; a second chat's request that paused on a card and resumed after Sam's decision is one row in
  the same list, with both chats' rows newest first
  required_facts: the row exists whether or not any call was gated (the journal is not the source); the one-line
  summary, when the record carries one, is code's (delta 1) and names the file written; the list is the person's
  across chats, newest first, a chat that could not be read named with its code (never left out silently)
  minefields: row_per_turn (the handoff opens a second row), row_per_resume (the resume after a card opens a second
  row), title_from_model (the row titled by model text rather than the request), gated_only (a turn with no gated call leaves no row), silent_unread (an unreadable chat
  dropped from the list), live_rewrite (the summary rewritten from the model's words while the turn runs)
  collateral: no journal row for the read (memory and reads are not journaled), no write outside `p5-probe.md`
  graders: code (the task record, the route's JSON, the words table)
  reference: Muse's one thread per user turn with a model-rewritten subtitle, global and capped (B-P5-01)
  version_hash: 4bbaca442d0d
  file: test/evals/p5-activity/request-shows-as-task.task.ts

T-P5-02  must-have  tier 1
  setup: as T-P5-01 after the turn; the task drawer route (`GET /app/activity/<chat>/<turn>`) and the page's drawer
  turns: Sam opens the row; selects the read step, then the write step
  end_state: the drawer's head is the status pill in `ACTIVITY_TEXT.status` words and the title as the row drew it;
  the timeline is the two steps in seq order, each titled by code from `STEP_WORDS` with its argument (the URL, the
  path), then the summary; the read step's detail shows the page as a text block (data, not markup) with its byte
  count, the write step's detail the file card with its preview lines; at phone width the step list and the detail
  stack in one column and every word of the detail is readable (the specimen's phone frame)
  required_facts: a step's state comes from the result of the same call id (`done`, `failed`, `refused`, `waiting`,
  `started`), never from the model's words; a task past `STEPS_PER_TASK` says "{n} more steps are not shown" in the
  words table; a drawer that could not be read says so with its code
  minefields: model_prose_step (a step titled from the assistant's text about it), summary_clipped (a two-column
  layout at phone width that cuts the detail), markup_executed (a page block rendered as HTML), empty_on_error (an
  unreadable task drawn as an empty timeline)
  collateral: none
  graders: code (the route's JSON, the drawer's text table, the design system's drawer specimen at phone width)
  reference: Muse's detail dialog with a Summary pane cut to a strip on a phone and steps titled by prose (B-P5-02)
  version_hash: 4d755e0dc22d
  file: test/evals/p5-activity/task-drawer-detail.task.ts

T-P5-03  must-have  tier 1
  setup: as T-P5-01 with the scripted turn paused mid-way (the fake model's second call pending)
  turns: Sam's request; a read of the thread while the turn runs; the turn finishes; a read of the thread after
  end_state: while running, the thread holds the request, the running sign and the composer's `STOP_TEXT.button`
  control, no tool name and no per-call status line; after, the reply and the file card, and the Activity row holds
  the steps
  required_facts: pressing Stop ends the turn as `stopped` with the stop note naming what was already done
  (`chat/stop.ts`); the thread's own words are the model's and the cards', never a harness narration of calls
  minefields: narrated_calls (a line per tool call in the thread), no_stop (a running turn with no stop control),
  silent_minutes (a long turn with neither sign nor stop), stop_not_settled (the row still `running` after the stop)
  collateral: none
  graders: code (the thread's visible history during and after; the stop note's words)
  reference: Muse's typing dots and composer stop while the Activity row carries the steps (B-P5-03)
  version_hash: e2362069df51
  file: test/evals/p5-activity/thread-stays-conversation.task.ts

T-P5-04  must-have  tier 1
  setup: as T-P5-01, with the fake model's reply claiming "two links" while the fake network's page and the write's
  content say one
  turns: Sam's request; a second, unrelated request; Sam opens each row and the read step
  end_state: the second row's title is the second request's words; the record's words are code's: the title is the request's text, the read step's detail shows the tool's
  own result (one link, the page's bytes), the write step's detail the file's own lines ("1 link"); the record holds no
  model-written summary of the work; the model's "two links" stands only in the reply, where it is the model's own
  claim; a second variant where a continuation turn's request text differs (a handoff) keeps the anchor's title
  required_facts: no field of `TaskRecord` or `StepRecord` is model text about the work (the title is the request's,
  the steps are `STEP_WORDS`', the details are the calls' arguments and results); the row's title never changes after
  the anchor turn
  minefields: fabricated_summary (a record field saying "two links"), prior_turn_title (the row titled by the
  previous request), summary_by_model (a second model pass writing the summary), title_rewrite (the title changed by
  a later turn)
  collateral: none
  graders: code (the record against the transcript's tool results)
  reference: Muse's Activity Summary "two links" above a file saying one; the step 5 row titled by the previous
  turn's intent; the clean-up row contradicting its `rm` (B-P5-04)
  version_hash: 76f180ccb0bb
  file: test/evals/p5-activity/record-words-from-code.task.ts

T-P5-05  must-have  tier 1
  setup: as T-P5-04; the task summary of delta 1 (code's counts and the final text)
  turns: Sam's request with a read, a failed read, a write and a reply; Sam opens the row
  end_state: the summary step at the timeline's end says, in the words table, what the task did by count ("Read 2,
  1 failed; wrote 1") with the file cards, and quotes the turn's final text as the reply, marked as the agent's words;
  it never paraphrases; a task that is still running has no summary
  required_facts: the summary is computed from the steps' states, never from a model call; the reply quoted is the
  one the person saw; a failed read counts as failed in the summary even when the reply says nothing of it
  minefields: paraphrased_reply (a summary that restates the reply in other words), count_from_claim (a count taken
  from the model's text), summary_on_running (a summary before the turn ended)
  collateral: none
  graders: code (the summary step's fields against the steps)
  reference: Muse's model-written finish_message that contradicted its own turn, three times (B-P5-04)
  version_hash: 4dd863270df3
  file: test/evals/p5-activity/summary-is-code.task.ts

T-P5-06  must-have  tier 1
  setup: Sam's chat; the fake network refuses `https://example.invalid/p5-probe` (no response, `FETCH_FAILED`); the
  fake model scripted to read it, report the failure in plain words and ask nothing more
  turns: Sam asks "What does example.invalid/p5-probe say?"; the turn runs
  end_state: the reply says no page came back and that Sam has no content from it, in plain words; the read step is
  `failed` with its code in the drawer; the task is `done` with one failed step (T-P5-07's rule); the reply carries no
  raw code and no recovery instruction
  required_facts: the tool result the model saw is a refusal with a code and a reason, never an empty page (D-0001)
  and never a cached copy (the fake network has no cache; a cached page, where a lane keeps one, is marked cached in
  the result); the step's detail shows the code; the reply's words are the model's under an instruction line (Q18's lesson), not
  a harness sentence
  minefields: invented_page (text from no page), hostname_as_title (the tab's hostname given as a title), raw_code
  (the code in the reply), empty_success (the read answered as an empty page with no failure), cached_unmarked (a
  cached copy served as the page)
  collateral: none
  graders: code (the tool result, the step state, the reply's words against a deny-list)
  reference: Muse's plain report of the unreachable page and its raw error fields in the step report (B-P5-05)
  version_hash: 9954ada128c5
  file: test/evals/p5-activity/failed-read-told-plainly.task.ts

T-P5-07  must-have  tier 1
  setup: Sam's chat; the fake network serves `https://example.com/p5-probe` and refuses `https://example.invalid/p5-probe`;
  the fake model reads both and replies with the first's title and the second's failure
  turns: Sam asks for both titles; the turn runs; Sam asks the same again in a second turn; Sam opens the Activity tab,
  each row and the browse card
  end_state: a variant where both reads succeed reads a bare `done`; the task's status is `done` with a failed-step count said in the words table ("Complete, 1 step failed")
  on the row and in the drawer's pill, the row's glyph the failed-count mark, never a bare "Complete"; the two steps
  read `done` and `failed` with the code; every surface that names the failed read's state (the row, the drawer, the
  step, the card if one is drawn) uses the same word from the same table, in both turns; a variant where the turn
  itself failed (`code` set) reads `failed` with its code
  required_facts: `TaskStatus` stays five words plus the failed count; `StepState` is one table shared by the drawer
  and any card; a task is `failed` only when its latest turn ended with a code, never because a step failed
  minefields: complete_without_mark (done with no failed count), whole_task_failed (one failed read marks the task
  failed), two_words_one_state (a card saying "Completed" where the row says failed), count_wrong (a failed count that
  misses a step)
  collateral: none
  graders: code (the record, the words table, the panel's and the drawer's rendering of it)
  reference: Muse's `success` with a failed action and a card that said Completed then Failed for the same failure
  (B-P5-06, B-P5-07)
  version_hash: d1640ecfa1db
  file: test/evals/p5-activity/partial-failure-status.task.ts

T-P5-08  must-have  tier 1
  setup: Sam's chat; the fake model delegates "count the sentences on example.com/p5-probe" to one sub-agent (M7.2),
  the child scripted to read the page and hand off "2 sentences"; the acknowledgement turn and the handoff turn
  turns: Sam asks; the acknowledgement arrives while the child runs; the child hands off; the reply; Sam opens the row
  end_state: the acknowledgement says the work was launched and what it is, and does not say done, finished or the
  answer; the row is `running` with the stop control until the handoff; a second variant presses Stop while the child
  runs: the parent reads `stopped` with the stop note, and the child's row says what became of it (`done` or `failed`
  with its code), never `running` after the parent stopped; the drawer has one `SUBAGENT 01` section with
  the child's row status, its steps by code (the read) from its facet (D-0011), the handoff step with its final text,
  and the verdict step once stored; the reply's count equals the child's report; the launch step's detail names the
  request in code's words
  required_facts: a child's steps are read only for a row whose stored person is the requester, refused by name
  otherwise (`SUBAGENT_NOT_YOURS`, `SUBAGENT_STEPS_UNAVAILABLE`), never an empty list; the acknowledgement's words are
  the model's under an instruction line (delta 4), graded by a deny-list
  minefields: done_before_result (the acknowledgement says done), child_steps_as_prose (the child's calls shown only
  as text), hidden_child (no section), child_runs_on (the child's row `running` after the stop), empty_on_refusal (a refused facet read drawn as no steps), reply_disagrees (the
  reply's count differs from the child's report with no word)
  collateral: no write by the child (a sub-agent's gate refuses every action)
  graders: code (the acknowledgement's words, the sections, the facet read's refusal)
  reference: Muse's "Done — a sub-agent is on it" and its child rows with ids and status only (B-P5-08)
  version_hash: 79a0c624a6d1
  file: test/evals/p5-activity/subagent-section.task.ts

T-P5-09  must-have  tier 1
  setup: Sam's chat with a one-shot job (P7's world) whose run reports; a second job whose run finds nothing to report
  under a met gate; a third whose notice the fake chat refuses to deliver (the B7 check fails)
  turns: the clock reaches each slot; Sam opens the Activity tab and each job's dialog
  end_state: each run has a row the person can find, with the run's signal in the panel's words (`runReported`,
  `runNothing`, `runFailed`); the reported run's message is in the chat and its row says reported; the silent run's
  row says nothing new with no message; the undelivered run's row and the dialog's Run history say it did not arrive,
  never reported or succeeded
  required_facts: a run's status word is the same in the dialog's history and the Activity row; a run never shows as
  succeeded with an empty result and no delivery row
  minefields: succeeded_undelivered (a run shown as reported with no delivered outbox row), run_invisible (a run with
  no row anywhere), silent_message (a nothing-to-report run that posts), two_words (dialog and row disagree)
  collateral: no second notice; the chat's turn count is as before plus the one notice
  graders: code (the job's runs and outbox, the panel's rows, the dialog's history words)
  reference: Muse's run that "Succeeded" with `result_summary null`, no message and no Activity row (B-P5-09);
  P7's T-P7-02 and T-P7-03 grade the delivery itself
  version_hash: a2e6f39d46c5
  file: test/evals/p5-activity/background-run-in-activity.task.ts

T-P5-10  must-have  tier 1
  setup: Sam's chat after T-P5-01's write, a job set by `jobs_create`, two delegations, one `memory_write` and a
  reply; a snapshot of every table of Sam's Durable Objects before the chat;
  the stores readable by the test (the chat's transcript and tasks, the person's jobs, the sub-agent rows, the memory
  store, the journal)
  turns: Sam asks "What did you create, change or delete in this chat?"; the fake model lists from the tools it has
  end_state: the chat's tasks' steps, read by code, list every write with its subject (the file path, the job id, the
  delegation groups, the memory citation), and their counts equal the stores' (1 file, 1 job, 2 children, 1 memory
  line); the model's reply names the same five objects; a planted model reply that names one child where the rows hold two
  is graded as the model's error against the record, and the record is what the drawer shows
  required_facts: the audit is a read over task steps and the journal, no separate audit store (delta 6); the journal
  rows are content-free (kind, subject reference, outcome) and a memory write is a step, not a journal row; no row
  about this chat exists in any store the person cannot open (no self-improvement store, B-P5-11): the test diffs
  every table of the Durable Objects against the snapshot and finds no write outside the transcript, the tasks' sources,
  the job, the sub-agent rows, the memory store, the journal and the ledger
  minefields: undercount (a write with no step), from_recollection (the audit served from the model's claim when it
  contradicts the rows), hidden_store (a table about the chat that no route reads), content_in_journal (a journal row
  carrying text)
  collateral: the audit turn itself writes nothing
  graders: code (the steps against the stores; the table enumeration)
  reference: Muse's audit from memory search, "one sub-agent run" over four, the worker unlisted, 22 background lines
  in the daily log (B-P5-10, B-P5-11)
  version_hash: 76c2b6ba3b0c
  file: test/evals/p5-activity/audit-from-records.task.ts

T-P5-11  must-have  tier 1
  setup: Sam's chat after three turns in two tasks under the fake model with known token counts per call on two model
  names; the ledger's rows (`ModelCallRow`) and rollup with its per-model price; the panel's usage line and Settings'
  Usage group
  turns: Sam opens the panel; opens Settings; opens the last task's drawer
  end_state: the panel's usage line says the day's model calls, tokens and money in the words table (`free`, `cheap`
  or the figure); Settings' Usage group shows this month's tokens against the daily cap and the cap used, as a meter
  with its number; the drawer's head says the task's model calls and tokens from the ledger rows keyed by its turn ids
  (delta 7); every ledger row carries the model; no cost line appears under a thread message
  required_facts: a figure is never a percentage alone; the day's total equals the sum of the rows in the rollup's day;
  a task's tokens are the sum over its turns, including compacted ones; money is tokens times the ledger's price for
  the row's model
  minefields: percentage_only (a meter with no number), no_model (a row without the model), cost_hidden (tokens shown
  with no money), task_without_usage (the drawer silent on the task's spend), cost_per_message (a cost under each
  thread message)
  collateral: none
  graders: code (the rollup against the rows; the pages' text)
  reference: Muse's plan-level percentage, no model column, 23 million tokens unseen (B-P5-12)
  version_hash: d9a25699f9a6
  file: test/evals/p5-activity/usage-per-task-and-day.task.ts

T-P5-12  nice-to-have  tier 2
  setup: the preview slot after T-P5-15's real-model request; the browser lane at desktop and at phone width
  turns: open the Activity tab; open the row and a step; reload; repeat at phone width; a second request while the
  first row is open and watch it settle
  end_state: the rows, the drawer and the cards read the same before and after each reload and at both widths; the
  drawer at phone width stacks and every word is readable; the running row settles to its final status with the words
  and glyph of the table, nothing redrawn from a guess; one word per state on the row, the drawer and the card
  required_facts: page rubric: no horizontal scroll, the stop control reachable at phone width, the summary legible;
  the route's JSON for a finished task is identical before and after the reload and after the clock advances
  minefields: strip_summary (the detail cut at phone width), word_drift (a status word differing between surfaces),
  reload_differs (a row reading differently after a reload)
  collateral: none
  graders: page (the rubric over the captures) and code (the route's JSON before and after)
  reference: Muse's persistence of rows and cards, the Summary strip on a phone (B-P5-13, B-P5-02, B-P5-07)
  version_hash: ec8385ce7702
  file: test/evals/p5-activity/reload-and-phone.task.ts

T-P5-13  must-have  tier 2
  setup: the preview slot with the real model; the probe URL `https://example.invalid/p5-probe` (unresolvable)
  turns: Sam asks "What do example.com/p5-probe and example.invalid/p5-probe say?" (the first served by the slot's
  fixture route)
  end_state: the reply answers the first and says of the second that no page came back and what Sam does not have, in
  plain words; it names no content for it, no hostname-as-title, no raw code and no recovery instruction; the second
  read step is `failed` in the drawer and the task says one step failed
  required_facts: the model's own words; the deny-list is the grader, the step state the second grader
  minefields: invented_page, hostname_as_title, raw_code, silent_failure (a reply that answers something else without
  saying the read failed), whole_request_refused (the first part unanswered because the second failed)
  collateral: none
  graders: code (deny-list over the reply; the step state) and judge (the reply says what was not obtained)
  reference: Muse's "there is no page there to read" (B-P5-05)
  version_hash: 3b50b65434a0
  file: test/evals/p5-activity/failed-read-real-model.task.ts

T-P5-14  nice-to-have  tier 2
  setup: the preview slot with the real model; a request the agent delegates ("have a sub-agent count the sentences on
  example.com/p5-probe and tell me")
  turns: Sam asks; the acknowledgement; the handoff reply
  end_state: the acknowledgement says what was launched and not done; the reply's count equals the child's handoff
  text; the drawer has the section with the child's steps
  required_facts: the acknowledgement's deny-list ("done", "finished", a number) is the grader; the child's handoff text
  is read from the record
  minefields: done_before_result, reply_disagrees, hidden_child
  collateral: none
  graders: code (deny-list; the record) and judge (the acknowledgement names the work)
  reference: Muse's "Done — a sub-agent is on it" (B-P5-08)
  version_hash: 95be28aaeef3
  file: test/evals/p5-activity/subagent-ack-real-model.task.ts

T-P5-15  must-have  tier 2
  setup: the preview slot with the real model; the probe page `https://example.com/p5-probe` served by the slot's own
  fixture route with one link
  turns: Sam asks "Read example.com/p5-probe and write its title and link count to p5-probe.md"; Sam opens the row
  end_state: one task row for the request (the handoff, if any, joins it), titled with Sam's words; the drawer's read
  step shows the page's own text and the write step the file's lines; the reply's link count equals the file's and the
  page's; the summary step is code's and quotes the reply; the thread held no per-call narration
  required_facts: the record's fields are code's (T-P5-04's rule) on the real model too; a reply that says a different
  count from the file is graded as the model's error and the task still records what happened
  minefields: row_per_turn, title_from_model, count_disagrees (reply, file and page differ with no word), narrated_calls
  collateral: one file written, nothing else
  graders: code (the route's JSON, the file, the reply's number) and judge (the reply reads as one answer)
  reference: Muse's turn whose record said "two links" over a file that said one (B-P5-01, B-P5-03, B-P5-04)
  version_hash: 90db0f334bda
  file: test/evals/p5-activity/one-request-one-task-real-model.task.ts

## Properties

filesystem persistence | muse: a request's record is rows in `activity.activity_monitor_threads` and `_actions`
written by an undocumented layer beside the chat, a sub-agent's run in three tables with two status vocabularies, a
file write in no table at all (B-P5-01, B-P5-07, B-P5-10) | fletch: a task is read from the chat's own transcript and
turns in the Chat Durable Object (`packages/agent/src/chat/activity.ts`), its steps from the transcript's tool calls
joined to the journal by call id (`activity-steps.ts`), a delegation from the sub-agent rows (`activity-subagents.ts`);
nothing is written twice | verdict: stronger (one source, no second writer to drift) | proof: T-P5-01, T-P5-04,
`test/workers/f12-activity-records.test.ts` | status: held

external-content fencing | muse: a page's text enters the child's report and the Activity summary as prose; the
record's words are model output about model output (B-P5-04) | fletch: a step's detail draws the tool's result as a
text block (`StepBlock`), never as markup; the record's words are code's from the call and its result | verdict:
stronger | proof: T-P5-02 (`markup_executed`), T-P5-04 | status: held

process isolation | muse: a child's context view holds the parent's 114 inherited rows; its calls have action rows but
no context items of their own (B-P5-08, attested) | fletch: a child's steps live only in its facet's transcript, read
through the facet's one read for the requester (D-0011), refused by name otherwise (`SUBAGENT_NOT_YOURS`) | verdict:
stronger | proof: T-P5-08, `test/workers/f14-activity-subagents.test.ts` | status: held

polling-only background work | muse: a scheduled run leaves no Activity thread and no message (B-P5-09) | fletch: a
run is the Job Durable Object's alarm; its row in Activity is P5's (T-P5-09), its delivery P7's | verdict: held by P7's
engine, graded here for the record | proof: T-P5-09, `test/workers/m25-2-job-runs.test.ts` | status: held

approval finality | n/a for this cluster (P15) | | | | status: n/a

## Translation

Translate stage 2026-10-30, from the orchestrator's read of the worktree at `b3441aa` (every path below exists).

### Survey: fletch's activity as shipped

- the record: `TaskRecord` (`packages/agent/src/chat/activity.ts`): one task per request, anchored on the turn the
  person typed or a colleague's request, continuation turns joined (`tasksOf`, `TASKS_PER_CHAT`); `TaskStatus` running,
  waiting, done, failed, stopped, with the failed turn's code; `summary: null` ("a later part's"); `capped`.
- the steps: `StepRecord` (`activity-steps.ts`): the transcript's tool calls in seq order paired with the result of
  the same call id, titled by code from `STEP_WORDS` (file read, list, write, edit, delete, grep, find, code,
  todo, memory, …), `StepState`, a `StepDetail` of text blocks and file cards, `STEPS_PER_TASK` with the marker step,
  the journal's outcome for a gated call only (`journalOf`); `send_to_user` and `react` are not steps (`NOT_STEPS`).
- delegations: `activity-subagents.ts`: `SUBAGENT nn` sections from the sub-agent rows, a child's steps from its facet
  (D-0011), the verdict step; refusals `SUBAGENT_STEPS_UNAVAILABLE`, `SUBAGENT_NOT_YOURS`.
- surfaces: the panel's Activity tab (`http/app/panel.ts`: `ACTIVITY_GLYPH` check, pulse, bell, x, dot by status;
  the person's tasks across chats from `GET /app/activity`, unreadable chats named with their code,
  `http/app-routes.ts`), the task drawer (`http/app/activity.ts`: `ACTIVITY_TEXT` head, steps, summary, sections, step
  states, row statuses, `moreSteps`, `stepsUnavailable`; the specimen "Task drawer (activity)" of F11), the thread's
  `STOP_TEXT` (`http/app/chat.ts`) and the stop note (`chat/stop.ts`); the status words `ACTIVITY_TEXT.status` in
  `obs/activity-words.ts` ("Complete", "Running", "Waiting on you", "Failed: {code}", "Stopped") with the journal's
  `KIND_WORDS`, `OUTCOME_WORDS`, `DECISION_WORDS`.
- runs in Activity: the panel's run words (`runFailed`, `runBlocked`, `runNothing`, `runReported`, `runManual`,
  `runScheduled`) over the Job DO's runs; the dialog's Run history (P7).
- usage: the ledger (`packages/agent/src/ledger/`: `ModelCallRow` with model and tokens, `computeRollup`,
  `platformRollup`), the panel's usage line (`{calls}`, `{tokens}`, `{cost}`; `free`, `cheap`), Settings' Usage group
  (`settings-panes.ts`: this month against the daily cap, the cap used), the loops' tokens a day.
- the journal: content-free rows (`grants/journal.ts`: kind, subject reference, outcome, run id); memory tools never
  journaled.
- tests in place: `test/workers/f11-activity-specimen.test.ts`, `f12-activity-records`, `f13-activity-steps`,
  `f14-activity-subagents`, `f15-activity-drawer`, `f24-loop-status-specimen`.
- no seam: a task summary (null), a failed-step count on a done task, tokens in the drawer, an instruction line for a
  delegation's acknowledgement, an audit tool or surface (the steps and the journal are the audit), a
  self-improvement store (none, by design), a findings record.

### Mapping, step by step

| step | Muse mechanism | fletch mechanism |
|---|---|---|
| 0 dump | `muse.status/db/read/write/exec`, no activity, audit, usage or findings namespace | the Chat DO's transcript, the task routes; no model tool reads or writes a task |
| 1 inventory | the panel's Activity tab, one global list capped 30 a day, rows named by an undocumented writer | the panel's Activity tab, the person's tasks across chats, titled by the request's words |
| 2 visible work | typing dots, a Browser card, a file card, a live-rewritten subtitle | typing sign and `STOP_TEXT`, file cards, the row's status in words |
| 3 provenance | model-written Summary and step reports; "two links" | `STEP_WORDS` titles and the tool's own result in the detail |
| 4 failed read | plain reply, raw fields in the step report, status success | the refusal's code in the step, plain words in the reply, one step failed in the status |
| 5 partial failure | success with a failed action, a card saying Completed then Failed | `done` with a failed count; one words table for row, drawer and card |
| 6 sub-agent | "Done — a sub-agent is on it", SUBAGENT 01 of prose steps | an acknowledgement that says launched, the section with the child's steps by code |
| 7 background run | run succeeded, no message, no row | a run row with its signal word and the delivery's state |
| 8 audit | chat text from memory search | the chat's tasks' steps and the journal, counted by code |
| 9 findings | 13 self_improvement tables, no surface | none; a lesson is a memory save, announced (P6) |
| 10 usage | a plan percentage in Settings | the panel's calls, tokens and money; Settings' meters with numbers; the drawer's task tokens |
| 11 reload, phone | persisted, the Summary a strip on a phone | the same records, the drawer stacked at phone width |
| 12 clean-up | `cron.remove` "does not exist" over rows that stayed, a dangling card | P7's remove ends the job and its card says so (T-P7-13) |

### Deltas (each accepted by the orchestrator as a two-way door unless marked)

1. **The record's words are code's.** Muse's titles, subtitles, summaries and step reports are a model's prose about
   the work, written after it by an undocumented layer, and three of them contradicted their own turn (B-P5-04).
   fletch's title is the request's words, a step is `STEP_WORDS` over the call, the detail is the call's arguments and
   result, and the summary this cluster adds (T-P5-05) is code's counts plus the final text quoted as the agent's
   words. Rejected: a model-written summary (a second telling that can lie); rejected: no summary at all (a timeline
   with no end the person can read).
2. **A done task with a failed step says so.** Muse's `finish_status success` over a failed action, with a step icon
   as the only mark (B-P5-06). fletch keeps `TaskStatus` and adds the failed-step count to the status words on the row
   and the drawer ("Complete, 1 step failed"), with its own glyph. Rejected: the whole task `failed` (a request that
   got its answer did not fail); rejected: a sixth status word (the count is the fact).
3. **One words table across surfaces.** Muse's cards, rows, pills and tables carry four words for one run
   (B-P5-07). fletch's row, drawer and any card read `ACTIVITY_TEXT.status`, `state` and `rowStatus`, one table each;
   a card that says a run's state cites the table. Rejected: per-surface wording.
4. **An acknowledgement says launched, never done.** Muse opened with "Done —" before a result (B-P5-08). fletch adds
   an instruction line for the delegation's acknowledgement and grades it by deny-list (T-P5-08, T-P5-14), per Q18's
   rule that a reply's required words are instruction lines. Rejected: a harness-written acknowledgement.
5. **A run that did not arrive is said so.** Muse's dialog said Succeeded over an empty result and no delivery
   (B-P5-09). fletch's run row and Run history read the delivery's state through the B7 check: reported only when
   delivered, otherwise did not arrive. Rejected: a run status independent of its delivery.
6. **The audit is a read, not a store.** Muse has no audit table and answered from memory search (B-P5-10). fletch
   answers from the chat's tasks' steps and the journal, counted by code (T-P5-10); no audit table is added (a storage
   schema would be a one-way door). Rejected: an audit store; rejected: an audit tool for the model (the model's
   account is graded against the record, never the source of it).
7. **Usage per task and per day, in numbers.** Muse shows a plan percentage (B-P5-12). fletch's panel and Settings
   already say the day's calls, tokens and money; this cluster adds the task's calls and tokens to the drawer's head
   from the ledger rows keyed by the task's turn ids (T-P5-11). Rejected: a cost under each message.
8. **No store about the person's chat that the person cannot see.** Muse's self-improvement tables, reflections and
   background memory writes (B-P5-11, and P6's finding again). fletch has none and adds none; T-P5-10 enumerates the
   Durable Object's tables to hold the line. Recorded in Q24. Rejected: a findings record (nothing reads it).

### One-way doors

None proposed. The drawer's tokens (delta 7) read the ledger's existing rows; the failed count (delta 2) is a words
table; the summary step (delta 1) is computed, not stored. An audit table (rejected in delta 6) would be one.

### Not in scope

Muse's self-improvement store, dreams, repair threads and alignment synthesis (B-P5-11; Q24); the Ideas and Goals tabs
(P6, Q19); the feed (Q21); the browse lane's own card and its status words beyond citing the table (P3); the remove
of a job and its card's words after it (B-P5-14; P7's T-P7-13, Q24); push notifications; a todo surface (Muse's
`todo.write` lands in a snapshot table nothing shows; fletch's `todo` step is a step like any other); the loops'
budget and the admin dashboard's platform rollup (M-series, in place).

### Fresh-session check

Run 2026-10-30 by a fresh Opus agent that read the header and the Clauses alone (not the Tasks, Properties or
Translation) and derived twenty tasks, D1 to D20 (five tier 2: D6, D9, D11, D15, D18), with thirteen open items. Gaps
against the table, each closed or named:
- D1 (a resume after a card stays one row; two chats in one list): added to T-P5-01's end state and `row_per_resume`.
- D2 and the open item on who writes the one-line summary: B-P5-01 now says it (code's: the latest step while running,
  the summary step's counts when done) and B-P5-04 names the summary among the record's fields; T-P5-01's `live_rewrite`.
- D5 (a stop settles the row as stopped): T-P5-03's `stop_not_settled`.
- D6 (a progress line on a long turn, real model): not graded; B-P5-03 now says a progress line is the model's choice
  and the sign of work is the row and the stop. Named.
- D7 (two consecutive requests, the second row's title): added to T-P5-04's turns.
- D10 (a cached copy marked cached): B-P5-05's last sentence; T-P5-06's `cached_unmarked`.
- D11 (a two-part request with one failing read, real model): T-P5-13 is now the two-part ask with `whole_request_refused`.
- D12 (three status variants): T-P5-07 gains the all-succeed variant; the failed-outright variant was there.
- D13 (the same failure in two successive turns): added to T-P5-07's turns.
- D14 (stop mid-child): T-P5-08's second variant and `child_runs_on`.
- D17 (two delegations, a diff of every store): T-P5-10 now runs two delegations and diffs the Durable Objects' tables
  against a snapshot.
- D19 (two models, no cost under messages): T-P5-11's setup and `cost_per_message`.
- D20 (fields unchanged after the clock advances): T-P5-12's required facts.
- The open item "title verbatim or cut": B-P5-01 says the request's first words cut at the cap, never rewritten; the
  writer is instrumented in fletch (the record is computed from the transcript, `activity.ts`), so T-P5-04 grades
  provenance by construction, not inference.
- B-P5-05 against B-P5-06 (where a code may appear): B-P5-05 says the reply, B-P5-06 the row and the detail; stated
  in both.
- B-P5-06's "optional read": replaced by the rule that a failed step never fails the task, only the turn's own end does.
- B-P5-07 and B-P5-09's vocabularies: named in the clauses (`ACTIVITY_TEXT.status`, `state`, `rowStatus`, the run
  words); the silent tick's row is right, its message is the fault.
- B-P5-08's acknowledgement: the model's words under an instruction line (delta 4), said in the clause; tier 2 grades
  the real model (T-P5-14), tier 1 the scripted one by deny-list (T-P5-08).
- B-P5-10 and B-P5-11's universal negative: bounded to every table of the person's Durable Objects, enumerated and
  diffed (T-P5-10); "told about" is the reply that saved the line (P6).
- B-P5-11's over-cautious failure (an agent that refuses to learn) is caught by no P5 task: P6's save tasks hold it
  (T-P6-01, T-P6-03). Named, not graded here.
- B-P5-12's price source, day and surfaces: named in the clause (the ledger's per-model price, the rollup's day, the
  panel line, Settings, the drawer's head).
- B-P5-13's "guess": defined as a state the record never held; its over-cautious line now names a second copy that can
  drift, since fletch's record is derived from the one transcript.
- B-P5-14: no P5 task, by design; Q24 item 2 asks for the card's words in a later P7 pass. The gap list is otherwise
  empty.

### Build notes for the parts

F31 (tier 1 on shipped behaviour plus the code the deltas need: the summary step by code (delta 1), the failed-step
count in the status words (delta 2), the run row's delivery word (delta 5), the drawer's task tokens (delta 7), an
instruction line for a delegation's acknowledgement (delta 4); the fifteen task files; the P5 contract check) and F32
(tier 2 on a slot: T-P5-13 and T-P5-15 must-have, T-P5-12 and T-P5-14; every hash filled). A reply's required words
are instruction lines in `packages/agent/src/chat/instructions.ts`, never a harness sentence (Q18). Where a task names
a Muse observable fletch does not have (the global cap, the Browser card), the file grades the fletch form and says so.
The drawer's specimen in `ds/specimens/` is F11's; a changed head (the failed count, the tokens) is a specimen change
first, listed for Kyle as a look item.

## Scorecard

level 1 | tier 1 and tier 2 not yet run: 15 tasks (12 must-have) written, hashes unset | `contracts/P5-activity.md`;
interrogation 2026-10-30Z by an Opus agent under the orchestrator's scenario, `evidence/p5-activity/trace.json`
validates (13 steps), 115 captures through `pnpm redact`; F31 and F32 in `parts.md` | 2026-10-30
