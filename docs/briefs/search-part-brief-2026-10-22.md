# Planning brief — search build-out (Fable, 2026-10-22)

You are the planning session for the fletch roadmap, run under
`docs/runbooks/muse-execution.md` section 2c. Kyle's plan session adds parts;
a part session never does. Your only deliverable is plan text, committed
locally. Do not push. Do not edit the guard-rail files
(`docs/plan/GOAL-PROMPT.md`, `docs/plan/KICKOFF.md`,
`docs/plan/VERIFIER-PROMPT.md`, `scripts/accept.ts`, `scripts/scans.ts`,
`.claude/settings.json`, `.claude/hooks/`).

## Read first

`AGENTS.md`, `VISION.md`, `docs/plan/parts.md` (its rules bind your output
shape), `docs/plan/PROGRESS.md`, `docs/plan/QUESTIONS.md`,
`docs/decisions/README.md`, `packages/agent/src/http/app/search.ts`, the
`/app/search` route in `packages/agent/src/http/connector-routes.ts`, and
however messages are stored and read (`packages/agent/src/objects/chat.ts`
and what it calls) — the index design depends on it.

## Kyle's steering (the owner, verbatim intent)

1. Build the real fix, not a copy tweak: message-content search. His words:
   "Yeah proper build out with real fix — let's run the process."
2. "Look at the designs. There's a double 'x' — one for clear and one for
   the search dialogue." The dialog currently shows two close glyphs side by
   side when a query is present; close that gap in function and UI/UX.
3. The design bar is the Muse app's own search (from the owner's
   screenshots of muse.ai): the dialog's results pair each chat's title with
   the matched message line as a snippet and a relative time; an empty
   query lists recents; there is one clear control in the field.
4. "In search, the chat nav sidebar should be its own UI/UX": in the Muse
   app, the sidebar's search filters the chat list in place and matches
   message content, showing snippets under each chat. Fletch's drawer search
   is currently just a launcher for the modal dialog.
5. Motion on dismissal: "when clicking out of the search it animates and
   fades the darkened bg before the search disappears… weird UX — search
   should disappear fast and immediately in parallel with the background
   change."

## Measured findings from the owner's preview session (fletch-pv-1)

- `/app/search` today returns chats whose *title* contains the query plus
  chats that memory search finds a saved line in. Message bodies are never
  searched. Searching "think" with the word on screen in the open chat
  returns "No results". The memory half ran (no failure note); it genuinely
  had nothing.
- Design references the owner shared (Claude Design artifacts — consult if
  reachable from this machine; if the sign-in wall stops you, proceed on the
  screenshot-derived spec above and say so in the part's Read line):
  https://claude.ai/artifact/DmpRhrpke44XKNgHQoUL7r
  https://claude.ai/artifact/Q2ofeiSAvQMtdGjdyPZoiN

## Your task

Write the next part(s) into `docs/plan/parts.md` under `## Next parts`, in
the file's exact shape (**Read:** / **Scope:** / **Acceptance:** /
**Not in scope:** / **Rulings:**), numbered from F2, and add a TODO row per
part to `docs/plan/PROGRESS.md`. Split into two parts if the scope separates
naturally (e.g. the message-content index + route vs the search surfaces'
UI/UX and motion), each independently acceptable by `pnpm accept F<n>` with
its own `[F<n>]`-tagged tests named in Acceptance. Cover all five steering
points across the part(s); say explicitly where each one lands.

Decisions: a part names a one-way decision it needs as a blocker in its
Read line — never take one yourself, and never write `decider: Kyle`. The
search index's storage is the known candidate (a new index store vs a
derived index over where messages already live — if it binds a storage
schema, it is Kyle's). If a blocker exists, also write it under
`BLOCKED (open)` in `docs/plan/QUESTIONS.md` with a recommended answer, and
write the part so the unblocked scope is still buildable, or split so it is.

Commit locally with `git commit -s`, Conventional Commits
(e.g. `docs(plan): F2 message-content search`). End your final message with:
the parts written (numbers + titles), where each of the five steering points
landed, and any blocker questions for Kyle, verbatim.
