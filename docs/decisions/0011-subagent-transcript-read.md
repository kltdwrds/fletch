---
id: D-0011
title: A sub-agent facet answers its parent's owner-checked read of its transcript, and nothing else reads it
status: proposed
door: one-way
decided: 2026-10-25
decider: agent
confirmation: test/workers/f14-activity-subagents.test.ts
revisit-when: a sub-agent runs anywhere but as a facet of its parent Chat, or a facet's storage is retained
  on a different schedule from the parent's
---
Ruling: the `SubAgent` facet exposes one read, `transcript()`, returning its stored `Message[]`; only the parent
`Chat` calls it, after matching the child's `person` on its own `subagents` row to the requesting person; no
route, person or other object reaches a facet by name — because the activity drawer must show a delegation's
steps and the only copy is the facet's, and the parent is already the authority on every spawn — if wrong,
`runSubAgent` returns its tool calls in `SubAgentResult` and the parent stores them, which is a new content
store and a schema decision of its own.

## Context

The activity plan (Fable, 2026-10-25) proposes this record: `objects/subagent.ts` says the parent cannot read
the facet's storage, and F14 needs the child's tool calls, which live only there. This file is the proposed
record, written by the plan session so the plan's citations resolve; it binds nothing (`proposed`, one-way
door). F14 is blocked on Kyle accepting it: until then it builds the `SUBAGENT 01` section from the parent's
rows alone and answers the child's steps with `SUBAGENT_STEPS_UNAVAILABLE`, and records the half in
`docs/plan/QUESTIONS.md`.

## Options

- **Chosen:** a proposed record, replaced by Kyle's acceptance (or his otherwise) when it lands.
- Rejected: storing the child's steps in the parent (a new content store, against the content-free journal
  decision); the child writing its steps to the journal (content, against the journal's rule); drawing only
  the parent's rows (no `SUBAGENT 01` steps: fails the reference).
