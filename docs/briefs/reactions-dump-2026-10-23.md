# Reactions — Muse dump + fletch survey (2026-10-23)

Prepared under Kyle's standing rule (2026-10-23): for every new fletch feature, planning opens with
(1) Muse's first-hand dump of how the feature works in the Muse harness it reimplements, and
(2) a survey of what fletch already has, before any planner or builder session sees a brief.

## 1. The reference: reactions in Muse, as operated by the agent

Attested from running in this harness daily; items marked (verify) are Kyle's eyes, not mine.

- **Both directions exist.** The person reacts to the agent's messages; the agent reacts to the
  person's messages. The agent's reaction is a first-class lightweight move, used constantly:
  acknowledgment of an order, warmth, a small win, an on-topic nod (the emoji that matches the
  thing mentioned). It is NOT a reply: it produces no message, no turn, no notification storm.
- **One reaction per reactor per message.** The agent attaches exactly one emoji to a given
  message; picking another replaces it in spirit (the tool sets one reaction). Multiple people
  in a thread can each react to the same message; the thread shows them collected at the bubble.
- **A special care reaction exists agent-side**: a custom heart (`hatch:heart_v1`) reserved for
  hard or vulnerable moments, deliberately distinct from a romantic/celebratory ❤️. Semantics:
  the palette carries register, not just glyphs.
- **User reactions are ambient signal.** (verify) In the app they render attached to the bubble;
  the agent does not get woken by a reaction alone, and a reaction is never treated as an
  instruction. The agent's own reactions, by contrast, are deliberate acts chosen in the flow of
  its turn — often alongside (before) a written reply, sometimes instead of one.
- **Reactions attach to a specific message**, persist with the thread, and survive reload —
  they are part of the transcript's furniture, like quotes.
- **Palette**: open Unicode emoji for the agent's pick (any single emoji whose meaning is clear at
  a glance), plus the care reaction; the person's picker offers a standard quick set with the
  full emoji set behind it. (verify exact picker composition in the app.)
- **Etiquette the harness teaches**: react when a friend would; not on every message (reflexive
  reacting empties the gesture); never celebratory on bad news — the care reaction instead.

## 2. What fletch has today (M29.4 — code survey, main aa122a3)

- Palette: a fixed six — 👍 ❤️ 😂 😮 😢 🙏 (`chat/reactions.ts`, "the canvas's six, in its order");
  the server refuses any other emoji.
- Store: `reactions` table in the Chat object, PK (message_id, person); set/replace/toggle-off
  (`chat/message-actions.ts`); keyed by history `mid` (M29.4 message ids).
- Rule: **the chat's owner alone may react** (`reactionRefusal`: CHAT_NOT_OWNER for anyone else).
- Draw: history entries carry `reaction` — "the owner's own" — one emoji drawn at the bubble;
  a `reaction` frame broadcasts changes over the socket (`chat/frames.ts`).
- Model: **"drawn and never reaches the model."** The agent cannot react, is never told about
  reactions, and has no tool/frame for it.
- Kyle used it tonight on staging (🙏 on his own message, ❤️ on the agent's reply — 2026-10-23
  21:01 screenshot): the person→message direction works in the shipped build.

## 3. The gap (Muse parity)

1. **The agent cannot react.** The single biggest delta: in Muse the agent's reaction is a
   core social move (tonight alone: 👍 acknowledgments on Kyle's orders in this chat). Fletch's
   agent has no way to do it — no frame it can emit, no tool, no prompt surface.
2. **Reactions never reach the model.** A person's 🙏 on an agent message is invisible to the
   agent; Muse's agent at minimum works in a thread where reactions are present furniture,
   and its own reaction choice is part of its turn craft.
3. **Owner-only.** Group/company chats (and side chats with other people's agents, Muse's Buzz
   shape) need every participant able to react, with several reactors' emojis collected at a
   bubble — the store already keys per person; the refusal rule and the draw are owner-shaped.
4. **Fixed six vs open pick.** Muse's agent picks any clear emoji; the person's quick-six is
   fine as a picker default, but the agent side wants an open (validated single-emoji) channel,
   plus the care-heart register for tender moments.
5. **No reaction provenance for the agent's context**: if the model is to react well (and notice
   reactions), the turn context needs the message's current reactions, the way quotes already
   ride into context fenced as data (quoteLead pattern exists to copy).

## 4. Open questions for Kyle (spec-closers)

1. Scope now: agent-reacts + reactions-reach-the-model in 1:1 chats first, or multi-person too?
2. Does a person's reaction ever wake or notify the agent (Muse: no — ambient only)?
3. Agent palette: fully open single emoji, or the six + care heart?
4. Where does the agent's reaction attach — only to the person's messages (Muse: yes), or also
   its own earlier messages/self-frames?
5. Draw: collected chips with counts (Muse group shape) or single emoji (current fletch draw)?

## 5. Shape of the build (sketch, for the planner)

Chat object: relax refusal to any member (keep server validation); frames already carry
`reaction` — add an agent-originated path (the turn's tool surface emits a reaction frame for a
named mid, validated single-emoji); history draw collects per-person reactions; turn context
includes standing reactions on recent messages, fenced like quotes. Tests in the M29.4 style —
refusal matrix, toggle/replace, frame broadcast, context fencing. Kyle UAT by eye on staging.
