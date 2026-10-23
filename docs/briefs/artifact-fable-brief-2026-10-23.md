# Brief: Fable planning analysis — artifact parity for Fletch

You are the planning session (Fable tier) for the fletch repo in this working copy. Read
AGENTS.md, VISION.md and docs/runbooks/muse-execution.md first. This is a PLANNING task:
your final message is the deliverable (Muse applies any file changes). Do not edit files.

## The frame (Kyle, the owner)

Fletch is the flagship agent of Quiver, and the project is **Muse-parity on Cloudflare**:
the same capabilities and architecture as the Muse personal-agent harness, rebuilt on
Cloudflare primitives (Workers, Durable Objects, R2). Kyle is incubating it personally.
This milestone closes the artifact-capability gap between Fletch and Muse. Kyle has
reviewed and LOCKED the gap analysis; do not re-litigate its scope — plan against it.

## Inputs

1. **The locked gap analysis** (read it fully):
   `~/workspace/qyvr-for-muse/planning/artifact-parity-gaps-2026-10-23.md`
   It was built from Kyle's 11 screenshots (4 of fletch staging failing the "make me an
   artifact" test, 7 of muse.ai passing it). The screenshots themselves are at
   `~/workspace/user/media_library/image/` (uploaded 2026-10-23 ~12:09 ET) if you can use
   them; the gap doc carries their evidence in words either way.
2. **The Muse reference (the system Fletch is a parity build of)** — Kyle's instruction:
   use the static workspace dump, and where it is thin, ask (see Deliverable 5):
   - `~/workspace/tool-dump/tools.json` — the full Muse tool inventory (124 functions,
     20 namespaces; the `artifact` namespace is the reference for B).
   - `~/workspace/system/system_prompt.md` — the Muse system prompt copy (artifact and
     delivery rules live in it).
   - `~/workspace/your_files/muse-harness-architecture-spec/muse-harness-architecture-spec.pdf`
     — the harness architecture spec Muse wrote about itself.
   - `~/workspace/your_files/all-tools-dump.html`, `harness-and-skill-registry.html`,
     `system-prompt-dump.html` — the rendered dumps.
   - `~/memory/2026-10-15.md` near line 270 — Muse's verified note on its own artifact
     build/audit mechanics: builds delegate to async builder agents followed via status;
     the "audit" is the builder's internal review plus `artifact.inspect` for diagnosis;
     a build can pause with one question for the user (needs_user_input); server actions
     are invoked by name with JSON args.
3. **The codebase** (this working copy): especially `packages/agent/src/http/app/library.ts`
   (the Library), `src/render/` (render_document + the Renderer), `src/tree/` (the work/
   tree), `src/files/` (the Library file store + share links), `src/tools/` (namespaces),
   `src/chat/` (tools + effect buffer — how a tool result becomes a card in chat),
   `src/subagents/` (the existing subagent host — relevant to the builder pattern),
   `docs/plan/parts.md` (F0–F3 are the existing parts; new parts continue at F4),
   `docs/plan/PROGRESS.md`, `docs/decisions/`.
4. **The design artifacts** (Kyle + Muse designed fletch's UI in Claude Design): my
   condensed notes at `~/workspace/qyvr-for-muse/design-artifacts-2026-10-22.md`, covering
   the design system (https://claude.ai/artifact/Q2ofeiSAvQMtdGjdyPZoiN) and the hi-fi
   prototype (https://claude.ai/artifact/DmpRhrpke44XKNgHQoUL7r). The live artifacts sit
   behind a sign-in wall you cannot pass; the notes are your access — say in Deliverable 3
   what else you would need from them.

## Deliverables (in your final message, in this order)

1. **Seam analysis.** Exactly where, in code, agent output and the Library diverge: the
   stores, the calls, the missing registration step. Name files and functions. Also: why
   `render_document` refused on the staging host (what a host must provide), and what the
   staging agent's fallback path was.
2. **The phased part plan**, in the repo's parts shape (Read / Scope / Acceptance /
   Not in scope / Rulings), numbered from F4, each part sized for one build session, in
   dependency order, grouped under Kyle's phases (1: an artifact exists; 2: it's good;
   3: it's alive). Phase 1's acceptance must include Kyle's exact test: ask in chat →
   artifact card in chat → artifact present in the Library → opens in the viewer. Mark
   every acceptance that is hermetically testable vs live-only.
3. **The design workstream.** The pure UI/UX piece: which surfaces need design work
   (artifact card in chat, artifact viewer, library previews, activity/provenance), what
   already exists in the design system/prototype that covers them, what must be added or
   changed to match Kyle's screenshots of muse.ai, and where each design task slots
   relative to the build parts (design-first where a part builds a surface).
4. **Decision records to propose.** Anything that is a one-way door (storage schema for
   artifact records above all, identity/URL shape, sandboxing of rendered artifacts) as a
   PROPOSED record with a recommended answer and the cost of each side. Never decide them.
5. **Questions for Muse.** You have a standing offer from Kyle: where the static dump
   does not complete the picture of the Muse workspace, list precise questions for Muse
   (the operator of the live reference system), who will answer from live introspection.
   Mark which plan sections are provisional until each answer lands.
6. **Risks and unknowns**: platform limits (DO storage, rendering/screenshot options on
   Workers), security surface of rendered HTML artifacts, and what to measure before
   committing to the stateful tier (Phase 3).

House rules that bind the plan: D-0001 (refused, never faked — no silent fallbacks like
the one in the screenshots); copy in the product's plain voice; pre-beta, no
backwards-compat shims; reuse the Library's existing bones where they serve; a part is
done only at ACCEPT + verifier, so every acceptance line must be checkable.
