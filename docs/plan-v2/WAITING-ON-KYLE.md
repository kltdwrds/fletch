# Waiting on Kyle

The orchestrator writes here (`ORCHESTRATOR.md`); Kyle works the list at a check-in and ticks items in his own commits.
One item per entry: `- [ ] <date> <kind>: <what>`, kinds `uat`, `record`, `question`, `look` (something the
orchestrator wants his eyes on, not blocking). An entry carries enough context to make the high-level decision from
its paragraph alone (what it is, what was decided or found, what his answer changes, the recommended answer) and
deep links (a path with its heading or line, a record id, a PR) to the artifact or section for a deep-dive review.
Kyle's own lines go under `## Steering`.

## Open

- [ ] 2026-10-29 record: **put your own commit on D-0011.** What D-0011 decides: when a task's steps are opened in the
  activity drawer, the parent agent may read a sub-agent's transcript to show the child's steps, after first checking
  that the person asking owns the parent chat. That read crosses the sub-agent's storage boundary, so it is a one-way
  door that only you accept. It is marked accepted today, but the acceptance was relayed through the session's user on
  2026-10-26, never committed by you, and the verifier (rightly, per Q9) keeps flagging anything that rests on it.
  What to do: make any one-line edit to the record's Context and commit it yourself; that is the whole item. Nothing
  else is waiting on it, and F14 is already on main. If instead you do not want the parent reading a child's transcript,
  set the record to `rejected` and say so under Steering; F14's transcript half then comes out. Deep dive:
  [the record](../decisions/0011-subagent-transcript-read.md),
  [Q9](QUESTIONS.md#q9-f14-2026-10-27-may-a-session-record-kyles-acceptance-relayed-by-the-person-orchestrating-for-him),
  `test/workers/f14-activity-subagents.test.ts`.

- [ ] 2026-10-29 look: **the P1 reactions contract and its two deltas from Muse.** The interrogation of muse.ai on
  2026-10-29 found that every person reaction starts a Muse turn (a developer handoff block with a "nothing to do"
  escape), and that a person can react to their own message from the phone's ⋯ sheet. fletch keeps its shipped gate
  (a reaction wakes the agent only on a pending question; an ambient ❤️ rides in the next envelope) as delta 1, a
  two-way call the orchestrator took: no model spend per ambient reaction, at the cost that a ❤️ on personal news gets
  no reply until you write again. Delta 6 (own message reactable at phone width) is a finding fixed by F21, not a
  design choice. Say so if you want a wake per reaction instead, or own-message reactions kept. Deep dive:
  [Translation, deltas](contracts/P1-reactions.md#translation), [the finding against the dump brief](contracts/P1-reactions.md#clauses)
  (line "Finding against the dump brief"), [F21 in parts.md](parts.md#f21-reactions-a-persons-own-message-takes-no-reaction);
  evidence on your Mac under `docs/plan-v2/evidence/p1-reactions/` (`answers/step-*.md`, `step-*.png`).

- [ ] 2026-10-29 look: **the reactions specimen.** The owner-visible reactions surface, drawn from the muse.ai capture
  before F21 builds it (design §4.5): a chip that hangs off the bubble's inner corner (the person's a button that
  removes, the agent's a labelled image), the hover row and six-emoji picker on an agent message, a heart glyph in the
  warning colour for the care register, and the 390 sheets (an agent message: five reactions, More, Reply, Copy; your
  own message: Reply and Copy only). F21 draws it in the app without waiting; what you want changed lands as UAT on F21.
  Deep dive: the rendered page https://claude.ai/artifact/BnCGn9dkLDJByGgnzNEgNW (both themes, sheets inlined); the
  source is `packages/agent/src/design/fletch/ds/specimens/reactions.html`; the rules are the `Reactions (chat), F20` block in
  [`bundle.css`](../../packages/agent/src/design/fletch/ds/components/bundle.css); the check is
  `test/workers/f20-reactions-specimen.test.ts`; commit da209df.

- [ ] 2026-10-29 question: **Q12, stale briefs and counts, a read not a decision.** The dump brief
  `docs/briefs/reactions-dump-2026-10-23.md` read reactions as ambient only, and the design's §7 counts Muse's tools
  as 108 in 32 namespaces where the live `tools.json` holds 109 in 19 with 9 unavailable and no reaction function. The
  recommended answer: the briefs are deleted in the PR after F20 (design §5.1) and §7's count is corrected there; say
  so only if you would rather keep the briefs. Deep dive:
  [Q12](QUESTIONS.md#q12-f20-2026-10-29-the-dump-brief-and-the-designs-muse-counts-are-stale),
  [design §5.1 and §7](2026-10-29-parity-framework-design.md).
- [ ] 2026-10-29 question: **Q13, builders cannot open their PR.** The F21 builder (Opus, `--permission-mode auto`)
  finished the part, `ACCEPT F21: PASS` and `VERIFIER: no blocking findings`, then its `gh pr create --draft` was
  refused by the permission classifier ("Create Public Surface") and it looped on the block until the orchestrator
  opened PR #29 for it. Each part's last step will hit this. The recommended answer: allow `gh pr create` (and
  `gh pr edit`) for builder sessions in the project's permission settings, which only you may change; until then
  the orchestrator opens every builder's PR, which costs one wait per part and nothing else. Deep dive:
  [Q13](QUESTIONS.md#q13-f21-2026-10-29-the-f21-draft-pr-could-not-be-opened-from-the-session),
  [PR #29](https://github.com/kltdwrds/fletch/pull/29). Update 2026-10-29: the F22 builder, same command and mode,
  opened [PR #31](https://github.com/kltdwrds/fletch/pull/31) itself without a refusal, so the classifier is not
  consistent; the question stands until a setting makes it so.

- [ ] 2026-10-29 uat: **F22, the care register: a reaction on a win, a heart on hard news.** On main since
  [PR #31](https://github.com/kltdwrds/fletch/pull/31). What changed: the agent's `REACTING` guidance names three
  registers with an example each: a win (👍 first, then a short reply), hard news (🫶 or no reaction, a reply with no
  emoji in the text), a plain request (no reaction). Tier 2 on fletch-pv-1 went from 0 of 3 to 3 of 3 on both
  nice-to-have tasks (T-P1-06 the win, T-P1-09 hard news). What to try on a preview or your deploy: tell it some good
  news in one line and some bad news in one line; the win should get a 👍 chip on your bubble before the reply, the
  bad news a 🫶 or nothing and never a 👍. Report anything that reads wrong as a line under Steering; nothing is
  blocked on this. Deep dive: [F22 in parts.md](parts.md#f22-reactions-the-care-register-and-a-reaction-on-a-win),
  [PROGRESS.md F22](PROGRESS.md), `test/evals/p1-reactions/reacting-registers.test.ts`, the `REACTING` block in
  `packages/agent/src/`.

- [ ] 2026-10-29 look: **the P2 loop contract and its five deltas from Muse.** The interrogation of muse.ai (eight
  steps in one side chat: a quick question, a deferred-tool task, a long task, a steer mid-turn, a write with a
  barrier, a failed read plus a backgrounded command, an unserved capability, a reload) found that Muse has no text
  channel before a turn ends (the reply is written last and may split into bubbles), that a message mid-turn ends the
  turn and opens a new one with an interruption note, that a backgrounded command's completion opens a silent turn, and
  that failures and refusals are prose with the mark on the tool record. fletch keeps three shapes of its own as
  two-way calls the orchestrator took: the operating block as a cached stable prefix (delta 1), one streamed bubble and
  no split (delta 2), a steer folded into the running turn (delta 3); and adopts two things: a job's completion wakes
  the agent so it can act on a failure (delta 4, F24), and a file card in the thread instead of a URL unfurl (delta 5,
  F24: no preview fetch from your deploy on every link). Say so if you want link previews, split bubbles, or the steer
  to end the turn. Recommended: let F23 and F24 run; your findings come back as UAT items. Deep dive:
  [Translation, deltas](contracts/P2-loop.md#translation), [the clauses](contracts/P2-loop.md#clauses),
  [F23 and F24 in parts.md](parts.md#spine-clusters), [Q15](QUESTIONS.md#q15-p2-2026-10-29-three-things-the-p2-interrogation-attests-rather-than-instruments-and-two-dump-slice-oddities);
  evidence on your Mac under `docs/plan-v2/evidence/p2-loop/` (`answers/step-*.md`, `step-*.png`, `trace.json`).

- [ ] 2026-10-29 look: **the loop-status specimen (F24's surfaces).** Two things F24 will draw, settled in the design
  system first: the working line while a tool runs (the dots the thread already shows for "Thinking…", now with the
  activity in words from a table in the page: "Searching the web", "Reading p2-barrier.md"; Muse centres an avatar with
  a chip under it, fletch has no avatar in the thread, so the line stands where the reply will), and the file card
  inside the agent's bubble for a file it wrote (name, kind, four lines of preview, a link to the Library's viewer; the
  task drawer's card reused). A URL stays a link; a failure and a refusal are sentences. F24 starts once F23 lands;
  your findings come back as UAT. Rendered: https://claude.ai/artifact/Jx4GCJjJwCcdCMpYCkaziZ (light and dark, desktop
  and a 390 stage). Deep dive: `packages/agent/src/design/fletch/ds/specimens/loop-status.html`, the bundle block
  "Loop status and the file card (chat), P2" in `packages/agent/src/design/fletch/ds/components/bundle.css`,
  `test/workers/f24-loop-status-specimen.test.ts`, [B-P2-04 and B-P2-10](contracts/P2-loop.md#clauses),
  [deltas 5 and 6](contracts/P2-loop.md#translation).

## Steering

## Done
