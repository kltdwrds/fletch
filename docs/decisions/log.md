# Decision log

Two-way doors: dated one-liners with their reason, for choices nobody else has to obey. When a line starts mattering
to others, promote it into a record (README.md) and delete it here. Capped at 40 KB by `scripts/check-decisions.mjs`.

- 2026-10-20 WebAuthn uses `@simplewebauthn/server` 14.0.3: it bundles under `nodejs_compat`, so no hand-rolled
  fallback.
- 2026-10-20 `@noble/hashes` 2.4.0 provides synchronous SHA-256 in the passkey stores.
- 2026-10-20 `create-fletch` sets `MASTER_KEY` and `SETUP_TOKEN` (32 random bytes, base64url) each only when the Worker
  lacks it: a fresh account gets two secret puts, a second run none (D-0002).
- 2026-10-22 `pnpm check` is the fast gate (lint, harness checks and scans, typecheck; about 20 s, the pre-push hook);
  `pnpm verify` adds the tests (CI and the release). Rejected: tests in the pre-push hook, too slow and refused beside a
  cloud shell's credentials.
- 2026-10-22 The file-size cap is a ratchet against `origin/main` (from qyvr): a file over 600 lines may not grow.
  Rejected: the flat cap, which blocks unrelated PRs when a file drifts over.
- 2026-10-22 A preview slot's lease lives in its own Durable Object (`PreviewLease`), never tombstoned, so a release
  deleting the agent's objects keeps the row deciding who may release. Rejected: an R2 object, whose conditional writes
  the bucket wipe would have to step around.
- 2026-10-22 A preview slot is wiped by its placeholder's deploy, whose config tombstones the agent's Durable Object
  classes. Rejected: a per-lease `TENANT_ID`, which leaves the person-named objects reachable.
- 2026-10-22 The preview pool's `workers.dev` subdomain is never committed (it names the account's owner):
  `FLETCH_PREVIEW_SUBDOMAIN`, or a git-ignored file `provision` writes. Rejected: custom domains under qyvr.dev, which
  hand any `.qyvr.dev` cookie to a session's slot.
- 2026-10-22 F2 searches the entries `history()` draws, with no `LIKE` prefilter on `messages.body` (F2's first ruling
  named one): the thread also draws mailbox messages and tool words `messages` lacks, and a `LIKE` over JSON misses
  escaped characters and non-ASCII case, so it could hide a match. Rejected: the prefilter, until Q4 measures the scan
  slow.
- 2026-10-22 `/app/search` caps a query at 20 rows and the recents at 8; a recent is ordered by its last connection,
  else its opening; a title-only match carries the chat's time (`lastAt`, the list row's), else its opening. Rejected:
  20 recents, which the dialog never asked for.
- 2026-10-22 `test/fixtures/people.json` holds a second fictional member (`pat-solo`), for two-person claims. Rejected:
  an identity made up inside a test.
- 2026-10-22 F3: a search row's time is "Just now", then minutes and hours within 24 hours, then the list's Yesterday,
  weekday and date labels (`foundWhen` beside `lastLabel`); hours are elapsed, so a label never depends on when midnight
  fell. Rejected: the panel's `ago` (`5m`, `3h`, `2d`), which has no Yesterday or date.
- 2026-10-22 F3: the Search card gets the system's `qf-pop-out` at `--qf-dur-fast` on close, alongside its scrim: the
  bundle's `.qf-scrim2>.qf-dialog` rules never reached it (the scrim holds `#search`, not the card). The enter stays as
  F3 says. Rejected: a pop-in too, which changes the enter motion.
- 2026-10-22 F3: Enter typed before a query's answer is drawn opens that answer's first row when it lands, never the
  previous query's rows. Rejected: opening whatever is drawn, which can open a stale result.
- 2026-10-23 F4: the not-found page, and a grammar row reserved for a later part (Settings, the Library's collections),
  draw `#nowhere` with the path as text and a link home, the chat list loading underneath so the link opens the last
  chat at once. Settings' entry points keep `show("settings")` until F5 gives them addresses.
- 2026-10-23 F5: an overlay's history entry carries `{ layer, set }` (its owner's marker, and Settings' depth repeated
  by every entry over it); Settings' panes are only the shell's, so the settings row lists them and
  `/settings/<anything else>` is the not-found page. Writes wait behind a pop of ours (`hist`), since `history.go` lands
  later. Rejected: a push counter, which cannot tell a stray entry from its owner's.
- 2026-10-23 F6: the Library's collections are `COLLECTIONS` in `pages.ts`, so D-0009's reserved collection row is now
  "a page only for a registered collection" and the artifact plan's `artifacts` is one entry (D-0010). A collection id
  is its segments decoded one by one (`segmentsOf`, copied in the page script `test/workers/f6-library-address.test.ts`
  drives); an empty segment, `.`, `..`, a bad escape or a decoded slash is no page, so two addresses never name one
  file. Rejected: a regex-only check, which cannot decode.
- 2026-10-23 F6: a fresh tab booted at a file address rebuilds `/library` beneath it (its entry marked
  `{ page: "file" }` so a reload does not rebuild twice), as Settings does; the viewer's Back is always
  `history.back()`. Rejected: Back as `go("/library")` when nothing is beneath, which pushes a second Library entry. The
  store names files in `[A-Za-z0-9._-]`, so a space or `#` in a segment round-trips to the Person's
  `FILES_PATH_INVALID`.
- 2026-10-23 F8: the chat made by the placeholder's first send is titled by the page in the one `POST /app/chats` that
  makes it (`promptTitle`: the prompt's words on one line, cut at a word within 60 characters, with an ellipsis), so no
  rename follows and a rename always wins; a send with no words keeps the Person's `New chat`. The message waits in the
  page (`held`) until the new chat's history frame is drawn, so the fresh socket's history does not mark it lost.
  Rejected: the `Chat` naming itself on its first message, which crosses into the Person's store from the send path; and
  sending before the history, which the fresh socket loses.
- 2026-10-24 F9 hover parity: a hover-revealed control (message actions, a row's kebab, a card's more button) is hidden
  at rest only under `(hover: hover) and (pointer: fine)`, so it rests visible under `(hover: none)` and on a hovering
  coarse pointer. Rejected: hiding by default and showing only under `(hover: none)`, which hides it from a coarse
  hovering pointer. The served CSS's sweep test (`test/workers/f9-hover-parity.test.ts`) refuses any ungated `:hover`
  reveal.
- 2026-10-24 F10: three reactions rulings. The pending question is the agent's last drawn message carrying `?`, its turn
  `done` with no code (or a running turn a reaction on it started, so a second reaction steers in): per the `ASKING`
  contract, the engine holding no other state; an `awaiting_reply` marker replaces the test if UAT shows misses. The
  agent's reaction is set/replace, never toggle, since the outbox replays an effect after a crash and must land on one
  state (a `remove` flag if needed). Reactions reach the model through the per-turn envelope (`chat:reactions`), the
  unpersisted, replayed block, never the stored transcript, since they change after the fact. Rejected: per-message
  annotations in the transcript, and an unstored user message lost on replay.
- 2026-10-24 Reaction on an earlier question answers the pending one (Kyle's UAT call): a reaction on any earlier agent
  question (the agent re-asked it) is delivered as the pending question's answer; any other stays ambient. A
  `chat.reaction` log line records which, for Workers Logs. Confirming test: `test/workers/f10-reactions.test.ts` ("an
  earlier phrasing answers").
- 2026-10-24 The Company's own migrations create the grants tables (Kyle's UAT call): `COMPANY_MIGRATIONS` lacked the
  grants schema, so a real Company object (whose constructor runs only its own list) had no `grants` table, and
  approving a company-scoped card (`jobs_enable`) failed with "no such table: grants" on staging. The harness runs
  `HARNESS_MIGRATIONS` (every list) on one storage, which hid it. Confirming test:
  `test/workers/m25-3-migrations.test.ts` ("the Company's own list creates the grants tables its authority uses"), over
  only `COMPANY_MIGRATIONS`.
- 2026-10-25 F11 task drawer, three reversible calls: the waiting tone's dot is `--text-tertiary`, not
  `--fill-tertiary`, the status pill's ground in light, where the dot vanished; the canvas's inferred phone rule
  stacking `.qf-dlg--960 .qf-task` is deleted for the drawer's one-pane rule (`.qf-task.is-detail`); the screenshot set
  lives beside its specimen (`packages/agent/src/design/fletch/ds/specimens/task-drawer/`) for the PR. Confirming test:
  `test/workers/f11-activity-specimens.test.ts`.
- 2026-10-26 F12: five task-record rulings, each reversible inside `packages/agent/src/chat/activity.ts`. A chat's first
  turn anchors a task whatever began it (rejected: leaving it out of the list, which hides work). `tasksOf` and `taskOf`
  take the chat's id, so a record names its chat itself. A waiting or running task has no `endedAt`. `code` is the
  latest turn's code unless the task is done or running. `groups` is the delegation groups the task's turns launched
  (the outbox's `delegate` rows, through the one `delegationGroup`) or received (`internal_handoff` mailbox rows).
  Confirming test: `test/workers/f12-activity-tasks.test.ts`.
- 2026-10-26 F13: the step timeline's readings. The journal join matches `<chatId>:<callId>` and
  `<chatId>:<callId>:decision`, as `chat/approvals.ts` writes them (rejected: a bare `callId`, which matches nothing; a
  suffix match, which joins another chat's call); the latest row decides, so a declined card is `refused` after its
  `PENDING` proposal. A call with journal rows is an `action` step titled by its card's label (as `ChatEngine.approvals`
  does; the engine's 600-line cap bars a registry lookup). A waiting step's code is null, not `PENDING`. The todo title
  adds the next open item after the counts ("…; next: <item>") as data (rejected: counts alone). The summary step
  appears once a task's turn finishes without awaiting a decision (rejected: one for a running or waiting task, which
  reads as done, D-0001). `stepCount` counts every call but `send_to_user` and `react`, and `capped` is
  `stepCount > STEPS_PER_TASK`, so list row and timeline agree. `StepDetail` is
  `{ prose, blocks, result, lines, files, cut }` (F16 completes the per-kind shapes). Confirming test:
  `test/workers/f13-activity-steps.test.ts`.
- 2026-10-26 F14, the parent's half. The second member is Pat (`pat-solo`): `test/fixtures/people.json` has no Bo
  (rejected: adding an identity). `chatTask` takes the chat's `SubAgentRows` as a required argument, so the `Chat`
  object cannot forget its record (rejected: an optional one, whose `subagents: []` reads as "no delegations"). Sections
  follow `task.groups` by their first row's `created_at`; the launch step is matched by
  `groupIdOf(step.turnId, step.callId)`; the verdict step goes after the launch turn's steps, before the first step
  started at or after `handed_off_at`, else before the marker and summary, titled with each request's verdict (a failed
  one's `failed (<CODE>)`). The child's steps waited on D-0011 (Q8). Confirming test:
  `test/workers/f14-activity-subagents.test.ts`.
- 2026-10-26 F14, the transcript half after Kyle accepted D-0011. `SubAgentRows` gains `transcript(id)`, the facet's one
  read through `Chat.facet`. A row is read only for its stored `person` (else `SUBAGENT_NOT_YOURS`), a throwing read is
  `SUBAGENT_STEPS_UNAVAILABLE`, and a queued row answers `[]` unread (rejected: reading it, which creates its facet's
  storage for nothing). A child has no journal: a call its gate refused (the result's `details.code`, `subAgentGate`) is
  `refused` with that code, titled "…: not done (<CODE>)" (rejected: F13's reading, which shows it done, against
  D-0001). "Handed off" (kind `handoff`) is the last assistant text of a `done` child's transcript; a failed child none.
  `tasksOf` in `activity-steps.ts` reads a coordinator's `briefs` as workers', titling its launch step from them.
  Confirming test: `test/workers/f14-activity-subagents.test.ts`.
- 2026-10-29 The pare-down (framework §5.1): the plan moved to `docs/plan-v2/` (`docs/plan/` deleted; D-0012 supersedes
  D-0006 on the new paths), `docs/runbooks/muse-execution.md` and nine Muse-era briefs deleted (the three reactions
  briefs stay until F20), F0–F17 closed in `PROGRESS.md` with F7, F16 and F17 folded into P1 and P5, Q7 and Q4 closed,
  the delegation-kernel note and hosted-isolation brief committed under `docs/plan-v2/`, `VISION.md` reworded for the
  spine, `scripts/check-agent-docs.mjs` repointed at `docs/plan-v2/`. Rejected: keeping `docs/plan/` beside it (two
  plans), and rewriting the briefs as contracts now (interrogation re-derives them).
- 2026-10-29 Kyle's answers to the framework's open decisions (§10): O1 one private repository, evidence in
  `docs/plan-v2/evidence/` (D-0013); O2 the default; O5 wallet and payments are spine (P12), shopping, booking, travel,
  tickets P16, by pick; O6 connector types and flows are spine (P9 core), specific connectors per agent; O9 agreed in
  principle, the record with F19. O4 (P8) open. The sibling `fletch-parity` repository and `FLETCH_PARITY_DIR` are gone
  from the plan.
- 2026-10-29 O4 narrowed with Kyle: P8's side chats are P1 and its workers P3 and P7, all spine; P8 keeps only group
  chats with outsiders, mapped and not built until Kyle rules whether fletch ever speaks in a room.
- 2026-10-29 The orchestrator framing, on a Fable reviewer's note: `docs/plan-v2/ORCHESTRATOR.md` (its own `/goal` and
  the restart wrapper), `WAITING-ON-KYLE.md`, `scripts/check-plan.mjs` in `pnpm harness` (a scorecard level of 2 or more
  cites an existing evidence file and a PR; every part from F21 names an existing contract file), and Q9 answered (a) by
  Kyle. Rejected: one open-ended goal in a single session (the evaluator reads only the transcript and stops a waiting
  session); the orchestrator editing the scorecard directly (it lands as a PR).
- 2026-10-29 The orchestrator goal made permissive (Kyle): the budget, time and three-strikes stops, the two-builder
  cap, the owner-visible-surface merge rule and the per-cluster `go` are gone; the orchestrator's judgement goes in the
  ledgers. The hard lines stay (one-way doors, Kyle's own commits, guard-rail files, secrets, redaction before storage,
  previews only, no red merges). Rejected: caps it may raise (a prompt, not a guard, that reads as a stop).
- 2026-10-29 Back to a public repository within the hour: the private one (D-0013) could not run CI. D-0014: evidence
  git-ignored under `docs/plan-v2/evidence/` on Kyle's Mac, its README and the content-free tier-2 `results/` tracked so
  `check-plan` still ties a scorecard row to a results file in CI. The superseded Muse spec no longer names Kyle's
  killed watches.
- 2026-10-29 Surfaces follow muse.ai (design §4.5, Kyle): the Translate stage makes a `ds/specimens/` specimen of the
  muse.ai surface in fletch's tokens, and the orchestrator lists it for Kyle's look before a builder draws it. Not
  parity: Muse's name, brand, voice. Earlier design artifacts are not inputs. Rejected: fletch's design system
  interpreting Muse's surfaces freely (a second design loop).
- 2026-10-29 F18, the trace: an asserted field of a trace (`test/support/trace.ts`) is a token (no whitespace, at most
  80 characters) or an enum value; prose only in `failure.user_words` and `examples[]`. `defineScenario` emits one trace
  per run with one step when `QYVR_TRACE_DIR` is set. Rejected: a step per turn (the runner sees the turns as one
  function), and a length-only prose rule.
- 2026-10-29 F18, tasks as code: a task is `defineTask()` in `test/evals/<cluster>/<task>.task.ts`, pure and importable
  by node, with a `.test.ts` beside it calling `runTask()`; `versionHash` covers every field and each grader's name,
  kind and source minus comments and whitespace. Rejected: declarative graders only (the hash would miss the grader's
  code), and registering under vitest from the task file (F19 could not import it).
- 2026-10-29 F18, the redaction gate allowlists by field name (`ALLOWLIST` and the `_id`/`_at` suffixes in
  `scripts/redact-capture.mjs`) and strips the rest to a shape; a request `path` loses its query (a setup link rides
  there). Rejected: an allowlist by value shape (an id and a short message look alike).
- 2026-10-29 orchestrator, builders run in the Terminal panel as `claude --permission-mode auto -p "<the /goal line>"`
  from a worktree on `main`, one per preview slot: an app-started session did not register the `/goal`, the terminal run
  does (`Goal set`, the Stop hook, the evaluator's verdicts). Rejected: `--dangerously-skip-permissions` (refused by the
  app's classifier) and app sessions (no goal evaluator).
- 2026-10-29 P1 interrogation: a dedicated Muse side chat, never Kyle's main chat, so no capture holds his content; raw
  captures were stored only after `pnpm redact` (25 files, 0 failed). Request bodies are not recorded (an auth
  endpoint's body carried a token).
- 2026-10-29 P1 translation (`docs/plan-v2/contracts/P1-reactions.md`, deltas 1 to 5 and 7 kept as shipped): fletch
  wakes the agent for a reaction only on a pending question and shows ambient ones in the next envelope (Muse starts a
  turn per reaction); `react` keeps its optional target; rows are per (message, reactor); removal deletes; the care
  register is 🫶. Rejected: a wake per reaction (model spend for nothing observable). Delta 6 (reacting to one's own
  message at phone width) is its own part (F21).
- 2026-10-29: builder sessions (the terminal `claude -p "/goal …"` runs) use `--model opus` from now on, at Kyle's word;
  the running F19 builder and the orchestrator keep theirs. Rejected: editing `GOAL-PROMPT.md`'s loop line (off-limits
  to the orchestrator; the flag rides on the command).
- 2026-10-29: a specimen is published rendered, as a claude.ai artifact with the tokens and bundle inlined (a local file
  is served without its stylesheets), and the `look` item links it; the source stays `ds/specimens/`. Kyle's look never
  blocks a part: his findings land as UAT on the shipped surface. Rejected: holding F21 for the look (a day's latency
  per surface).
- 2026-10-29 F19, the tier-2 runner lives in `scripts/evals/` with its slot client, and the world a tier-2 grader sees
  (`SlotWorld`, `InfraError`, `TurnError`) in `test/support/evals.ts`, so a task file imports no script. A trial stops
  at its first infra failure and the verdict is `infra`; a `fail` anywhere is `fail`; `pass` needs all three. The
  baseline is the last pass or fail for the same hash. A results file uses only allowlisted keys (`task_id`,
  `version_hash`, `preview_slot`, `trial_id`, `status`, `code`, `rule`, `state`, `*_at`), so `pnpm redact` over it is a
  no-op. Rejected: retrying an infra trial (KICKOFF.md), two passes of three as a pass, and widening the allowlist for
  the runner (softer for every reader).
- 2026-10-29 F19, the runner's session on a slot is the live exit test's software passkey, kept beside the lease file
  (`evals-<tag>.json`, mode 600) so a later run signs in without the one-time setup token; a fresh lease registers anew.
  Rejected: a session cookie alone (thirty days) and a second registration route (the published login contract, a
  one-way door).
- 2026-10-29 P2 translation, five two-way deltas from Muse's loop (`docs/plan-v2/contracts/P2-loop.md`): (1) the
  operating block stays a byte-identical prefix, the date in the never-stored envelope (prompt caching); rejected a
  dated system row per turn. (2) one streamed bubble per reply, no `message_break` split; `send_to_user` stays the
  deliberate early message; rejected holding the reply to split it. (3) a mid-turn message folds into the running turn
  at the next step boundary under `STEER_POLICY`; rejected ending the turn for a new one with an interruption note. (4)
  a job's terminal result wakes the agent through the delegation handoff path, an empty reply allowed, the notice row
  kept (today it wakes nobody); rejected a push into a running step. (5) no URL unfurl (an egress per link); a link to a
  stored file draws a file card; rejected fetching previews through the Worker.
- 2026-10-29 F23, from pinning P2: a `tool_search` load's result names the functions it loaded
  (`loaded probe: callable from your next step (probe_run)`, `packages/agent/src/tools/search.ts`), T-P2-01's required
  fact; rejected leaving the names to the reference. The print refusal T-P2-09 grades, `HOST_PRINT_UNAVAILABLE`, is a
  test-host fixture's code (`test/support/p2-fixtures.ts`), not a `HostFeature`, which would change `@qyvr/host`'s
  published contract.
- 2026-10-29 F24, the thread shows the work: the status line comes from a `status` frame carrying only the running
  tool's name (`packages/agent/src/chat/turn.ts`; `tool: null` when it returns), worded by `STATUS_WORDS`
  (`packages/agent/src/http/app/thread-work.ts`); rejected sending the call's arguments, model-written text B-P2-04
  bars. A file link is a markdown link to `files/<path>` (taught in `file_write`'s description; the viewer's
  `/library/files/<path>` is read too), drawn as a card, its preview through `GET /app/file`; rejected an attachment row
  (B-P2-10). A job's new notice wakes the agent through `ChatEngine.handoff`, keyed on the notice id and scoped
  `job:<id>`, carrying the job's newest finished run (`chat/job-wake.ts`); mail wakes no one; rejected carrying the
  outcome through the Person's delivery (a stored-shape change). T-P2-03's grader admits the `status` frames before the
  words and T-P2-07's asks for the card, both hashes refreshed in `contracts/P2-loop.md`.
- 2026-10-29 F24, T-P2-13's graders after its first runs: the end_state pattern (`NOT_THERE`) takes "there's no file
  called …" and "couldn't find …", the reference's wording, which the first pattern failed on three honest replies;
  `empty_success` (`EMPTY_FILE`) is the file said to be empty, not "the workspace is empty", which is true. Both are
  held on real replies and planted failures in `test/evals/p2-loop/real-model-failure-honest.test.ts`; the failed runs'
  results files stay. Rejected steering the model's wording to fit the pattern. T-P2-12's graders read socket frames the
  slot world does not keep (`GRADER_THREW`), a runner gap, not a verdict on the agent.
- 2026-10-29 orchestrator, F24 merged while BLOCKED on Q16: PR #36 went to main on green CI with `ACCEPT F24: PASS` and
  T-P2-13 3 of 3, its PROGRESS row BLOCKED and Q16 open for Kyle (the two grader edits read as corrections; his steer is
  ship and review); P2 stays at level 1 until he answers. Rejected holding the PR, which keeps its work off main for
  nothing.
- 2026-10-29 orchestrator, P15 translated (`docs/plan-v2/contracts/P15-approvals.md`, eight deltas, no one-way door): a
  card does not block the turn and never expires (Muse's times out at ten minutes); rejected an expiry, which lets the
  clock settle an ask the person never saw. A bot check is `BROWSE_BOT_WALL`, refused by name and remembered; a memory
  line never grants solving; rejected a solving path, outside the product. No side chats, workers or discretion file
  (another person only via their agent; P3, P9). A decided card keeps its words in the thread. No cross-chat review bar
  or permissions tool until UAT or a tier-2 miss asks. fletch's choices (once, 30 days, always, decline) stay its own.
  Stop stays as M24.2 built it. Parts F25 (contract check, tier 1) and F26 (nothing goes around a card; tier 2).
- 2026-10-29 A failed allow-once tells the model why: the note fences the action's reason after its code
  (`chat/approvals.ts`), so a fill refused on another host says the host is not listed. T-P15-07's required fact holds
  it (F25). Rejected: the code alone, which left the model guessing.
- 2026-10-30 F26, tier 1 of nothing goes around a card: the browse lane types only a stored credential, so T-P15-05's
  "same share through the browse tool" is `browse_fill` aimed at host A's page, a new proposal and so a card (the
  declined fingerprint is the share's), proposed in one step with the share to host B since a card ends the turn. A
  rate-limit stop's reason says the site's own wait ("It asked for 120 seconds before another request",
  `browse/read.ts`), not waited out. The reply's words at a bot check, rate limit and decline are the `STOPS` lines
  (`chat/instructions.ts`), which grant nothing. Three F25 task files corrected before their first run, hashes refreshed
  in `contracts/P15-approvals.md`: T-P15-05's and T-P15-12's collateral lists what their graders require; T-P15-08's
  prompt gives `https://walled.example.test/`, since a bare host is not an address the person wrote
  (`BROWSE_URL_NOT_VERBATIM`). Rejected: loosening the verbatim rule for one task.
- 2026-10-30, F26 tier 2: the P15 tier-2 tasks run on a preview slot's test host (`scripts/preview-slot/test-host.mjs`),
  which subclasses the agent's `Chat` through two inert protected seams (`browserBinding`, `moreNamespaces`) for fixture
  sites and the share fixture, and answers `/__preview/test-host` only to the lease's holder; the runner drives `decide`
  events beside prompts. Rejected: an env-var switch in the agent, which ships a test path in every owner's deploy.
- 2026-10-30, F26 tier 2: a chat step pausing on cards with no words beside its calls gets one code-written line per
  card, "Waiting for your decision: <action>. It has not run yet." (`pauseWords`, M19.2's rule for a tool's own words):
  on the slot the model mostly proposed the share bare, even with a sharpened instruction, leaving a card and no reply.
  T-P15-13's `claimed_sent` also strikes "never sent" and "nothing was sent" before reading a claim (hash e729bad9eda2 →
  51dd5dcb091a). Rejected: one more tool-less model step after a bare pause, which changes the turn loop; and grading
  the card's status line as a reply, which weakens the task. Tension: the part says reply words are instruction lines;
  this one is code's, as a card's own status is.
- 2026-10-30, P6 memory translated (`docs/plan-v2/contracts/P6-memory.md`), seven two-way deltas, the orchestrator's: an
  unasked save is announced with its citation or not made (rejected: saving only on ask); forget is scoped to the claim
  and what it produced (rejected: a global fence); memory search never reads a chat's transcript (rejected: scrubbing
  the transcript); no goals, tracked items or briefings in P6 (no seam; a store is a one-way door; Q19; rejected: a goal
  as a memory line with a job); a sub-agent gets no memory tools (Muse's inherits `MEMORY.md`; rejected: read-only
  memory); the daily note is the chat's own lines per day (rejected: a background summariser, an unannounced second
  store); people pages on a stated relationship through `upsertEntity` (rejected: a relationships loop over the notes).
  Parts F27 (tier 1) and F28 (reply lines, tier 2).
- 2026-10-30, F27 memory as it is, the builder's, all two-way: `MEMORY_VALUE_REFUSED` is enforced in
  `MemoryService.memoryWrite` on every target through `credentialContent`, the referee's secret shapes plus a government
  ID, not email or phone (rejected: `forbiddenContent`, which refuses a saved address) A sub-agent's gate refuses every
  `memory_` tool (`SUBAGENT_MEMORY_REFUSED`) and `subAgentReads` carries no memory namespace. Forget gets no model tool
  or route, as no owner surface confirms a plan (D-0001); the tasks run `forgetPlan` and `forgetConfirm` on the `Person`
  (rejected: a `memory_forget` tool; an owner confirm route, a security boundary). A plan is made from claim ids: a
  query plan ORs its terms, so "Solo" reaches the Sam claim. The contract check takes another cluster's task when its
  own contract has its block (B-P6-12 names T-P15-08 and T-P15-12); tier-2 tasks repeating tier-1 ones name no clause.
- 2026-10-30, F28 memory says what it did, the builder's, all two-way: the reply's memory words are `MEMORY_WORDS` in
  `chat/instructions.ts` (Q18: instruction lines), one per item F28's scope names (delta 1, B-P6-07, B-P6-04, B-P6-09).
  A prompt turn may name its chat (`chat: "c2"`), so T-P6-03 and T-P6-09 say which chat each prompt runs on; the slot's
  P6 world (`scripts/evals/p6-slot.ts`, `test-host-p6.mjs`) empties Sam's memory before each trial and seeds T-P6-03 and
  T-P6-12 through the Person as tier 1 does; `sentIn` on a slot is the chat's stored rows. Rejected: a slot per trial
  (nine leases a cluster); a line sending new facts to today's note and a MEMORY.md edit citing its lines, outside the
  scope, left for a later part.
- 2026-10-30, P7 scheduling translated (`docs/plan-v2/contracts/P7-scheduling.md`), seven two-way deltas, the
  orchestrator's: a stop in flight is said and ends the run as stopped (Muse's `cron.stop` drew no notice; rejected:
  waiting for the run); silence is certified by code against the run's call log (rejected: trusting the worker's
  terminal signal); a poll is a coded gate on a recurring job, one https url at five minutes or slower (rejected: a
  script lane); a job cannot act: it reads and reports, and the person acts in the chat (rejected: a run-time card);
  remove ends what the job has in flight (rejected: refusing the remove); no proactivity editions or feed in P7 (no
  seam; a store is a one-way door; Q21; rejected: a feed as a recurring job); a job is changed in place by
  `jobs_update`, its history kept (rejected: remove and recreate).
- 2026-10-30, F29 jobs as they are, the builder's, all two-way: any agent `jobs_update` (on, paused or blocked, time and
  stop included) turns the job back to waiting on its card, as `jobs_create` does, since a job and its time are decided
  on one card (QYVR-165); a job still waiting is refused `JOB_AWAITING_DECISION` (rejected: an edit keeping the
  approval, which lets the agent rewrite an approved job); the owner's own edit keeps its status; its last 20
  definitions ride in its definition JSON; a stop or remove in flight ends the run failed `JOB_STOPPED_BY_OWNER` or
  `JOB_ARCHIVED` with one line in its chat unless its result is queued, a late step discarded; a one-shot is spent by
  its first run to end, manual or failed; Upcoming draws a turned-off job under an Off group after the cadence groups,
  and a spent or removed job not at all (rejected: hiding a paused job, with no way back to it); the ask-for-a-reply
  test is word patterns (`asksForReply`), so a conditional ask ("tell me when") still allows silence.
- 2026-10-30 P5 translated (`contracts/P5-activity.md`): eight two-way deltas: the record's words are code's (the
  summary step computed, never a model pass), a done task says its failed-step count, one words table across surfaces, a
  delegation's acknowledgement says launched, a run that did not arrive says so, the audit is a read over steps and
  journal (no audit table), the drawer says the task's tokens, no store about the chat the person cannot see. No one-way
  door. Orchestrator.
- 2026-10-30 F31: a Stop ends the work the stopped turn launched: its unsettled sub-agents end `failed` with
  SUBAGENT_CLOSED and their delegations are marked handed off without waking a turn (`SubAgentHost.stopTurn`), so the
  task reads Stopped as T-P5-08 says (Q25 asks whether the child should run on). While a task's turn has ended with its
  delegation out, the drawer's head offers Stop (`POST /app/activity/<chat>/<turn>/stop`), halting it the same way. A
  done tool load is not counted in the summary; a job set or changed is a write titled by its subject. The P5 child
  reads the probe page through the real `browse_open`, offered eager. Agent.
- 2026-10-30 F32: the slot's test-host browser serves P5's probe page by its whole address (`PAGES`,
  `scripts/preview-slot/test-host-p5.mjs`), standing in for a fixture route; a slot's sub-agent reads it too
  (`SubAgent.reads`, overridden only there); the slot's thread drops undrawn reasoning. T-P5-15's count parser reads
  "Link count: 1"; T-P5-13's grader stays F31's; the failing must-haves got `WORK_WORDS` lines. Agent.
- 2026-10-30 P3 translated (`contracts/P3-delegation.md`): a steer is a close and a new delegation; a Stop settles its
  children (F31, Q25). No one-way door. Orchestrator.
- 2026-10-30 F33: the drawer's Stop draws a stopped entry and tells the next turn (`haltNote`); task usage counts child
  and verifier calls; the delegate schemas drop `maxItems` so the gate's SUBAGENT_FANOUT_CAP answers. Agent.
- 2026-10-30 F34: the slot's probe page has its own title (`probeTitle`), neither "Example Domain" nor its address,
  which the real verifier doubts; T-P3-16 hears `WORK_WORDS`' failed-read words; for T-P3-14 the launch reply is written
  once and ends the turn, the handoff reply says an unpassed verdict, and a child's handoff says what each finding rests
  on (`SUBAGENT_TASK`). Agent.
- 2026-10-30 P9 translated (`contracts/P9-connectors.md`): a setup item with Dismiss; a refused plan's audit row; OAuth
  proposed as D-0016. Orchestrator.
- 2026-10-30 CI judges a pull request's diff three ways: code runs `pnpm verify`, docs `pnpm check` alone, docs plus
  cluster contracts `pnpm check` and `vitest related` over the test files naming a changed contract (15 of the first 20
  orchestrator PRs ran the whole suite for a contract alone). `ci.yml` runs on `pull_request` only, a new commit
  cancelling the run before it; main is verified once, by `release.yml`'s check job. `scripts/gates.test.mjs` holds it.
  Rejected: every contract test on any contract change, which runs tests the change cannot reach.
- 2026-11-08 F45 holds a step's `delta`s until the step ends and releases them only when its words are a reply (a step
  with no tool call, one that pauses on a card, one that ends the turn), so commentary beside a call never reaches a
  socket and a reply lands at its step's end rather than token by token (`chat/turn.ts`, `chat/commentary.ts`).
  Rejected: streaming live and retracting with a frame when a call follows, which still puts a `delta` before the last
  tool result (T-P2-03's `early_bubble`) and draws a bubble the page then takes away.
- 2026-11-08 F48's `pauseWords` says a real card waits beside it even when the step also called `send_to_user` or a
  tool delivered its own words: whether a card waits is a fact of the card store, not of any message. Each sentence is
  queued just before its card, so a live page draws it where a reload does (after the model's words, before the card).
  The extra message is pinned in the tier-1 P15 tasks' journal collateral (T-P15-01, -03, -04, -05, -07, -12, hashes
  retaken), and T-P15-01's `card_words_from_model` leaves out code's own sentence, which repeats the card's status.
  Rejected: staying silent when another delivery came, which leaves a card's wait to whatever the model chose to say.
- 2026-11-08 `pnpm accept` can run on a GitHub runner: `.github/workflows/accept.yml`, dispatched by hand for one branch and
  one part, prints the same ACCEPT and TREE lines and keeps the log as its artifact; it deploys and writes nothing. Added
  when a laptop carrying four builder sessions timed the browser tests out in every full run while each failing file
  passed alone. Rejected: a lower `maxWorkers` in `vitest.config.ts` (six workers still failed eight files on that
  machine) and a longer `testTimeout` (it would hide a slow test in CI too).
- 2026-11-08 F55 (D-0016 proposed, built on the default): the person's own browser goes to the provider's consent page
  by a 303 from the capture form's submit, so the consent click is theirs; the Vault never fetches the authorize URL.
  The form drawn for the `oauth` scheme alone gains `https:` beside 'self' in its `form-action`, since browsers hold a
  form's redirect to that list; a key's or a login's form keeps 'self', and OAuth fields submitted from one come back
  on the OAuth form. Rejected: a page with a link the person clicks (a second click for nothing) and a Vault-side
  fetch of the consent page.
- 2026-11-08 Preview slot 1 (`fletch-pv-1`) is staging for Kyle's and Muse's UAT: the inventory marks it, its lease row
  says `staging` and never expires, no `up`, `gc` or plain `down` takes or wipes it, and every push to main redeploys
  main to it (`.github/workflows/deploy-staging.yml`, `pnpm preview staging deploy`) on the scoped token with no lease
  key, since that token already deploys every slot Worker. Reversing: `pnpm preview down --slot 1 --force` on Kyle's
  login, then a PR that drops the mark and the workflow. Rejected: a lease key for the runner (it proves nothing the
  token does not), and a fresh lease per deploy (it would wipe the passkey and workspace).
- 2026-11-08 F70 (P13, D-0026, accepted by Kyle's ruling of 2026-11-08, recorded on main by PR #141): the `attachments` row's `transcript` column is a two-way storage change under AGENTS.md's
  no-users rule, since `attachments/store.ts` is the only reader of that table's rows; it lands by the named migration
  `person.attachments-transcript`. The audio types are mp3, m4a, ogg, opus, wav and `weba` for `audio/webm` (`webm`
  stays video, so a recorder's unnamed `audio/webm` blob is audio by its type). The call refusal is answered by an
  observation, `speech_status`, beside `speak`, so no tool is named for starting a call (B-P13-01). Rejected: a
  `voice_call` tool that only refuses (a name that reads as capture), and the refusal in the instruction line alone
  (words with no code behind them). D-0026's "transcript kept, audio not" is the one-way door this column serves; the column
  itself is reversible (a later migration drops it) while no other reader exists.
- 2026-11-08 F60 (D-0025 door 1): `roomReach()` refuses a tool whose name holds `room`, `group` or `participant` (and
  their plurals), or whose description offers to make or join a chat with other people, add a person to one, invite to
  one, or send from the person's own account or under their name. `invite` counts only in a description that invites to
  a chat, group or room, because `onboarding_invite` invites a member to the company, which is not a room (the scope's
  narrowing; the tool is not renamed). The nine held P8 tasks are skipped by name as vitest todos, since Biome refuses
  `.skip`. The T-P8-10 control check reads the page as served (its markup is the same at both widths; no Chromium run).
  Rejected: renaming `onboarding_invite`, and a Biome ignore comment per held test.
