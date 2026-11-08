---
id: D-0026
title: Speech on fletch, if P13 is picked: Workers AI models for transcription and voice, a refusal by name where a deploy has none, no public feed, no kept voice audio and no live calls until Kyle opens each door
status: proposed
door: one-way
decided: 2026-11-08
decider: agent
confirmation: review
review-by: 2026-12-31
revisit-when: Kyle picks P13 (design §7, "by pick"), names the speech models and their spend, or rules on a public podcast feed, kept voice audio or live calls
---
Ruling: if Kyle picks P13, fletch transcribes a voice note and reads a reply aloud through Workers AI speech models on
the `AI` binding under a per-minute or per-character price the Ledger learns (`PRICES` in
`packages/agent/src/ledger/budget.ts`), a deploy without those models refuses by name (D-0001) through an agent-local
code until Kyle makes `speech` a published `HostFeature` of `@qyvr/host`, a generated audio piece is an artifact record
with a source and a file in R2 and never a public podcast feed, a voice note keeps its transcript and not its audio,
and there are no live voice calls — because each of the five is a one-way door (a published package's contract, new
spend on Kyle's account, public content leaving the deploy, a storage and privacy promise, a new always-on object) that
the Defaults let the orchestrator propose and not take, and Muse's own audio today is a loose file with no record,
no source and an unrevocable 48-hour public link, which fletch's artifact and egress rules already refuse — if wrong,
the record is rejected and P13 stays at level 0 with no code to remove.

## Context

The P13 interrogation of 2026-11-08 (`docs/plan-v2/contracts/P13-voice-audio.md`: 15 clauses, 14 tasks, 7 two-way
deltas, 5 one-way doors) found that Muse's read-aloud is the agent running a text-to-speech command and attaching the
mp3, that a generated audio piece leaves no attachment, media or artifact row and no source, that a voice note's
transcript is meant for `runtime.message_attachments.transcription_text` but the account holds no attachment row, that
a temporary public link needs one Allow once / Deny card per upload and cannot be revoked, and that a feed episode is
public with no unpublish line. The contract's five doors, in its order: (1) a `speech` HostFeature in the published
`@qyvr/host` against an agent-local code; (2) spend on Workers AI speech models (whisper-large-v3-turbo or nova-3 for
transcription, melotts or aura-2 for speech); (3) a public podcast RSS feed; (4) keeping voice-note audio in R2; (5)
live voice calls. Written by the orchestrator in Kyle's absence (`docs/plan-v2/ORCHESTRATOR-OVERNIGHT.md`, Queue 9) so
the doors sit on the index with a review date; nothing is built on it. The dump diff also found P14's slice moved
(`avatar.wear` gone, `ui.sidebar` new), recorded in Q42 for Kyle.

## Alternatives rejected

- Build the tier-1 refusal (T-P13-13) now under D-0001: its code (`HOST_SPEECH_UNAVAILABLE` or agent-local) is door 1.
- Treat the feed as P4's artifact sharing: a feed is a standing public endpoint, not a share link the person revokes.
