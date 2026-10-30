---
id: D-0020
title: The agent reaches models two ways, Workers AI and Meta through an AI Gateway, with no fallback model; invalid model vars fail every call by name
status: accepted
door: two-way
decided: 2026-10-30
decider: agent
confirmation: test/workers/f1-models.test.ts
revisit-when: an owner needs a third provider, or Muse Spark's failure rate makes a turn on it worse than a turn on Workers AI
---
Ruling: `packages/agent/src/model/` reaches Workers AI over the `AI` binding (through `AI_GATEWAY_ID` when set) and,
for the chat route only under `CHAT_PROVIDER=meta` with a gateway, Muse Spark 1.3 Contributor through the gateway's
custom provider `meta`; nothing else, and no call is re-sent to another model — because Kyle chose "just Workers AI
and gateway" for a standalone fletch (2026-10-30), and one path per call keeps each eval answer attributable to one
model — if wrong, a fallback returns as its own record, for one provider, with its own tests.

## Context

Until now the chat route could run on OpenRouter or Meta through the gateway, hedged to Workers AI: a second request
started after 5 s without a first token or on a 408, 429 or 5xx, and the first stream to answer won (M22.1). The
hedge was a second code path (`hedge.ts`) that mixed two models into one turn, and a var had to switch it off for an
eval to measure the configured model alone. OpenRouter had no remaining user.

## Rulings

- **No fallback model.** A Spark failure is the turn's, by its code; it is not re-sent to GLM. The unhedged path
  keeps its 429 Retry-After loop (at most 3 retries, 60 s cap) and one transient retry, and the chat route's
  `CALL_BOUNDS.chat.totalMs` (180 s) now bounds the whole call, waits and retries included, since no race ends it.
- **Misconfiguration is a per-call refusal, not a constructor throw.** `modelConfig` never throws (a Durable Object
  constructor that throws is a 500 to the owner); `CHAT_PROVIDER=meta` without `AI_GATEWAY_ID`, or any value but
  `workers-ai` and `meta`, sets a fault, and every model call, embeddings included, fails with
  `MODEL_CONFIG_INVALID` and a reason naming the var, before any network and recorded as `refused`.
- **One request builder.** With OpenRouter gone the two bodies differ only in `model` and
  `stream_options: { include_usage: true }`, both added for Meta alone; the gateway's `/compat` path was not tried.
- **Pricing.** A Ledger row is priced by the model that answered when `PRICES` lists it, else by the model asked
  for, so a provider's dated id is charged its own price, never the unpriced fallback. The `provider` column holds
  `workers-ai` or `meta`.

## Options

- **Chosen:** two providers, one builder, no fallback.
- Rejected: keep the hedge for Meta only (two code paths again, and an eval's answer could be either model's).
- Rejected: fall back to Workers AI when the vars are wrong (a quiet answer from a model the owner did not pick).
- Rejected: throw from `modelConfig` (a 500 on every request to the deploy instead of a named failure on a turn).
