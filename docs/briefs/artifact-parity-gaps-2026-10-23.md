# Artifact parity: Fletch vs Muse — gap pass (2026-10-23)

Source evidence: Kyle's 11 screenshots (4 of fletch staging, 7 of muse.ai) taken 2026-10-23,
plus the fletch codebase at main a164677c. Status: DRAFT for Kyle's agreement; the agreed
version becomes the input to a Fable planning analysis.

## What Kyle did on both

Asked the agent, in chat, "make me an artifact, anything will do."

- **Fletch (staging):** the agent hand-wrote `work/sudoku-poem.html` and announced it in prose
  — twice, in two variant messages, with raw `***"…"***` markdown showing. The Library
  (All artifacts / Documents / Images) showed "No … yet" everywhere. The right-hand
  "Your agent" panel showed "Nothing yet."
- **Muse:** the agent built the Concert Week board from Kyle's live ticket-watch data,
  presented it in chat as a card with a rendered preview, and it opened full-screen at
  `muse.ai/library/artifacts/concert-week`. The Library grid lists it among typed,
  dated artifacts with preview thumbnails and a Pin/Share/Download/Delete menu. The build
  is inspectable: a named activity entry, a subagent trace, an audit with severity
  findings, desktop + mobile screenshot checks, and an honest "exited with unresolved
  finding" note.

## Fletch today, from the code

- The Library (`packages/agent/src/http/app/library.ts`, M23.4/M27.5) is a **file** library:
  the person's files, sectioned by extension (md/txt/pdf/docx → Documents, html → web,
  images → Images, else System files), cards with Rename/Pin/Delete, a full-height viewer,
  a read-only Markdown DocumentViewer, copy-link/download. Its own header comment:
  "Web artifacts, Videos and Podcasts are the canvas's and have no object here."
- The agent's writing goes to the **working tree** `work/` (M24.3, the Agents SDK Workspace
  in the Person DO's SQLite) — a different store from the files the Library lists
  (`FILES_*` refusals). Nothing registers a work-tree file as a Library item.
- Agent tooling: a `documents` namespace (M24.3) — `render_document` (Markdown → docx/odt/
  html via a host Renderer, AD-8) saved as a Library item, and `share_document` (public
  link, approval card every time). On the staging host there is no Renderer, so
  `render_document` refuses; the agent fell back to a hand-written file in `work/` and
  narrated "the fancy document renderer isn't available in this build."
- No artifact verbs exist for the agent (no create/edit/inspect/status/present for
  artifacts), no artifact record/identity, no in-chat artifact card, no builder/audit loop.

## The gaps

- **A. Registration & identity (the core defect).** Agent output never becomes an artifact:
  two file worlds (agent `work/` tree vs Library files) with no bridge. No slug, no durable
  identity, no record — the Library is empty seconds after the agent says "Made you an
  artifact." Muse artifacts are first-class records with slugs and library presence.
- **B. Creation tooling.** No artifact namespace. The one document path (`render_document`)
  depends on a host Renderer that this host lacks, and the fallback is a raw file write the
  user never sees as an artifact. Muse: dedicated create/edit/inspect/status/invoke/present
  tools; creation delegates to builder agents and the caller follows status.
- **C. In-chat presentation.** Fletch: prose + a path, no card, no preview, no open
  affordance. Muse: an inline card with a rendered preview and title/type, one tap to open.
  Adjacent defects in the same screenshot: the completion message was delivered **twice**
  (two variants), and raw `***"…"***` markdown rendered literally — chat bugs worth their
  own line in scope.
- **D. Viewer & previews.** Fletch's Library grid shows file cards, no rendered thumbnails;
  the viewer is a file viewer. Muse's grid shows live preview thumbnails and the artifact
  opens as a full rendered page at its own URL, beside the chat.
- **E. Build quality loop.** Fletch: single-shot generation, no review. Muse: the builder
  runs an audit (content critique with P0/P1/P2 findings), reads desktop + mobile
  screenshots, edits and re-audits, and exits naming unresolved findings.
- **F. Data & state.** Muse's demo artifact was a view over Kyle's live data (the ticket
  watch), and Muse web artifacts can hold their own data and expose actions the agent can
  invoke later. Fletch artifacts would be static bytes; nothing binds an artifact to the
  agent's tools or the person's data.
- **G. Provenance & activity.** Fletch's "Your agent" panel showed "Nothing yet" after real
  work. Muse keeps a named, openable activity record (task, subagent steps, tool calls) —
  creation is inspectable, not a black box.
- **H. Library parity details.** Fletch kinds are extension-derived only; no Web-artifact,
  Video, or Podcast objects (per the code's own comment). Bones that already match: sections,
  search, sort, pin/rename/delete, copy link, and approval-gated public share links.

## Proposed phasing (sketch — Fable turns this into parts)

1. **Phase 1 — an artifact exists.** Bridge agent output → Library record (A), minimal
  artifact verbs for the agent (B), in-chat presentation card + open-in-viewer (C, D-basic).
  Success = Kyle's exact test: ask in chat → card in chat → artifact in the Library → opens.
2. **Phase 2 — it's good.** Builder pattern + audit pass + screenshot checks (E), rendered
  preview thumbnails (D), edit-in-place.
3. **Phase 3 — it's alive.** Data-bound and stateful artifacts (F), activity/provenance
  surface (G), remaining library kinds (H).

## Inputs for the Fable analysis

- This file (once Kyle agrees it).
- The Muse reference: `~/workspace/tool-dump/tools.json` (full tool inventory),
  `~/workspace/your_files/muse-harness-architecture-spec/` (the harness spec), the system
  prompt copy at `~/workspace/system/system_prompt.md`, and the 2026-10-15 deep-dive note on
  Muse's artifact build/audit mechanics (builders are async; audit = builder's internal
  review + `artifact.inspect`; builds can pause with one question for the user).
- The fletch codebase (working copy `~/workspace/fletch-work`), especially
  `packages/agent/src/http/app/library.ts`, `src/render/`, `src/tree/`, `src/files/`,
  `src/tools/`, `docs/plan/parts.md`, `docs/decisions/`.
