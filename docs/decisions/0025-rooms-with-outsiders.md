---
id: D-0025
title: fletch's agent speaks in a room with outsiders only as the owner's agent, through a transport Kyle names, behind a fence on every outsider's words; until Kyle rules, no room exists
status: proposed
door: one-way
decided: 2026-11-08
decider: agent
confirmation: review
review-by: 2026-12-31
revisit-when: Kyle rules on O4 (design §8), a messaging service is picked for rooms, or the first owner asks their agent to join a group
---
Ruling: fletch's agent reads and speaks in a room with outsiders (a group where people who are not the owner, or their
agents, write) only after Kyle opens four doors in order, (1) whether it speaks there at all (design O4), (2) under whose
name, only as the owner's agent and never as the owner through a connected account unless Kyle widens it (B-P8-01,
B-P8-11), (3) the room's transport, which messaging service, its egress host on the allowlist, its inbound path through
the Ingress object and a sender's identity bound to the channel and not to its words (B-P8-03, B-P8-04), and (4) the
storage, a `room` ChatKind, a per-room rule store the owner alone writes and a room audience on memory so nothing private
is copied into the room (B-P8-05, B-P8-06, B-P8-08), and until door 1 is ruled it creates no room, joins none and adds
no person to a chat (B-P8-10) — because each door is irreversible or a security boundary (who the agent is to outsiders,
what leaves the deploy and over which host, what the store holds), the Defaults let the orchestrator take none of them,
and Muse itself has no room today (its app cannot create a group and the owner has none) — if wrong, the record is
rejected and P8 stays mapped at level 0, with no code to remove.

## Context

The P8 interrogation of 2026-11-08 (`docs/plan-v2/contracts/P8-group-chats.md`, 11 clauses, 10 tasks, 4 deltas)
found Muse's rooms to be prompt and doc lines, not rows: no group, member, mention or relay table, no wake-on-mention
rule, no room fence, and a worker's handoff arriving unfenced as `message.internal`. Every clause is therefore a
mapping, and every P8 task and part waits on this record. The contract lists the four doors as DP-P8-1 to DP-P8-4 and
proposes deltas Kyle has not seen: fletch fences room text where Muse does not; fletch writes an Activity row per
refusal; one agent with an audience instead of a worker per room; no channel that writes under the owner's name until
(2) is ruled. Written by the orchestrator in Kyle's absence (`docs/plan-v2/ORCHESTRATOR-OVERNIGHT.md`, Queue 9); the
Defaults do not let the orchestrator take a one-way door, so this stays proposed and nothing is built on it.

## Alternatives rejected

- Build the mapping's tier-1 tasks now (the fence, the identity rule) as P2 and P15 work: they are real only once a
  room transport exists, and would plant guards on a path no request takes.
- Fold rooms into P1's side chats: a side chat has one principal; a room's audience is the whole point of this record.
