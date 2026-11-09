# Decision log

Two-way doors: dated one-liners with their reason, for choices nobody else has to obey. When a line starts mattering
to others, promote it into a record (README.md) and delete it here. Capped at 40 KB by `scripts/check-decisions.mjs`.
Entries from before November 2026 are in `log-2026-10.md` (moved whole on 2026-11-09, outside the cap).

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
  `.skip`. The T-P8-10 control check read the page as served until 2026-11-09, when PR #158 (Q60) made it a Chromium run at 1280 and 390 over the rendered DOM, drawn and listed chat kinds both graded.
  Rejected: renaming `onboarding_invite`, and a Biome ignore comment per held test.
- 2026-11-09 F101 (P11 deltas 6 to 8, under Kyle's ruling of 2026-11-08): a file's delete and a share's revoke are
  journaled from the owner's turn (`packages/agent/src/files/journaled.ts`), one content-free row each (`files.delete`,
  `files.unshare`); a row the Ledger does not take is said in the tool's words. The P11 collateral snapshot exempts
  only what a run declares (`Run.removes`, `Run.revokes`) and stays exact for every other key (`planted-f101.test.ts`).
  Four task files' collateral and T-P11-02's format sentence corrected before any tier-2 run, hashes refreshed.
  Rejected: a card before a revoke, a `revoked_at` column (delta 6).
- 2026-11-09 (F71, under Kyle's one-hour ruling of 2026-11-08): F71 split, its scope item (6) and T-P13-08 to F74, because F101 owns `share_revoke` and the two revokes answer differently (`SHARE_EXPIRED` against `SHARE_UNKNOWN`). The two speech models join both `MODEL_TIERS` (speech has its own monthly cap). A failed or refused speech call costs nothing in its Ledger row; a successful one at least one micro. A read-aloud's audio is accepted between 25 and 4 characters a second plus three seconds; shorter is `SPEECH_PARTIAL`, longer `SPEECH_FAILED`. The default speaker is aura-2-en's `luna`. An episode ask is refused `SPEECH_UNAVAILABLE` until F72's two-voice render. Rejected: a second revoke beside F101's; holding speech to the economy tier's text model.
- 2026-11-09 F93 (P10, under Kyle's ruling of 2026-11-08): three two-way changes so T-P10-08 and T-P10-14 run on the
  production path. (1) `browse_keep_site` is `asksAfterExternal`: on the person's ask it runs at once; after outside
  content in the same turn it asks on a card flagged `AFTER_EXTERNAL_INPUT` (`chat/gate.ts`), the crossing being a
  page's say-so writing into the Vault (B-P10-09). (2) Its result names the cookie count, never a value. (3) A scheduled
  job run names its slot to the model step (`jobs/steps.ts`, B-P10-16). Rejected: softening T-P10-08's flag grader;
  pasting the slot onto the delivered text in code (it would break B17's content dedupe).
- 2026-11-09 F102 (P11, under Kyle's ruling of 2026-11-08: "answer all of these with defaults and best effort to
  unblock, then continue work for the next hour in as much fan-out and parallel work as possible; no blockers, just
  move; we can always go back later and reconcile"): P11's tier 2 runs on a slot without the Renderer (D-0030
  proposed), so a write-up with no format named is Markdown by `file_write` (`FILE_WORDS`); T-P11-17's memo is seeded
  by the test host's `p11` op at `documents/p11-memo.docx`, the path its unchanged grader reads (the setup line's
  `p11-eval-memo.docx` left that grader vacuous); a `send_to_user` call is the agent's words, never a send; `approve`
  (P11 only) allows the pending card once. Rejected: the Renderer on (money, D-0030); `approve` renamed `decide` (a new
  task hash). Reconcile list in PR #171.
- 2026-11-09 (F72, under Kyle's one-hour ruling of 2026-11-08): the drawing built before Kyle's look at the specimens;
  the three surfaces are listed in PR #169 for his UAT. An episode is `speak` with `as: "episode"` and a script in
  exactly two aura-2 speakers, each turn its own admitted speech call joined into one MP3; a failed or cut-short turn
  writes nothing, a script not in two voices is `EPISODE_SCRIPT_INVALID`; `episode_publish` is refused
  `PODCAST_FEED_UNAVAILABLE` on every deploy. The Voice row is a select in Settings > General at `/app/speaker` (a
  `/voice` segment trips T-P13-01's capture-route grader). Rejected: a Voice pane of its own, a one-voice episode.
- 2026-11-09 F74 (under Kyle's one-hour ruling of 2026-11-08): T-P13-08 grades F101's shipped `SHARE_UNKNOWN`, not the
  contract's `SHARE_EXPIRED`, a grader refined before any run; the contract's end_state and Build note 10 wait on Q62.
- 2026-11-09 (F73, Kyle's ruling of 2026-11-08): T-P13-14 runs from a cloud session, not Kyle's Mac; the voice note rides the next prompt. Rejected: waiting for the Mac.
- 2026-11-09 (triage B.8, PR #184): T-P15-07's collateral gains `message:c1:7:agent`, code's F59 host sentence said on the card path when the second fill is refused for its host (`chat/approvals.ts`), and its hash is refilled; the sentence is right there (it names the host, never the value), so the count moved, not the words.
- 2026-11-09 The renderer's container gets its own deploy flag, `--render` (D-0031, proposed, superseding D-0030's
  `--paid` ride-along), and `deploy-staging.yml` carries it: staging never deployed with `--paid`, and Code Mode and
  Images are unmeasured on that account. One `lite` instance, `max_instances: 1`, a five-minute inactivity timeout set
  by the object, a `render` boolean on `/health`. Rejected: flipping `RENDERER_ON_PAID` (Kyle's acceptance of D-0030,
  not the agent's) and deploying staging with `--paid`.
