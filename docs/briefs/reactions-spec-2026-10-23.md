# Reactions, full circuit — spec (2026-10-23, Kyle's direction)

Inputs: the dump (reactions-dump-2026-10-23.md — Muse reference behavior + M29.4 survey) and
Kyle's field report from staging tonight: he reacted (🙏, ❤️) and fletch's agent gave no sign of
having received them — because under M29.4 it can't: "drawn and never reaches the model."

## Kyle's two named use cases (the spec's center)

1. **Ack from fletch to the user.** When the agent starts work on something, it acknowledges the
   person's message with a reaction — the Muse pattern (a 👍 tap when a job begins) — instead of
   silence or a filler message. The reaction is the receipt; the reply comes when there's a result.
2. **Confirmation for questions.** When the agent asked a question or asked for a go-ahead, the
   person can answer with a reaction (👍 = yes) instead of typing. The agent must actually receive
   and process it — a reaction on a pending-question message is an answer, not decoration.

## Processing rules (decided here; the plan encodes them)

- A reaction is recorded, drawn, and broadcast as today (M29.4 store/frames stand).
- Reactions REACH the model: reactions standing on messages ride into the turn's context beside
  their messages, fenced as data in the quotes style — the agent knows who reacted what, where.
- A reaction does NOT start a turn on its own when nothing is pending (ambient, as in Muse) —
  EXCEPT the pending-question case: if the agent's latest turn ended on a question/confirmation
  ask, a reaction on that message is delivered as input (steering/intake path) and the agent
  continues, seeing "〈person〉 reacted 〈emoji〉 to your message '〈…〉'" as the signal. 👍 is the
  canonical confirm; the model interprets others in context of the question asked.
- The agent may react to a person's message: one emoji, set/replace/toggle like a person's.
  Canonical uses: the work-start ack, social register (incl. a care heart for tender moments —
  register matters, not just glyphs). A reaction never substitutes for a reply that owes words,
  and never ends a turn by itself.
- Who may react: any participant of the chat (M29.4's owner-only rule relaxes; the store is
  already per-person). Draw collects each participant's reaction at the bubble.
- Palette: the person's picker keeps the canvas six; the agent's channel accepts any single
  emoji (validated as one emoji grapheme), defaults being the six.

## Scope

1:1 chats are the proving ground (both use cases live there); nothing in the design may wall off
multi-participant chats — the per-person store and frames already generalize. Out of scope:
reaction notifications outside the chat, counts/leaderboards, custom emoji uploads.

## Acceptance shape

Hermetic tests in the M29.4 style: refusal matrix (non-participant, bad emoji, unknown mid),
agent-reaction frame emission + draw, reactions present in model context (fenced), the
pending-question delivery (reaction arrives as input; ambient case starts no turn), toggle/replace
parity for agent and person. Kyle UAT on staging by eye: react to a fletch question → it proceeds;
ask fletch for a job → 👍 ack lands on his message before the result.

## Sequencing note

F9 (hover parity) is in flight on branch f9-hover-parity and touches the same client surfaces
(message actions, tokens CSS). Build reactions after F9 merges, or branch from a main that
contains F9 — the planner names the exact base.
