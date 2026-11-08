---
id: D-0024
title: Every Muse Spark request extends the one before it, so Meta's prompt cache keeps the history
status: accepted
door: two-way
decided: 2026-11-02
decider: agent
confirmation: test/workers/f1-prompt-cache.test.ts
revisit-when: fletch moves chat to Meta's Responses API, Meta documents mid-conversation system messages staying in place, or the slot measurement drops below 90% of input cached
---
Ruling: a chat request to Muse Spark carries `prompt_cache_key` `fletch:<tenant>` and `prompt_cache_retention` `24h`
(`requestBody` in `packages/agent/src/model/transport.ts`); the runtime envelope goes to Meta as a user message in its
place (`toWire`'s `envelopeAs`); each turn's envelope is kept in chat meta by the user message it was sent before and
sent again there on every later turn (`liveTranscript` in `packages/agent/src/chat/assemble-turn.ts`); and a session's
tools are the eager namespaces, then the loaded ones in load order (`ToolSession`) — because Meta's cache reuses a
request's prefix only up to its first changed byte, and only on the backend that computed it, and on a preview slot
this took the share of input served from cache from 33% to 96.6% — if wrong, each part comes out on its own line.

## Context

Kyle's Meta bill for 2026-11-01 showed $0.00 of cached input against $0.90 uncached at Contributor prices ($0.002 and
$0.10 a million), so at most about 23% of input was cached. Meta caches automatically by prefix
(dev.meta.ai/docs/prompt-caching, read 2026-11-02). The hermetic requests were already 95 to 99% byte-identical to the
one before. The live measurement was a probe on preview slot 2: two chats of three tool-using turns each, every Muse
call's `cached_tokens` read from the slot's Ledger, and every request body recorded by a temporary test-host op.

- **As shipped, 33%.** Hits were all or nothing: two steps of one turn seconds apart missed more often than they hit,
  which is requests landing on backends that do not hold the prefix.
- **With the key and retention, 64%, then 88% warm.** Every step within a turn now hit, but every turn's first
  request stopped at the same token count: the end of the stable prefix (10,353, or 10,737 with `files` loaded).
- **The cause.** Meta's Chat Completions treat `system` as `developer` and fold instruction messages "by role, not
  position" (dev.meta.ai/docs/protocols/chat-completions, read 2026-11-02). Each turn's new envelope, a system
  message, landed right after the stable prefix and changed everything after it. Two smaller breaks were ours: the
  turn before's envelope was dropped from its place, and a namespace loaded mid-turn came back in registry order.
- **With all of it, 96.6%.** A turn's first request reuses the whole turn before (17,137 of 17,448 tokens); the one
  remaining partial miss is the turn after a namespace loads, whose tool reference changes once.

## Options

- **Chosen:** one key per tenant, the longest retention, the envelope positional on Meta's wire and kept in place
  across turns, and a stable tool order. The engine still builds the envelope as a system message, so Workers AI
  receives what it did.
- Rejected: a key per person or per chat. Meta advises one key per shared prefix, and a deploy's chats share theirs.
- Rejected: the envelope as a system message to Meta. Folded, it changed the prefix every turn.
- Rejected: storing the envelope as a transcript row. Compaction and the history would then read it.
- Rejected: moving to the Responses API now. It is a different protocol for the adapter, and the measured gap is
  closed without it.

The envelope's facts reach Meta at the user level rather than the developer level. A colleague's text reaches the
model fenced (`person:<id>`), with marker-like text defanged, so it cannot pass for an envelope. The owner's own text
could imitate one, but the owner is the principal. No capability reads the envelope: the gate decides every call.
