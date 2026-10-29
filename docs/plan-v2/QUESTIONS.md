# Questions for Kyle

Each question: `### Q<n> (F<n>), <date>: <title>`, then **Blocks:**, **Recommended answer:**, and once given
**Answered (Kyle, <date>):**. An answer that settles a decision updates its record in `docs/decisions/` in the same commit.

## BLOCKED (open)

### Q1 (F1), 2026-10-22: A throwaway account for the live exit test

**Blocks:** F1's last acceptance claim, one passing run of `test/live/f1-deploy.live.test.ts`, and the tag `v0.1.0`.

**Recommended answer:** create a free-plan Cloudflare account used for nothing else, add its id and a token
(Workers Scripts, R2 and Vectorize: Edit; Workers AI: Read) as the repository secrets `CF_LIVE_ACCOUNT_ID` and
`CF_LIVE_TOKEN`, and run the live-deploy workflow once (`docs/runbooks/live-deploy.md`). The same account can close
the free-plan spike (Q2).

## Open, not blocking

### Q9 (F14), 2026-10-27: May a session record Kyle's acceptance relayed by the person orchestrating for him?

**Blocks:** nothing now. F14 is DONE under an override, and this question decides whether that override stands as
the rule. Three fresh verifiers (`docs/plan-v2/VERIFIER-PROMPT.md`, unchanged) passed every scope line, test and guard
rail of F14 and still answered `VERIFIER: blocking findings` on provenance alone, for two reasons. First,
`decider: Kyle` on D-0011, a one-way door, was written by the session, quoting the session's user. Second, Q8 was
moved to Answered by the session, while `docs/plan-v2/KICKOFF.md` says "Kyle moves it to Answered". The session's user,
acting for Kyle at his request, overrode the verifier on 2026-10-27 and had F14 marked DONE. `KICKOFF.md` lets "the
session, quoting him" set a record to accepted. The verifier reads that as Kyle's own words only, and it cannot see
a chat, so any session-recorded acceptance fails it.

**Recommended answer:** Kyle confirms D-0011 by his own commit on the record, for example a one-line edit to its
Context, so the one-way door rests on his hand, not on a relay. Then he picks one rule and writes it into
`KICKOFF.md` and `VERIFIER-PROMPT.md` together, because they disagree today:
- (a) A one-way record's acceptance, and a BLOCKED question's move to Answered, are always Kyle's own commit. This
  is the safer option: the verifier can check it from git alone.
- (b) A session may record them when it quotes Kyle, or a named delegate of his, with the session link, and the
  verifier accepts that.

Until he does, a verifier on any part with a session-recorded acceptance will flag it again.

### Q6 (F4), 2026-10-23: D-0010 is a stub until the artifact record lands

**Blocks:** nothing. `docs/plan-v2/parts.md` cites D-0010 (the artifact plan's record, "proposed on Kyle's thread") in the
F4 to F7 preamble and in F4's and F6's rulings, but the record was never in this repository, so
`node scripts/check-decisions.mjs` failed at 391af92 and with it every `pnpm check`. F4 added
`docs/decisions/0010-artifact-collection-address.md`, a `proposed` stub that states only what the plan cites it for
(`/library/artifacts/<slug>`, the id in segments) and binds nothing.

**Recommended answer:** replace the stub with the record from the artifact thread, keeping the id D-0010, before F6
starts (F6 must leave that collection free). The alternative, rewording the plan's citations, edits other parts' text
and loses the link.

### Q2 (F1), 2026-10-22: Run the free-plan spike for Code Mode and Images

**Blocks:** nothing yet; it decides whether `create-fletch` adds `LOADER` and `IMAGES` by default or only with
`--paid` (D-0004).

**Recommended answer:** run it on the Q1 account (`docs/runbooks/free-plan-spike.md`) and paste the table.

## Answered

### Q8 (F14), 2026-10-26: Accept D-0011, the parent's owner-checked read of a sub-agent facet's transcript

**Blocks:** F14's transcript half, so F14 cannot reach `ACCEPT F14: PASS`. The buildable half is on the branch
`claude/fletch-f14-subagent-steps-q7ko2x`: `groupIdOf`, the launch step's detail from the rows, the task answer's
`subagents` sections numbered `01`, `02` and nested by depth, the verdict step in the parent from the same stored
value the chat handoff carries, and Pat's read refused `CHAT_NOT_OWNER` before any row is read. Every child's steps
answer `SUBAGENT_STEPS_UNAVAILABLE`, because D-0011 (`docs/decisions/0011-subagent-transcript-read.md`) is
`proposed`, a one-way door (a new read across the facet's storage boundary), and no session may accept it. Waiting
on it: `SubAgent.transcript()` on the facet (Scope 3), the child's steps from `stepsOf` with "Handed off" last
(Scope 4), and the acceptance claims on the child's setup steps, a failed child's steps up to the failure, the
planted reader that takes the person from the request, and a facet whose read throws (today no facet is read, so the
branch's test of that claim can only check the refusal by name). Two tests under `[F14] the child's own steps (waits on
D-0011)` in `test/workers/f14-activity-subagents.test.ts` state the first two and fail today.

**Recommended answer:** accept D-0011 as proposed (set `status: accepted`, `decider: Kyle`). The transcript half
waits on D-0011: the facet's transcript is the only copy of a child's steps, and the parent already holds the
authority on every spawn, so the parent checking its own row's `person` before calling the facet's one read is the
smallest boundary that lets the drawer show a delegation's steps. The alternative in the record (the facet returning
its tool calls in `SubAgentResult` for the parent to store) is a new content store and a schema decision of its own.

**Answered (Kyle, 2026-10-26, relayed):** the session's user, who acts for Kyle when orchestrating these sessions,
wrote "D-0011 accepted, build the transcript half. Kyle accepted D-0011 in chat just now." Asked whether they were
Kyle accepting it himself, they answered "confirmed". On 2026-10-27 they said they act on Kyle's behalf, at his request.
Kyle has not moved this question or edited D-0011 himself (Q9). D-0011 is accepted (`decider: Kyle`), and
the transcript half is built on the same branch. The two tests this question names as failing were folded into the
part's tests, which pass: `[F14] sub-agent sections and the launch step`, `[F14] the verdict in both places` and
`[F14] who reads a child's transcript`.

### Q3, 2026-10-22: Preview slots on the shared account reach production's data

**Blocks:** accepting D-0008. `pnpm preview` works today on the shared account (`docs/runbooks/preview.md`).

**Context:** the slot token cannot redeploy production, but a binding is not checked against the deploying token, so
anyone holding it can bind qyvr.dev production's buckets, databases or services into a slot Worker and read them
(measured with a stand-in bucket, D-0008).

**Recommended answer:** put the preview pool on a Cloudflare account used for nothing else: create it, run
`pnpm preview provision` and `pnpm preview token` there (the inventory and the token name its account), and set the
cloud environment's `CLOUDFLARE_ACCOUNT_ID` to it. The alternative is to accept the gap and D-0008 as it stands.

**Answered (Kyle, 2026-10-22):** "accept the gap and keep previews on the shared account." D-0008 is accepted.

## Closed

Closed by the pare-down of 2026-10-29 (the parity framework v2, §5.1): the part each question served was folded into
a spine cluster, and the question returns, if at all, with that cluster's contract.

### Q7 (F7): closed 2026-10-29, folded into P1

F7 (the address survives sign-in) is folded into P1's contract; the one-way login record returns as a `proposed`
record when P1 is translated. The original question:

**Blocks:** F7, whole part. The part changes the published `@qyvr/host-cloudflare` login contract (one-way
door), so under the runbook it cannot start until Kyle accepts the record proposed in the F7 plan (2026-10-23):
after sign-in the host honours `/login?next=<path>` only for an absolute same-origin path not under `/login`,
else `/`, with the open-redirect shapes planted in the part's tests. The fallback inside the part, if Kyle
prefers no host change: a short-lived same-site cookie set by the agent on the sign-in redirect, read once at
boot — then the record is two-way and the session sets it.

**Recommended answer:** accept the record as proposed (Kyle was asked in chat 2026-10-23; the ask stands until
he answers).

### Q4 (F2): closed 2026-10-29, folded into P1

Whether a stored search index is ever needed is a P1 task (a search over Kyle-scale history on a preview, measured),
not a standing question. The original question:

**Blocks:** nothing. F2 derives the index at query time (F2, Ruling 1): each `Chat` scans its own `messages` table
for its owner, and `/app/search` fans out to every live chat as `/app/chats` already does, so F2 binds no storage
schema. This question decides whether a later part adds an FTS5 table to each `Chat` object, a storage schema and so a
one-way door (D-0007), and when.

**Recommended answer:** not yet. Measure F2 on a preview with Kyle's real history (the time of one `/app/search` with
a query, the number of live chats). Add the stored index only when a search exceeds a second or the owner passes about
200 live chats; then it is a `chat.search-index` migration (an FTS5 external-content table over `messages`, written in
the same transaction as `appendMessage`) under a `proposed` record for Kyle to accept, and F2's substring matching gives
way to the tokeniser's. The alternative, building the FTS5 table in F2, spends a one-way door before the scan has been
measured slow.
