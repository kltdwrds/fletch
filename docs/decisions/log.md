# Decision log

Two-way doors: dated one-liners with their reason, for choices nobody else has to obey. When a line starts mattering
to others, promote it into a record (README.md) and delete it here. Capped at 40 KB by `scripts/check-decisions.mjs`.

- 2026-10-20 WebAuthn uses `@simplewebauthn/server` 14.0.3: it bundles under `nodejs_compat`, so there is no
  hand-rolled fallback.
- 2026-10-20 `@noble/hashes` 2.4.0 provides synchronous SHA-256 in the passkey stores.
- 2026-10-20 `create-fletch` sets `MASTER_KEY` and `SETUP_TOKEN` (32 random bytes, base64url) each only when the Worker
  lacks it: a fresh account gets two secret puts, a second run none (D-0002).
- 2026-10-20 `tokenScopes(cf, accountId)` takes the account id, which the per-scope probes and the account-token
  verify endpoint need.
- 2026-10-22 `pnpm check` is the fast gate (lint, harness checks and scans, typecheck; about 20 s, run by the pre-push
  hook) and `pnpm verify` adds the tests (CI and the release). Rejected: tests in the pre-push hook, too slow for every
  push and refused beside a cloud shell's credentials.
- 2026-10-22 The file-size cap is a ratchet against `origin/main` (ported from qyvr): a file already over 600 lines may
  not grow. Rejected: the flat cap, which blocks unrelated PRs when a file drifts over.
- 2026-10-22 A preview slot's lease lives in its own Durable Object (`PreviewLease`), never tombstoned, so a release
  that deletes the agent's objects keeps the row that decides who may release. Rejected: an R2 object, whose
  conditional writes the bucket wipe would have to step around.
- 2026-10-22 A preview slot is wiped by its placeholder's deploy, whose config tombstones the agent's Durable Object
  classes. Rejected: a per-lease `TENANT_ID`, which leaves the person-named objects reachable.
- 2026-10-22 The `workers.dev` subdomain of the preview pool is never committed (it names the account's owner):
  `FLETCH_PREVIEW_SUBDOMAIN`, or a git-ignored file `provision` writes. Rejected: custom domains under qyvr.dev, which
  would hand any `.qyvr.dev` cookie to a slot a session deployed.
- 2026-10-22 Muse owns execution: it runs the KICKOFF protocol through Claude Code, reviews and UATs the result and
  merges the PR and deploys previews (`docs/runbooks/muse-execution.md`); Kyle steers, does final UAT, accepts one-way
  doors, every Cloudflare change and the production go. Rejected: Muse
  as a second implementer, which would put two writers on one branch.
- 2026-10-22 F2 searches the entries `history()` draws, with no `LIKE` prefilter on `messages.body` (F2's first ruling
  named one): the thread also draws mailbox messages and a tool's announced words, which `messages` does not hold, and
  a `LIKE` over the JSON body misses escaped characters and non-ASCII case, so a prefilter could hide a match. Rejected:
  the prefilter, until Q4 measures the scan slow.
- 2026-10-22 `/app/search` caps a query's rows at 20 and keeps the recents at 8; a recent is ordered by its last
  connection, or its opening when no page has connected to it; a row matched by title alone carries the chat's own
  time (`lastAt`, the list row's), or its opening when it has none. Rejected: 20 recents, which the dialog never asked for.
- 2026-10-22 `test/fixtures/people.json` holds a second fictional member (`pat-solo`), so a claim about two people is
  tested with two members of the fixture. Rejected: a second identity made up inside a test.
- 2026-10-22 F3: a search row's time is "Just now", then minutes and hours within the last 24 hours, then the list's
  own Yesterday, weekday and date labels (`foundWhen` beside `lastLabel`); hours by elapsed time, not the calendar day,
  so a row's label never depends on when midnight fell. Rejected: the panel's `ago` (`5m`, `3h`, `2d`), which has no
  Yesterday or date.
- 2026-10-22 F3: the Search card gets the system's `qf-pop-out` at `--qf-dur-fast` on close, in parallel with its
  scrim: measured, the bundle's `.qf-scrim2>.qf-dialog` rules never reached it (the scrim holds `#search`, not the
  card), so the card had no exit and no enter. The enter stays as it was, as F3 says. Rejected: a pop-in too, which
  changes the enter motion.
- 2026-10-22 F3: Enter typed before a query's answer is drawn opens that answer's first row when it lands, never the
  rows still on screen from the previous query. Rejected: opening whatever is drawn, which can open a stale result.
- 2026-10-23 F4: the not-found page, and a grammar row reserved for a later part (Settings, the Library's collections),
  draw `#nowhere` with the path as text and a link home; the chat list still loads underneath so the link home opens
  the last chat at once. Settings' own entry points keep `show("settings")` until F5 gives them addresses.
- 2026-10-23 F5: an overlay's history entry carries `{ layer, set }` (its owner's marker, and Settings' depth repeated
  by every entry over it), and Settings' panes are only the panes the shell has, so the grammar's settings row lists
  them and `/settings/<anything else>` is the not-found page. Writes wait behind a pop of ours (`hist`), because a
  browser's `history.go` lands later. Rejected: a counter of pushes, which cannot tell a stray entry from its owner's.
- 2026-10-23 F6: the Library's collections are `COLLECTIONS` in `pages.ts`, one row each, so D-0009's reserved
  collection row is now the rule "a page only for a registered collection" and the artifact plan's `artifacts` is one
  entry (D-0010). A collection id is its segments decoded one by one (`segmentsOf`, with a copy in the page script that
  `test/workers/f6-library-address.test.ts` drives); a segment that is empty, `.`, `..`, a bad escape or decodes to a
  slash is no page, so two addresses never name one file. Rejected: a regex-only check, which cannot decode.
- 2026-10-23 F6: a fresh tab booted at a file address rebuilds `/library` beneath it (its entry marked
  `{ page: "file" }`, so a reload does not rebuild twice), as Settings does, and the viewer's Back is always
  `history.back()`. Rejected: Back as `go("/library")` when nothing is beneath, which pushes a second Library entry.
  The store names files in `[A-Za-z0-9._-]`, so a space or `#` in a segment is shown round-tripping to the Person's
  request and its `FILES_PATH_INVALID`, not to a stored file.
- 2026-10-23 F8: the chat made by the placeholder's first send is titled by the page in the one `POST /app/chats`
  that makes it (`promptTitle`: the prompt's words on one line, cut at a word within 60 characters with an ellipsis),
  so no rename follows and a rename always wins; a send with no words (attachments alone) keeps the Person's `New
  chat`. The message itself waits in the page (`held`) until the made chat's history frame is drawn, so it goes under
  the bubble already on screen instead of being marked lost by the fresh socket's history. Rejected: the `Chat`
  naming itself on its first message, which crosses into the Person's store from the send path; and sending before
  the history, which the page's own fresh-socket rule says is lost.
- 2026-10-24 F9 hover parity: a hover-revealed control (message actions, a chat row's time and kebab, a Library
  card's more button) is hidden at rest only under `(hover: hover) and (pointer: fine)` and shows by default, so it
  rests visible under `(hover: none)` and also on a hovering coarse pointer. Rejected: hiding by default and showing
  only under `(hover: none)`, which leaves a coarse hovering pointer with the control behind a hover. The served
  CSS's own sweep test (`test/workers/f9-hover-parity.test.ts`) refuses any ungated `:hover` reveal.
- 2026-10-24 F10: three reactions rulings. The pending question is the agent's last drawn message carrying `?`,
  its turn `done` with no code (or a running turn a reaction on it started, so a second reaction steers in) —
  the `ASKING` contract makes `?` the agent's convention and the engine holds no other state; if UAT shows misses,
  an explicit `awaiting_reply` marker on the turn replaces the test. The agent's reaction is set/replace, never
  toggle, because the outbox replays an effect after a crash and must land on one state; a `remove` flag would
  join the tool if one is needed. Reactions reach the model through the per-turn envelope (`chat:reactions`),
  never the stored transcript, because they change after the fact and the envelope is the unpersisted, replayed
  block. Rejected: per-message annotations in the transcript, and an unstored user message lost on replay.
- 2026-10-24 Reaction on an earlier question answers the pending one (Kyle's UAT call): the pending question
  stays the agent's last drawn message carrying `?`, but the reaction may be on any earlier agent question
  message — the agent re-asked it — and is delivered as the answer to the pending question; any other reaction
  stays ambient. A `chat.reaction` log line records the decision (answer vs ambient) so Workers Logs shows it.
  Confirming test: `test/workers/f10-reactions.test.ts` ("an earlier phrasing answers").
- 2026-10-24 The Company's own migrations create the grants tables (Kyle's UAT call): `COMPANY_MIGRATIONS`
  never included the grants schema, so a real Company object — whose constructor runs only its own list —
  had no `grants` table, and the approval step for a company-scoped card (`jobs_enable`) failed with
  "no such table: grants" on staging, leaving an agent-registered job off. The harness runs
  `HARNESS_MIGRATIONS` (every list) against one storage, so the missing entry never showed in tests.
  Confirming test: `test/workers/m25-3-migrations.test.ts` ("the Company's own list creates the grants
  tables its authority uses") — it builds a Company authority over only `COMPANY_MIGRATIONS` and creates
  a company grant, and fails with the staging error when the entry is removed.
- 2026-10-25 F11 task drawer, three reversible calls: the waiting tone's dot is `--text-tertiary`, not
  `--fill-tertiary`, because `--fill-tertiary` is the status pill's own ground in light and the dot vanished on it;
  the canvas's inferred phone rule that stacked `.qf-dlg--960 .qf-task` (two lines in the phone container block) is
  deleted, superseded by the drawer's one-pane rule (`.qf-task.is-detail`); the screenshot set lives beside its
  specimen (`packages/agent/src/design/fletch/ds/specimens/task-drawer/`) so the PR can show it. Confirming test:
  `test/workers/f11-activity-specimens.test.ts`.
- 2026-10-26 F12: five task-record rulings, each reversible inside `packages/agent/src/chat/activity.ts`. A chat's
  first turn anchors a task whatever began it, because a turn with no anchor before it has nothing to continue and
  dropping it would hide work (rejected: leaving it out of the list). `tasksOf` and `taskOf` take the chat's id, so a
  record names its chat without the route stitching it on. A waiting or running task has no `endedAt`: the latest
  turn ended, the task did not. `code` is the latest turn's code unless the task is done or running. `groups` is the
  delegation groups the task's turns launched (the outbox's `delegate` rows, through the one `delegationGroup`) or
  received (`internal_handoff` mailbox rows). Confirming test: `test/workers/f12-activity-tasks.test.ts`.
- 2026-10-26 F13: the step timeline's readings where the part left a choice. The journal join matches
  `<chatId>:<callId>` and `<chatId>:<callId>:decision`, because `chat/approvals.ts` writes every row id under its
  chat (rejected: a bare `callId`, which matches nothing; a suffix match, which would join another chat's call with
  the same id); the latest row decides the state, so a declined card is `refused` after its `PENDING` proposal. A
  call with journal rows is an `action` step titled by its card's label (the tool's name in words, as
  `ChatEngine.approvals` labels cards) — the engine is at its 600-line cap, so no registry lookup on the read path.
  A waiting step's code is null (its words say it waits) rather than `PENDING`. The todo title adds the next open
  item after the counts ("…; next: <item>"), so the item's own characters are in the title as data (rejected: counts
  alone, which leaves the part's markup claim nothing to hold). The summary step is present once a task's turn has
  finished without awaiting a decision (rejected: a summary of a running or waiting task, which would read as done,
  D-0001). `stepCount` now counts steps (every call but `send_to_user` and `react`) and `capped` is
  `stepCount > STEPS_PER_TASK`, so the list row and the timeline agree. `StepDetail` is `{ prose, blocks, result,
  lines, files, cut }` (the plan's §(b.4) was not in the session's checkout; F16 completes the per-kind shapes).
  Confirming test: `test/workers/f13-activity-steps.test.ts`.
- 2026-10-26 F14: the half built from the parent's rows, where the part left a choice. The second member is Pat
  (`pat-solo`), since `test/fixtures/people.json` has no Bo (rejected: adding an identity). `chatTask` takes the
  chat's `SubAgentRows` as a required argument, so the `Chat` object cannot forget its record (rejected: an optional
  one answering `subagents: []`, which would read as "no delegations"; the engine is at its 600-line cap). Sections
  follow `task.groups` sorted by their first row's `created_at`; the launch step is matched by
  `groupIdOf(step.turnId, step.callId)`; the verdict step goes after the launch turn's steps, before the first later
  step started at or after `handed_off_at`, else before the marker and summary, with one title naming each request's
  verdict (a failed one's `failed (<CODE>)`, since the verifier checks only what returns to the main agent). The
  child's steps waited on D-0011 (Q8) and are the next line. Confirming test:
  `test/workers/f14-activity-subagents.test.ts`.
- 2026-10-26 F14, the transcript half after Kyle accepted D-0011. `SubAgentRows` gains `transcript(id)`, the facet's
  one read through `Chat.facet`, which the run transport shares. A row is read only when its stored `person` is the
  requester (else `SUBAGENT_NOT_YOURS`, the host's code for the same ownership refusal), a read that throws is
  `SUBAGENT_STEPS_UNAVAILABLE`, and a queued row answers `[]` without a read, since it has not run and a read would
  make its facet (rejected: reading it, which creates storage for nothing). A child has no journal, so a call its gate
  refused (the result's `details.code`, `subAgentGate`) is `refused` with that code and titled "…: not done (<CODE>)"
  as a parent's refused action is (rejected: F13's reading, which shows the refusal as done, against D-0001).
  "Handed off" (kind `handoff`) is the last assistant text of a `done` child's transcript; a failed child has none.
  `tasksOf` in `activity-steps.ts` reads a coordinator's `briefs` as workers', so its own launch step is titled from
  them. Confirming test: `test/workers/f14-activity-subagents.test.ts`.
- 2026-10-29 The pare-down (parity framework v2, §5.1): the plan moved to `docs/plan-v2/` (`docs/plan/` deleted;
  D-0012 supersedes D-0006 on the new paths), `docs/runbooks/muse-execution.md` deleted (the orchestrator is the
  loop's subject, design §3), nine Muse-era briefs deleted (the three reactions briefs stay until F20 has used them),
  F0–F17 closed in `PROGRESS.md` with F7, F16 and F17 folded into P1 and P5, Q7 and Q4 closed, the delegation-kernel
  note and the hosted-isolation brief committed under `docs/plan-v2/`, `VISION.md` reworded for the spine, and
  `scripts/check-agent-docs.mjs` repointed at `docs/plan-v2/`. Rejected: keeping `docs/plan/` beside the new folder
  (two plans), and rewriting the briefs as contracts now (they are re-derived by interrogation when a cluster needs
  them).
- 2026-10-29 Kyle's answers to the framework's open decisions (design §10): O1 one private repository with evidence in
  `docs/plan-v2/evidence/` (D-0013); O2 the default; O5 wallet and payments are spine (P12, own milestone) and
  shopping, booking, travel, tickets are P16, by pick; O6 connector types and flows are spine (P9 core), specific
  connectors per agent; O9 agreed in principle, the record comes with F19. O4 (P8) stays open. The sibling
  `fletch-parity` repository and the `FLETCH_PARITY_DIR` variable are gone from the plan.
- 2026-10-29 O4 narrowed with Kyle: P8's side chats are P1 (a chat with its own transcript that a job can deliver to)
  and its workers are P3 and P7 (the agent a job or hook spawns, and its completion report), all spine; P8 keeps only
  group chats with outsiders, mapped and not built until Kyle rules whether fletch ever speaks in a room.
- 2026-10-29 The orchestrator framing, on a fresh Fable reviewer's note (reframe, not replace one open-ended goal):
  `docs/plan-v2/ORCHESTRATOR.md` (its own `/goal`, 3,300 characters, and the restart wrapper), `WAITING-ON-KYLE.md`,
  `scripts/check-plan.mjs` in `pnpm harness` (a scorecard level of 2 or more cites an existing evidence file and a PR;
  every part from F21 names an existing contract file), and Q9 answered as option (a) by Kyle in this session.
  Rejected: one long-running open-ended goal in a single session (the evaluator reads only the transcript, stops a
  waiting session, and Locked needs Kyle's UAT); the orchestrator editing the scorecard directly (it lands as a PR).
- 2026-10-29 The orchestrator goal made permissive on Kyle's read: the budget, time and three-strikes stops, the
  two-builder cap, the owner-visible-surface merge rule and the per-cluster `go` before interrogating Muse are gone;
  the orchestrator uses its own judgement and records it in the ledgers, and Kyle watches. The hard lines stay
  (one-way doors, Kyle's own commits, guard-rail files, secrets, redaction before storage, previews only, no red
  merges). Rejected: keeping the caps as defaults the orchestrator may raise (a cap it may raise is a prompt, not a
  guard, and reads as a stop).
- 2026-10-29 Back to a public repository within the hour: the private one (D-0013) could not run CI (Actions billing
  refused the job). D-0014: evidence git-ignored under `docs/plan-v2/evidence/` on Kyle's Mac, its README and the
  content-free tier-2 `results/` tracked so `check-plan` still holds a scorecard row to a results file in CI. The
  superseded Muse spec's line naming three of Kyle's killed watches now names them generically, since it is public.
- 2026-10-29 Surfaces follow muse.ai (design §4.5, Kyle): the browser capture is also the design capture, the
  Translate stage makes a `ds/specimens/` specimen that reproduces the muse.ai surface in fletch's tokens, and the
  orchestrator lists it for Kyle's look before any builder draws it. Not parity: Muse's name, brand, voice. Earlier
  design artifacts are not inputs. Rejected: fletch's design system interpreting Muse's surfaces freely (a second
  design loop beside the RE loop).
- 2026-10-29 F18, the trace: an asserted field of a trace (`test/support/trace.ts`) is a token, no whitespace and at most
  80 characters, or an enum value; prose is allowed only in `failure.user_words` and `examples[]`. `defineScenario`
  emits one trace per run with one step (what the turns added, the failure by code) when `QYVR_TRACE_DIR` is set.
  Rejected: a step per turn (the runner sees the turns as one function today; a per-turn trace comes with the cluster
  that needs it), and a looser prose rule by length alone (a short sentence is still a sentence).
- 2026-10-29 F18, tasks as code: a task is `defineTask()` in `test/evals/<cluster>/<task>.task.ts`, pure and importable
  by node, and a `.test.ts` beside it calls `runTask()`; `versionHash` covers every field and each grader's name, kind
  and source with comments and whitespace removed. Rejected: declarative graders only (a hash that misses the grader's
  code is not a scorer baseline), and registering under vitest from the task file (F19 could not import it).
- 2026-10-29 F18, the redaction gate allowlists by field name (`ALLOWLIST` and the `_id`/`_at` suffixes in
  `scripts/redact-capture.mjs`) and strips the rest to a shape; a request `path` keeps its path and loses its query
  (a setup link rides there). Rejected: an allowlist by value shape (an id and a short message look alike).
- 2026-10-29 orchestrator, builders run in the Terminal panel as `claude --permission-mode auto -p "<the /goal line>"`
  from a worktree on `main`, one per preview slot; an app-started session did not register the `/goal` as a goal, the
  terminal run does (the transcript shows `Goal set`, the Stop hook and the evaluator's verdicts). Rejected:
  `--dangerously-skip-permissions` (refused by the app's classifier) and app sessions (no goal evaluator).
- 2026-10-29 P1 interrogation: a dedicated Muse side chat is the instrument (one thread, steps A to F and a reload),
  never Kyle's main chat or sidebar, so no capture holds his content; raw captures wait in the session scratchpad
  until the redaction gate exists and are stored only after `pnpm redact` (25 files, 0 failed). Request bodies are not
  recorded: every chat action multiplexes through one endpoint and an auth endpoint's body carried a token.
- 2026-10-29 P1 translation (`docs/plan-v2/contracts/P1-reactions.md`, deltas 1 to 5 and 7 kept as shipped): fletch
  wakes the agent for a reaction only on a pending question and shows ambient reactions in the next envelope, where
  Muse starts a turn per reaction with a no-reply escape; `react` keeps its optional target; rows are per (message,
  reactor); removal deletes; the care register is 🫶. Rejected: a wake per reaction (model spend per ambient reaction,
  and nothing observable gained). Delta 6 (a person can react to their own message at phone width) is a finding and a
  part of its own (F21), not a change inside the dry run.
- 2026-10-29: builder sessions (the terminal `claude -p "/goal …"` runs) use `--model opus` from now on, at Kyle's word in the
  orchestrator session; the running F19 builder stays on the model it started with. The orchestrator itself keeps its own
  model. Rejected: editing `GOAL-PROMPT.md`'s loop line (off-limits to the orchestrator; the flag rides on the command).
- 2026-10-29: a specimen is published rendered, as a claude.ai artifact with the tokens and the bundle inlined (the app's
  file pane and the built-in browser serve a local file without its stylesheets), and the `look` item links that page;
  the source stays `ds/specimens/`. Kyle's look never blocks a part: the builder ships the surface and his findings land
  as UAT on it (Kyle, 2026-10-29). Rejected: holding F21 for the look (a day's latency on every surface for no gain).
- 2026-10-29 F19, the tier-2 runner lives in `scripts/evals/` with its slot client, and the world a tier-2 grader sees
  (`SlotWorld`, `InfraError`, `TurnError`) in `test/support/evals.ts` so a task file imports no script. A trial stops
  at its first infra failure and the task's verdict is `infra`; a `fail` anywhere is `fail`; `pass` needs all three.
  The baseline is the last pass or fail for the same hash, so an infra run moves nothing. A results file uses only
  keys on the redaction gate's allowlist (`task_id`, `version_hash`, `preview_slot`, `trial_id`, `status`, `code`,
  `rule`, `state`, `*_at`), so `pnpm redact` over it is a no-op. Rejected: retrying an infra trial (no retries,
  KICKOFF.md), counting two passes out of three as a pass (the design says every trial), and widening the gate's
  allowlist for the runner's own words (a gate that grows for its reader is softer for every reader).
- 2026-10-29 F19, the runner's session on a slot is the live exit test's software passkey, kept with its material
  beside the lease file (`evals-<tag>.json`, mode 600) so a later run signs in instead of needing the one-time setup
  token again; a fresh lease registers anew. Rejected: a session cookie alone (thirty days, then no way back in) and a
  second registration route (the host's login contract is published, a one-way door).
