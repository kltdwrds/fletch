# Reactions, full circuit — build plan (Fable, 2026-10-23)

Inputs: `reactions-dump-2026-10-23.md`, `reactions-spec-2026-10-23.md`, and the code on `main` at `aa122a3`
(F8 merged). Planning only; nothing in the repository was changed. Proposed part id: **F10** (see §7 for why not F9).

Line numbers below are against `aa122a3`. Re-checked at the build's base `daa2cee` (same code): the few that drifted are corrected in place.

## 0. What is being built, in my words

Today a reaction is a one-way decoration: the owner puts one of six emojis on a message, the Chat object stores it
per (message, person), broadcasts a `reaction` frame, and the model never hears of it
(`packages/agent/src/chat/message-actions.ts:1-4`, `store.ts:146-160`). This build closes the circuit in three
ways, all on the existing store and frames:

1. **The agent can react.** A `react` tool in the core namespace (beside `send_to_user`) queues a `react` effect;
   the barrier commits it, the outbox flushes it as a stored reaction under the reactor id `agent` and the same
   `reaction` frame, now carrying `by: "agent"`. Any single emoji grapheme is allowed on the agent's side; the
   person's picker keeps the six. Canonical use: a 👍 on the person's message when work starts.
2. **Reactions reach the model.** Every turn's runtime envelope carries a fenced `chat:reactions` block listing
   who reacted with what to which message (by `mid`, with a clipped quote), built at assembly time from the
   `reactions` table and the history, never persisted into the transcript. Same fencing discipline as `quoteLead`.
3. **A reaction on a pending question is an answer.** When the agent's latest words were a question (the last
   drawn message is the agent's and carries a `?`, no turn running, the latest turn ended `done` with no code),
   the person's reaction on that message becomes a mailbox row of a new kind `reaction` carrying a harness signal
   ("〈name〉 reacted 〈emoji〉 to your message, quoted below"), and the engine starts a turn from it (or steers it
   into a running one) through the existing `openTurn` / `Mailbox.steer` path. Any other reaction is ambient:
   stored, drawn, broadcast, in the next turn's context, and starts nothing.

Who may react stays the owner on the person side (admission is owner-only today, `protocol.ts:83-87`); the
agent is the second participant. The draw collects both at the bubble. Nothing new keys on "owner" beyond what
already does, so a later multi-person part extends a list rather than rewriting a rule.

## 1. Facts from the code that shape the plan

- **No "pending question" exists in the engine.** `awaiting` (`gate.ts:43`, `engine.ts:428,513`) is the approval
  card pause (`AWAITING_DECISION`), a different thing. The only notion of a conversational question is the
  `ASKING` prompt text (`instructions.ts:13-18`): "one sentence with one question mark … as your final answer".
  The detection in §4 is derived from that contract.
- **The reactions table already fits.** PK `(message_id, person)` (`message-actions.ts:14-20`), `person` is free
  text. The agent's reactions go under a constant reactor id; no migration (`migrations/catalog.ts:118` stays).
- **The model has no `mid`s.** The transcript is pi messages; `mid`s exist only in `visibleHistory`
  (`history.ts:93-150`). The agent therefore needs a default target (the person's latest message) and the
  reactions block has to name `mid`s so the model can target others.
- **A live `you` bubble has no `mid` until the turn ends** (`named` frame, `engine.ts:589`; client
  `nameLive`, `http/app/message-actions.ts:108-120`). A `reaction` frame for the person's message arriving
  mid-turn (the ack) would find no bubble (`chat.ts:395`) and be dropped until reload. The person's message id
  is known at `openTurn` (`intake.ts:51`), so `turn_started` and `queued` can carry it.
- **`engine.ts` is at the 600-line cap exactly** (`scripts/check-file-sizes.mjs:13`, `POLICY.maxLines: 600`).
  Every line added there must be paid for by an extraction (§2 step 0).
- **`drain()` routes every non-`user` mailbox kind to `beginHandoff`** (`engine.ts:223-224`). A new kind must
  be routed explicitly or a reaction row becomes a fake handoff.
- **`openTurn` marks the row's text as the person's typed message and feeds its URLs to the browser's URL table**
  (`intake.ts:51-54`). A reaction row's text is harness text quoting the agent; it must do neither.
- **Effects are the only way a tool touches the world** (`tools.ts:1-4`, `turn.ts:3-6`). `send_to_user` is the
  model: `kind: "action"`, `queues: "self"` (`tools/search.ts:46-50`, `tools/registry.ts:162-168`).
- **Redelivery after a crash replays an outbox row with the same id** (`engine.ts:573-583`). A toggle is not
  idempotent; the agent's path must be set/replace, not toggle (§6).
- **The envelope is the per-turn block that is never persisted** and is recorded by `projections.record` so a
  resumed step replays it (`context/assemble.ts:120-134`, `assemble-turn.ts:71`). That is where a block that
  changes between turns belongs.
- **The F9 branch is not what the spec assumes.** `f9-hover-parity` exists only in the local checkout
  `/home/hatch/workspace/fletch-f9`, based on `e393855` (before F8), one commit (the brief under `docs/briefs/`),
  no code, not pushed (`git ls-remote --heads origin` lists no such branch). See §7.

## 2. Implementation steps, in order

Each step is independently verifiable; each names its files and its tests (§3 gives the test bodies).

### Step 0 — make room in `engine.ts` (no behaviour change)

- **Touches:** `packages/agent/src/chat/engine.ts`, new `packages/agent/src/chat/outbox.ts`.
- **Does:** move `flushOutbox` and `startSubagents` (`engine.ts:573-591`) into `outbox.ts` as
  `flushOutbox(deps, session)` taking `{ store, links, approvals, broadcast, subagents, owner, now }`. Frees about
  22 lines; the whole build adds about 12 to `engine.ts`. Any other extraction of similar size is acceptable;
  this one is the default because the build also adds a branch to it (step 5).
- **Verify:** `pnpm check` (the ratchet), the full `[M24.2]` and `[M20.1]` files
  (`test/workers/m24-2-steering.test.ts`, `m20-*`) green, no new test.

### Step 1 — the data shape: a reactor, collected reactions, `by` on the frame

- **Touches:** `chat/message-actions.ts`, `chat/history.ts`, `chat/frames.ts`, `chat/store.ts`,
  `http/app/message-actions.ts` (client `named`/`setReaction`/`emojiButton`), `http/app/chat.ts:395`,
  `test/workers/m27-chat.test.ts` ([M29.4] entry/frame shapes), `test/workers/m29-message-actions.test.ts`
  (history assertion at line ~352).
- **Does:**
  - `message-actions.ts`: `export const AGENT_REACTOR = "agent"` (no email can equal it). New
    `MessageActions.reactionsByMessage(): Map<string, Array<{ by: string; emoji: string }>>` (one SELECT).
    Keep `toggle` for the person; add `set(mid, person, emoji, at)` (INSERT … ON CONFLICT UPDATE, idempotent).
  - `history.ts:33-34`: replace `reaction?: string` with `reactions?: Array<{ by: "you" | "agent"; emoji: string }>`
    (no compatibility shim: AGENTS.md "No backwards compatibility"). `by: "you"` is the owner, the only person a
    history is drawn for today (`store.ts:148`).
  - `store.ts:withActions`: build `reactions` from `reactionsByMessage()`, mapping the owner to `"you"` and
    `AGENT_REACTOR` to `"agent"`; drop entries from anyone else (as today).
  - `frames.ts:44`: `{ type: "reaction"; mid; by: "you" | "agent"; emoji: string | null }`.
  - `ChatMessageActions.react` broadcasts `by: "you"`.
  - Client: `d.msg.reaction` stays the viewer's own (drives `aria-pressed`); add `d.reactions = {}` keyed by `by`;
    `setReaction(d, by, emoji)` updates the map and redraws one `.reaction-pill` whose text is the agent's then the
    person's emoji (empty map → no pill). `named(d, h)` seeds from `h.reactions`. `chat.ts:395` passes `f.by`.
- **Verify:** `[M29.4]` suites updated and green; new `[F10]` page test for the collected pill (§3, T1).

### Step 2 — reactions enter the model's context

- **Touches:** `chat/message-actions.ts` (new `reactionsLead`), `context/assemble.ts` (`Envelope.reactions?: string`,
  `envelopeText` appends it), `chat/assemble-turn.ts:67` (fills it), `test/workers/m1-context.test.ts` unchanged.
- **Does:** see §5. Stable prefix untouched; the envelope gains a trailing fenced block only when any reaction stands.
- **Verify:** `[F10]` context tests (§3, T2). The `[M29.4]` claim "the model never sees a reaction"
  (`m29-message-actions.test.ts:369-387`) is deleted in this step; its inverse is T2.

### Step 3 — the person's message is named at once

- **Touches:** `chat/intake.ts` (`Opened` gains `mid: string`), `chat/engine.ts` (`started(...)` passes `mid`; the
  `queued` broadcast at `engine.ts:195` passes `mid: \`q${row.ordinal}\``), `chat/frames.ts` (`turn_started` and
  `queued` gain `mid?: string`), `http/app/chat.ts` (`turn_started`/`queued` handlers name the bubble, including a
  pending node the page itself drew: `taken(f.id)` must hand back that node so it can be named).
- **Does:** a `you` bubble carries `data-mid` from the moment the chat says it is stored, so a `reaction` frame on
  it lands live. `nameLive` keeps working for agent bubbles (it skips nodes that already have a `mid`).
- **Verify:** `[F10]` page test (§3, T3); the `[M29.4]` "a turn's named frame gives live bubbles theirs" claim in
  `m27-chat.test.ts:450` keeps passing (it delivers `turn_started` without `mid`, so it exercises the old path too).

### Step 4 — the agent reacts: tool, effect, flush, frame

- **Touches:** new `chat/agent-reaction.ts` (`reactTool`, `agentReactionRefusal`, `singleEmoji`), `chat/tools.ts`
  (`ReactEffect` in the `Effect` union), `tools/search.ts` (`coreNamespace` takes the spec), `chat/stop.ts`
  (`effectWords` case), `chat/approvals.ts:78` (type exclusion), `chat/outbox.ts` (flush branch),
  `chat/engine.ts` (`store.queue` branch at line 519 treats `react` like `deliver`/`link`; `toolSession` passes
  `reactTool(effects, () => this.history().entries)`), `chat/instructions.ts` (`REACTING` lines in `CHAT_TASK`).
- **Does:** see §6.
- **Verify:** `[F10]` engine tests (§3, T4); `[M24.2]` stop tests still green (`effectWords` has a case).

### Step 5 — a reaction on a pending question is delivered as input

- **Touches:** new `chat/reaction-input.ts` (`askedLast`, `reactionRow`, `reactionSignal`), `chat/mailbox.ts`
  (`MailKind` gains `"reaction"`), `chat/intake.ts` (reaction rows: not typed, no URL table), `chat/engine.ts`
  (`react()` grows to record, broadcast, then defer the intake; `begin` passes no text for a reaction row;
  `drain()` at line 223 routes by `kind === "internal_handoff"`), `chat/socket.ts` unchanged (still `chat.react(...)`).
- **Does:** see §4.
- **Verify:** `[F10]` intake tests (§3, T5), including the ambient negative and the steer case.

### Step 6 — docs and ledgers the build owns

- `packages/agent/src/chat/message-actions.ts` header comment (lines 1-5) and `store.ts:146-149` say "drawn and
  never reaches the model"; rewrite both. `docs/decisions/log.md`: one dated F10 line for the three two-way
  rulings (§8). `docs/plan/PROGRESS.md` row at the end, per KICKOFF step 6. No AGENTS.md change needed.

## 3. Hermetic tests per step (M29.4 style)

Two new files, both top-level `describe`s tagged `[F10]`:

- `test/workers/f10-reactions.test.ts` — engine level, over `authorityWorld` (`test/workers/support/authority-world.ts`)
  as `m29-message-actions.test.ts:320-387` does for reactions and `m24-2-steering.test.ts` does for the mailbox:
  `w.say`, `w.chats.harness(id).instance`, `.rows("SELECT …")`, `w.fake.requests`, `held`/`reached`/`release`
  checkpoints for a running turn, `await chat.settled()` for deferred work. No browser.
- `test/workers/f10-reactions-page.test.ts` — the shipped page under `test/workers/support/page-harness.ts`
  (`threadPage` pattern from `m27-chat.test.ts:46-52`), frames delivered by hand. No Chromium: the pill is DOM, and
  the M29.4 Chromium suite already covers the picker's geometry.

Edits to existing files: `m27-chat.test.ts:443-470` (entry `reactions: [{ by: "you", emoji: "👍" }]`, frames with
`by`), `m29-message-actions.test.ts:352` (history assertion reads `reactions`), and delete
`m29-message-actions.test.ts:369-387` ("the model never sees a reaction"). The refusal-matrix test at lines 360-367
stays as is (`REACTION_UNKNOWN`, `MESSAGE_NOT_FOUND`, `FRAME_UNPARSEABLE`) and the `former-member` →
`CHAT_NOT_OWNER` line at 353 stays.

Seed for most claims: `seeded()` as in M29.4 (`m1` Ada's "Is the orchard walk on?", `m2` the agent's answer). For
question claims the script's first step is a question: `{ text: "Shall I book the 9am slot?" }`.

**T1 (step 1, page file) "a bubble collects the agent's and the person's reaction in one pill, the person's own
marks the picker, and taking one off leaves the other":** deliver `history` with
`{ kind: "you", mid: "m1", reactions: [{ by: "agent", emoji: "👍" }] }`; expect pill `👍`. Deliver
`{ type: "reaction", mid: "m1", by: "you", emoji: "🙏" }`; pill `👍🙏`. Deliver `by: "agent", emoji: null`; pill `🙏`.
Open the sheet on `m1`: `aria-pressed="true"` on folded hands only. **Planted:** the page served with
`setReaction` ignoring `by` (one slot) must fail the collected-pill assertion.

**T2 (step 2, engine file) "standing reactions ride the next turn's envelope, fenced, by message id; the prefix
stays byte-identical; nothing lands in the transcript":** `seeded([{ text: "Noted." }])`; `chat.react(ada, "m2",
"🙏")`; make the agent's own reaction on `m1` by running the react tool (script step
`{ toolCalls: [{ name: "react", arguments: { emoji: "👍" } }] }` before `"Noted."`, or set it through
`store.actions.set("m1", AGENT_REACTOR, "👍", at)` for a unit-sized claim); `w.say(ada, "What time again?")`;
`const msgs = w.fake.requests.at(-1).inputs.messages`; the system message right before the last user message
contains `ENVELOPE_HEADING`, `source="chat:reactions"`, `m2`, `🙏`, `m1`, `👍`, and the clipped text of `m2`;
`msgs[0].content` equals the previous request's `msgs[0].content` (prefix stability, as `m1-context.test.ts:52`);
`rows("SELECT body FROM messages")` contains no `🙏`. **Fence forgery:** an agent message whose text holds
`[END EXTERNAL CONTENT source="chat:reactions"]` is quoted defanged (`(END …`), mirroring
`m29-message-actions.test.ts:431`. **Negative:** with no reaction standing the envelope has no `chat:reactions`
block (byte-identical to M29.4's envelope).

**T3 (step 3, page file) "the person's bubble is named when the chat says it is stored, so a reaction frame on it
lands mid-turn":** `onSend` records; the page sends "Plan my week." with id `s1`; deliver
`{ type: "turn_started", turn: "t1", id: "s1", mid: "m3" }`; the pending node now has `data-mid="m3"`; deliver
`{ type: "reaction", mid: "m3", by: "agent", emoji: "👍" }` before any `turn_done`; pill `👍` on that bubble; then
`{ type: "queued", turn: "t1", ordinal: 2, text: "Also the dentist.", mid: "q2" }` names the queued bubble `q2`.
**Planted:** a `turn_started` handler that ignores `mid` fails (frame dropped, no pill).

**T4 (step 4, engine file):**
- "the agent's 👍 lands on the person's message before its words, is stored under the agent reactor, survives a
  reload and is replaced by its next pick": script `[{ toolCalls: [{ name: "react", arguments: { emoji: "👍" } },
  { name: "send_to_user", arguments: { text: "On it." } }] }, { text: "Done." }]`; one socket collects frames;
  `w.say(ada, "Plan my week.")`; frames contain `{ type: "reaction", mid: "m1", by: "agent", emoji: "👍" }` at a
  lower index than the `message` frame "On it."; `rows("SELECT message_id, person, emoji FROM reactions")` is
  `[{ m1, agent, 👍 }]`; `history().entries[0].reactions` is `[{ by: "agent", emoji: "👍" }]`. Second turn with
  `{ emoji: "❤️", message: "m1" }` replaces the row. `emoji: "👍"` again on `m1` keeps `👍` (set, not toggle).
- "refused by name: not one emoji, an agent's own message, an unknown id": steps with `{ emoji: "ab" }`,
  `{ emoji: "👍👍" }`, `{ emoji: "👍", message: "m2" }` (the agent's), `{ emoji: "👍", message: "m9" }`; each tool
  result text (the next request's tool message) carries `REACTION_UNKNOWN`, `REACTION_UNKNOWN`,
  `REACTION_TARGET_NOT_PERSON`, `MESSAGE_NOT_FOUND`; `reactions` table empty. Skin tone `👍🏽`, `❤️‍🩹` and `🇫🇷`
  are accepted by `singleEmoji` (unit assertions in the same file).
- "a stopped turn lists the reaction it had committed": `effectWords({ kind: "react", … })` is `reacted 👍 to your
  message`, and the `[M24.2]` stop entry includes it when the react step was committed before the stop.
- **Planted:** remove the `you`-only check in `agentReactionRefusal` and the third refusal above must fail.

**T5 (step 5, engine file):**
- "a 👍 on the agent's question starts a turn that reads the signal, draws no bubble and names no words": script
  `[{ text: "Shall I book the 9am slot?" }, { text: "Booked for 9." }]`; `w.say(ada, "Book the dentist.")`;
  `chat.react(ada, "m2", "👍")` returns `{ ok: true, mid: "m2", emoji: "👍" }`; `await chat.settled()`;
  `w.fake.requests` has 2; request 1's last user message contains `source="reaction:${ada.email}"`, `👍`,
  `source="quote:agent"`, "Shall I book"; `rows("SELECT kind, scope, state, delivery FROM mailbox")` ends with
  `{ reaction, reaction:ada…, completed, start }`; `history().entries.filter(you)` is still one entry;
  `turns` has two rows, both `done`; the `turn_started` frame for the second turn has no `text`;
  `store.meta(URLS_KEY)` is unchanged when the question contained `https://example.test/x` (the URL-table guard).
- "ambient: a reaction on anything but the agent's last question starts nothing": the same world; react `🙏` on
  `m1` (the person's own) and `❤️` on `m2` when the agent's last message was "Booked for 9." (no `?`): requests
  stay at 1, no `reaction` mailbox row, both reactions stored and in the next envelope (T2's path).
- "not a decision: a reaction when the turn ended on a card changes nothing": script a gated fixture call that
  pauses (`shop_buy` as in the M20.1 tests), react `👍` on the agent's last text; no mailbox row, no turn, the
  card still pending.
- "a second reaction while the reaction's own turn runs is steered, and the same emoji again is the same row":
  script `[Q, held("busy", { text: "Working." }), { text: "Done." }]`; react `👍` on `m2`; `await
  w.fake.reached("busy")`; react `❤️` on `m2` (replace); release; request 2 contains `STEER_POLICY.slice(0,60)`
  and `source="reaction:…"` with `❤️`; mailbox shows `[…, start], […, steer]`. Then `👍` off and `👍` on again →
  `duplicate`, no third turn.
- **Planted:** `askedLast` with the `?` test removed makes the ambient negative fail; `drain()` left routing
  non-user kinds to `beginHandoff` makes the first claim fail (a handoff turn has no signal fence).

## 4. The pending-question delivery on the intake/steering machinery

Module: `packages/agent/src/chat/reaction-input.ts`.

- `askedLast(entries: HistoryEntry[]): Extract<HistoryEntry, { kind: "agent" }> | null` — scan `entries` from the
  end over kinds `you | agent | card | failed | stopped` (skip `note`, `thinking`, `link`); return the last one if
  it is `agent` and `/\?/.test(text)`, else null. A `card` last (the turn paused on an approval) or a `you` last
  (the person already answered) yields null.
- `reactionRow(d, person, mid, emoji)` in the engine's `react()`:
  ```
  const r = this.messages.react(person, mid, emoji);          // store + broadcast, as today
  if (r.ok && r.emoji && !this.store.runningTurn()) {          // null emoji = taken off: never input
    const asked = askedLast(this.history().entries);
    const last = this.store.turns().at(-1);
    if (asked?.mid === mid && last?.status === "done" && last.code === null) this.defer(this.takeReaction(person, asked, r.emoji));
  }
  return r;
  ```
  `takeReaction` accepts the row inside a transaction and then either `begin(row, true)` or, if `busy()`, leaves
  it queued for the step boundary (the running turn's `queued()` sees `hasQueued()`, `Mailbox.steer` takes it,
  `steerMessage` fences it by `scope`). The `settled()` hook already exists for tests (`engine.ts:379`).
- The row: `mailbox.accept({ messageId: \`reaction:${mid}:${person}:${emoji}\`, kind: "reaction", scope:
  \`reaction:${person}\`, person, text: reactionSignal(nameOf(person), emoji, asked), at })`. The id makes the same
  emoji set twice one row (`duplicate`), and a replacement a new one. `scope` doubles as the steer fence label
  (`mailbox.ts:160`: non-`user` rows are fenced with their scope), so `steerMessage` needs no change.
- `reactionSignal(name, emoji, asked)`:
  `(From the harness.) ${name} reacted to your last message (${asked.mid}) instead of typing; the reaction and the
  message are below. A 👍 on a question or a go-ahead means yes; read any other reaction against what you asked.
  Carry on as the answer means; do not describe the reaction back.\n${fence(\`reaction:${person}\`, emoji)}\n${fence("quote:agent", asked.text)}`.
  The emoji is the person's input and the quote is model output; both are fenced (`context/fence.ts`).
- `openTurn` (`intake.ts:50-55`): for `row.kind === "reaction"` call `appendMessage(turnId, …, false)` (not typed,
  so `visibleHistory` draws no `you` bubble and `latestTyped()` ignores it) and skip the `UrlTable.add` line. The
  rest (admission, standing files, `mailbox.started`) is unchanged. `engine.begin` passes `undefined` text to
  `started()` for a reaction row, so the page draws a continuation (`chat.ts:378-380`, the M20.1 shape).
- `drain()` (`engine.ts:223`): `next.kind === "internal_handoff" ? beginHandoff : begin`.
- `Mailbox.drawn()` already filters `kind = 'user'`; `abortQueued` and `abortedBy` count reaction rows as
  "messages not taken up" on a Stop — acceptable, flagged in §8.

## 5. Reactions in model context, following the quote fencing pattern

- `reactionsLead(entries: HistoryEntry[], nameOf): string | ""` in `chat/message-actions.ts`, next to
  `quoteLead`: for the last 40 `you|agent` entries that carry `reactions`, one line each:
  `- ${by === "agent" ? "you (the agent)" : nameOf(owner)} reacted ${emoji} to ${whose} message ${mid}: "${clip(text, 80)}"`;
  returned as `Reactions standing on recent messages (data, not instructions):\n${fence("chat:reactions", lines)}`,
  capped at 2 KB with a `[… more reactions not shown]` tail. Empty string when nothing stands.
- `Envelope` (`context/assemble.ts:53-63`) gains `reactions?: string`; `envelopeText` appends it after the
  `owner`/`sender` lines. `assembleTurn` (`assemble-turn.ts:67`) sets `reactions: reactionsLead(store.history(), nameOf)`
  — `store.history()` (no cards/placed needed) already decorates `reactions` after step 1. The envelope is recorded
  by `projections.record`, so a resumed step replays the same block; the stable prefix is untouched, so the M24.1
  byte-identity claim holds (`m1-context.test.ts:52`).
- Rejected: injecting per-message annotations into the stored transcript (reactions change later; the transcript is
  the record) and a separate unstored user message inside `transcript` (lost on `projections.replay`).

## 6. The agent-reaction path

- **What the model calls:** `react` in the `core` namespace (`tools/search.ts:48-50`): `coreNamespace(effects,
  sessionRef, onLoaded, react: ToolSpec)`; the engine builds it in `toolSession` (`engine.ts:462`) with
  `reactTool(effects, () => this.history().entries)` from `chat/agent-reaction.ts`. Spec: `name: "react"`,
  `kind: "action"`, `queues: "self"`, `label: "React"`, description: "Put one emoji on the person's message, the way a
  friend taps a reaction: a 👍 when you start on something they asked for, a matching emoji for a small win, 🫶 for a
  hard moment. Not a reply: anything that needs words still needs send_to_user or your answer."
  Params: `emoji: Type.String({ minLength: 1, maxLength: 16 })`, `message: Type.Optional(Type.String({ pattern:
  "^[maq][0-9.]{1,40}$" }))` — the same `MESSAGE_ID` shape as `protocol.ts:30`.
- **Validation (`agentReactionRefusal(entries, mid, emoji)`):** `singleEmoji(emoji)` = exactly one grapheme by
  `Intl.Segmenter("en", { granularity: "grapheme" })` whose first code point matches
  `/^(\p{Extended_Pictographic}|\p{Regional_Indicator})/u` → else `REACTION_UNKNOWN`; target = `message` or the
  latest `you` entry → none: `MESSAGE_NOT_FOUND`; target not `you`: `REACTION_TARGET_NOT_PERSON`. The tool throws
  `CODE: reason` (the registry's convention, `tools/search.ts:27`), so the model reads the code.
- **What is emitted:** `effects.push({ kind: "react", id: toolCallId, mid, emoji })`; result text
  `reacted ${emoji} to ${mid}; it shows once this step is committed`. `ReactEffect` joins `Effect` (`tools.ts:107`);
  `store.queue` passes it untokened like `deliver`/`link` (`engine.ts:519`); `effectWords` gains the case;
  `approvals.release`'s parameter excludes it (`approvals.ts:78`).
- **Flush:** in `outbox.ts` (step 0), `effect.kind === "react"` → `messages.reactAsAgent(mid, emoji)`:
  re-check `agentReactionRefusal` against current entries (the message could have been compacted away — then
  skip silently, the row is still marked delivered), `store.actions.set(mid, AGENT_REACTOR, emoji, now)`,
  broadcast `{ type: "reaction", mid, by: "agent", emoji }`. Set, not toggle: the outbox may replay the row after a
  crash and must land on the same state. Removing an agent reaction is not offered (flagged, §8).
- **Drawn:** the page's `setReaction(d, "agent", emoji)` (step 1); the person's bubble is named by then (step 3).
- **Persisted:** the `reactions` row under `agent`; history decorates `reactions: [{ by: "agent", … }]`, so a
  reload redraws it. Search (`chat/search.ts`) ignores reactions, as it ignores quotes.
- **Taught:** `REACTING` added to `CHAT_TASK` (`instructions.ts:21-26`), not to the operating block (it has a
  byte cap, `operating-block.ts:8-9`, and must stay byte-identical). Text: "React with `react` the way a friend
  would, not on every message. When you start work the person asked for, react 👍 to their message in the same
  step as your first tool call, instead of a filler message; the reply comes with the result. A small win or a
  kind word may take one matching emoji. On hard or sad news react 🫶, never a celebratory emoji. A reaction never
  stands in for an answer the person is owed, and never ends a turn." (Tests pinning `CHAT_TASK` by inclusion:
  `m1-chat.test.ts`, `m22-1-hedge.test.ts` — check they use `toContain`, not equality.)

## 7. Sequencing against F9

- **Fact:** `f9-hover-parity` has no code. It lives only in `/home/hatch/workspace/fletch-f9`, is based on
  `e393855` (pre-F8), carries one docs commit (`21fb864`, the brief under `docs/briefs/`), is not on `origin`, and
  F9 is not in `docs/plan/parts.md` (which ends at F8). The spec's "in flight, touches the same client surfaces"
  describes intent, not a branch to merge behind.
- **Overlap if F9 lands first:** F9 edits `MESSAGE_CSS`'s reveal rules (`http/app/message-actions.ts:40-42`) and
  `tokens.ts` (generated, via `pnpm ds`). This build edits `MESSAGE_CSS` only at the `.reaction-pill` rule (line 49)
  and `MESSAGE_SCRIPT`'s `named`/`setReaction`/`emojiButton`, plus `chat.ts:378-395`. Same files, disjoint lines;
  a rebase is mechanical.
- **Call:** base the build on **`aa122a3` (`origin/main`)** now; do not wait for F9. Branch `f10-reactions`. If
  F9 merges while the build runs, `git rebase origin/main` before the final `pnpm accept` and re-run the two
  `[M29.4]` files. If F9 is dropped from the plan, Kyle renumbers this part F9 before kickoff; the test tag
  follows the id in `parts.md` at kickoff, which the build session checks first (KICKOFF step 1).
- **Part id:** F10, so F9 stays free for hover parity as the brief reserved it.

## 8. Risks, and what I judge wrong or under-specified in the spec

1. **"Pending question" is a heuristic on model output.** The engine has no such state. The rule in §4 keys on
   the agent's last drawn message carrying `?`, which the `ASKING` contract makes the agent's convention. It is a
   routing decision (whether a stored reaction also becomes an input), not a capability or grant, so it does not
   cross "message content is data"; but it can misfire (a rhetorical `?`) or miss (a go-ahead phrased without one).
   The robust alternative is an explicit marker: `send_to_user` or the final answer declaring `awaiting_reply`,
   or a dedicated `ask_user` tool, recorded on the turn row. Recommendation: ship the heuristic now (it is what the
   spec describes), log it as a two-way ruling, and promote to the explicit marker if UAT shows misses.
2. **A reaction is never a grant decision.** VISION's "it asks before it acts" is the approval card path
   (`AWAITING_DECISION`). §4 excludes it (a `card` last → no delivery; `last.code !== null` → no delivery). The spec's
   "asked for a go-ahead" must read as a conversational go-ahead only. Stated as a ruling and tested (T5, third).
3. **Multi-participant is in tension with VISION** ("one agent for one person … not a platform for teams").
   The plan keeps the door open only by not adding owner-keyed rules; it builds nothing for other people, and
   `by: "you" | "agent"` on frames would need to become a person id when that day comes. Flagged, not built.
4. **The care heart has no glyph.** Muse's `hatch:heart_v1` is a custom emoji; uploads are out of scope. Plan picks
   🫶 (heart hands) as the care register in `REACTING`; ❤️‍🩹 is the alternative. Kyle's call; one line to change.
5. **Agent toggle vs. redelivery.** The spec says "set/replace/toggle like a person's"; a toggle replayed from the
   outbox after a crash flips the reaction off. The agent path is set/replace only (idempotent); removal is not
   offered. Deviates from the spec deliberately.
6. **The ack must land live.** Not in the spec: without step 3 the 👍 appears only after reload, which is exactly
   the UAT claim ("👍 ack lands on his message before the result"). Step 3 is required, not optional.
7. **`engine.ts` is at the cap.** Step 0 is mandatory before any engine edit; the ratchet fails otherwise
   (`scripts/check-file-sizes.mjs`).
8. **Two traps on the production path:** `drain()` routes non-`user` kinds to `beginHandoff` (`engine.ts:223`), and
   `openTurn` types the row and feeds its URLs to the browser (`intake.ts:51-54`). Both are tested (T5).
9. **Deferred turn, sync socket answer.** `react()` stays synchronous for the socket (`socket.ts:40-43`); the turn
   runs in `Background`. A refusal still answers the socket; a turn failure is drawn by `turn_failed` as today.
10. **A Stop during a reaction-started turn** reports queued reaction rows as "messages not taken up"
    (`stop.ts:36`). Cosmetic; left as is and noted in the part report.
11. **The chats list time does not move on a reaction** (`store.lastAt()` reads turns, notices, links). A reaction
    that starts a turn moves it; an ambient one does not. Matches "ambient"; noted.
12. **Toggle-off then on is a duplicate row** (same id), so a person cannot "re-send" a yes by toggling. Acceptable
    since the agent already proceeded; a new question gets a new `mid` and a new row.
13. **`Intl.Segmenter` in workerd:** supported in the Workers runtime and Node 22; no precedent in the codebase
    (`grep` finds none). If the typecheck lacks the lib, the fallback is `/^\p{Extended_Pictographic}/u` on a string
    of length ≤ 16 with no second pictographic start; T4 pins the accepted and refused cases either way.

## 9. Proposed part text (for Kyle's plan session; not written by this session)

`docs/plan/parts.md`, after F8 (F9 reserved for hover parity):

> ## F10 Reactions, full circuit: the agent reacts, reactions reach the model, a reaction answers a question
>
> **Read:** this plan (`docs/briefs/reactions-plan-fable-2026-10-23.md`), the spec and dump beside it,
> `packages/agent/src/chat/message-actions.ts`, `history.ts`, `frames.ts`, `mailbox.ts`, `intake.ts`, `engine.ts`,
> `context/assemble.ts`, `assemble-turn.ts`, `tools.ts`, `tools/search.ts`, `http/app/message-actions.ts`,
> `http/app/chat.ts`; `VISION.md` ("it asks before it acts": a reaction is never a grant decision).
>
> **Scope:** (1) a `react` tool in the core namespace queues a `react` effect; the outbox stores it under the
> reactor `agent` and broadcasts `reaction` with `by: "agent"`; any single emoji grapheme, on the person's messages
> alone, set or replace. (2) Standing reactions ride each turn's envelope as a fenced `chat:reactions` block naming
> reactor, emoji and message id. (3) A reaction on the agent's last message when that message asked a question
> (and no turn runs, and the latest turn ended done without a card) becomes a `reaction` mailbox row carrying the
> harness signal, starting or steering a turn; it draws no bubble. Any other reaction is ambient. (4) History and
> the frame collect reactions by `by`; the page draws one pill with both; the person's bubble is named on
> `turn_started`/`queued` so a reaction lands live. (5) `CHAT_TASK` teaches when to react.
>
> **Acceptance:** `test/workers/f10-reactions.test.ts` and `test/workers/f10-reactions-page.test.ts` (claims T1–T5
> of the plan: collected pill; envelope block fenced by mid with a byte-identical prefix and a clean transcript;
> live naming; the agent's 👍 before its words, stored, reloaded, replaced, refused by code for a bad emoji, its own
> message or an unknown id; the question case starts a turn reading the signal with no bubble and no URL-table
> write, the ambient case starts nothing, a card case starts nothing, the steer case, the duplicate case), each
> guard planted. Kyle's UAT on staging: react 👍 to a fletch question → it proceeds; ask for a job → 👍 lands on
> his message before the result.
>
> **Not in scope:** other people reacting (admission stays owner-only); removing an agent reaction; an explicit
> ask marker (follow-up if the `?` rule misfires); reaction notifications outside the chat; counts; custom emoji;
> F9's hover-reveal changes.
>
> **Rulings:** Ruling: the pending question is the agent's last drawn message carrying `?` — because the ASKING
> contract makes that the agent's convention and the engine holds no other state — if wrong, an explicit
> `awaiting_reply` marker on the turn replaces the test. Ruling: the agent's reaction is set/replace, never toggle —
> because the outbox replays an effect after a crash and must land on one state — if wrong, a `remove` flag joins
> the tool. Ruling: reactions enter context through the envelope, never the stored transcript — because they
> change after the fact and the envelope is the per-turn, unpersisted, replayed block — if wrong, a harness message
> is appended at assembly and recorded for replay.

`docs/plan/PROGRESS.md` row: `| F10 | TODO | | | Reactions, full circuit: the agent reacts (core `react`, outbox,
`by: "agent"`), standing reactions ride the envelope fenced as `chat:reactions`, a reaction on the agent's last
question starts or steers a turn as a `reaction` mailbox row, the pill collects both reactors. |`

## 10. Build brief (plan-direct; paste to the build session)

You are the build session for **F10, reactions full circuit**, on the fletch checkout. Read, in order:
`CLAUDE.md`, `docs/plan/KICKOFF.md`, this plan (`docs/briefs/reactions-plan-fable-2026-10-23.md`),
then the spec and dump beside it. Confirm the part id and tag against `docs/plan/parts.md` at kickoff (F10 unless
Kyle renumbered); if the part section is not in `parts.md` yet, stop and say so — a build session never adds a part.

**Base and branch.** Start from `origin/main` at `aa122a3` (or its current head if newer): `git fetch origin
+refs/heads/main:refs/remotes/origin/main`, then `git switch f10-reactions` (it already exists on `origin`, carrying this plan, the part section and the TODO row on top of `aa122a3`). Do not branch from
`f9-hover-parity` (it holds no code). If F9 merges during the build, rebase onto `origin/main` before the final
accept and re-run `test/workers/m29-message-actions.test.ts` and `m27-chat.test.ts`.

**Order of work.** Plan §2 steps 0 → 5, tests first for each step (§3), committing per step. Step 0 (move
`flushOutbox`/`startSubagents` to `chat/outbox.ts`) comes first because `engine.ts` is at the 600-line cap. Step 3
(name the person's bubble on `turn_started`/`queued`) is required for the UAT claim, not optional.

**Rulings you inherit (do not re-decide):** pending question = the agent's last drawn message with `?`, no turn
running, latest turn `done` with `code === null`; a reaction is never a grant decision; agent reaction is
set/replace, not toggle; reactions enter context via the envelope; the care register is 🫶; the agent reacts to
the person's messages only; `by` on frames and history is `"you" | "agent"`. Log the three two-way rulings in
`docs/decisions/log.md` as one dated F10 line. Anything that looks like a one-way door (a storage schema change —
none is planned; the reactor id reuses the existing table) is a question in `docs/plan/QUESTIONS.md`, not a choice.

**Guard-rails.** Never edit `scripts/accept.ts`, `scripts/check-*.mjs`, `scripts/scans.ts`, `.claude/settings.json`,
anything under `.claude/hooks/`, or `docs/plan/KICKOFF.md`. Never edit `packages/agent/src/http/app/tokens.ts` or
`icons.ts` by hand (`pnpm ds`). Fix what a hook reports; never bypass one. No sleeps, no retries in tests
(`scripts/check-test-hygiene.mjs`); wait on state (`await chat.settled()`, `w.fake.reached(...)`). Run tests in a
clean environment: `env -i PATH="$PATH" HOME="$HOME" QYVR_HERMETIC=1 pnpm exec vitest run <file>`. Never pipe a
gate into `tail`/`head`/`grep`; write to a log and read it. Fixtures use only `test/fixtures/people.json`
identities (`ada` = sam-solo, `pat-solo` for the second member).

**Commits.** Conventional, signed off, naming the part: `git commit -s -m "feat(agent): F10 the agent reacts: core
react tool, react effect, by on the reaction frame"`, `test(agent): F10 …`, `refactor(agent): F10 flushOutbox moves
to chat/outbox.ts for the file cap`, `docs(plan): F10 done at <sha>`. End every commit message with
a `Co-Authored-By:` line naming the model that actually wrote the commit. Show `git log -1 --oneline` and `git status --short`
after each.

**Gates.** Per step: the touched test files. Before the final run: `pnpm check > "$LOG" 2>&1; echo "check exit $?"`,
then `pnpm accept F10` in full, pasted unabridged (tree hash, counts, the `ACCEPT F10: PASS` line). Then the
verifier per KICKOFF step 5 (fresh Opus sub-agent, `docs/plan/VERIFIER-PROMPT.md` unchanged, the part section,
`git diff origin/main..HEAD`, the accept output); fix blocking findings; re-accept. Update `docs/plan/PROGRESS.md`
(KICKOFF step 6), push, open a draft PR titled `F10: reactions, full circuit` ending its body with
`🤖 Generated with [Claude Code](https://claude.com/claude-code)`. Do not merge.

**End-of-run summary (print exactly these three blocks):**
```
FILES CHANGED
<path> — <one line: what changed>            (every file, src and test, docs)

TESTS
accept: ACCEPT F10: <PASS|FAIL>, tree <hash>, <n> passed / <n> failed (<n> of this part in <k> files)
verifier: <its last line>
deleted/changed existing claims: <file:line — why>

UAT LEFTOVERS (for Kyle on staging, by eye)
- react 👍 to a fletch question → it proceeds without a typed reply, no stray bubble
- ask fletch for a job → 👍 lands on your message before the result, survives reload
- the picker still offers the six; the pill shows the agent's and yours together
- <anything the build could not prove hermetically, with the reason>
```
