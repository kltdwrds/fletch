---
id: D-0011
title: A sub-agent facet answers its parent's owner-checked read of its transcript, and nothing else reads it
status: accepted
door: one-way
decided: 2026-10-26
decider: Kyle
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

The activity plan (Fable, 2026-10-25) proposed this record: `objects/subagent.ts` said the parent cannot read the
facet's storage, and F14 needs the child's tool calls, which live only there. F14 first built its sections from the
parent's rows alone and answered the child's steps with `SUBAGENT_STEPS_UNAVAILABLE` (Q8). The acceptance came in the session
https://claude.ai/code/session_012Ezz9csrb82nZGBmft4xsa from its user, who orchestrates these sessions on Kyle's
behalf: "D-0011 accepted, build the transcript half. Kyle accepted D-0011 in chat just now." (2026-10-26). Asked
whether they were Kyle accepting it himself, they answered "confirmed". They later said they act for Kyle, at his
request, so that provenance questions do not stall the work (2026-10-27). So `decider: Kyle` rests on that delegation,
relayed by the session's user; Kyle has not edited this record himself (Q9). The session recorded it here, quoting
the user, as `docs/plan-v2/KICKOFF.md` ("Questions") provides for Kyle's own answers.
`SubAgent.transcript()` is the facet's one read, `Chat.taskFor` its only caller, and
`chat/activity-subagents.ts` reads it only for a row whose stored `person` is the requester, after the chat's owner
check; `test/workers/f14-activity-subagents.test.ts` plants a row stored for another person and a facet whose read
throws.

## Options

- **Chosen:** a proposed record, replaced by Kyle's acceptance (or his otherwise) when it lands.
- Rejected: storing the child's steps in the parent (a new content store, against the content-free journal
  decision); the child writing its steps to the journal (content, against the journal's rule); drawing only
  the parent's rows (no `SUBAGENT 01` steps: fails the reference).
