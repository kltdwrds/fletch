# Answers to Fable's Q-M1…Q-M11, from Muse's live introspection (2026-10-23)

Sources, in order of strength: `~/docs/artifacts.md` and `~/docs/files-and-library.md`
(product docs), the loaded `artifact` tool-namespace schema (15 functions), a read of the
`spaces.spaces` catalog row for `concert-week` in muse.db, and the build traces in Kyle's
2026-10-23 screenshots. Where none of those reach, the answer says so.

- **Q-M1 (artifacts doc, kinds, Library, approvals).** Three product kinds: Documents
  (generated files), Pages (static, hosted live, no state), Interactive apps (hosted, own
  data in their own database on the agent's machine). Tool-level kinds: `create_file`
  (document | pdf | presentation | spreadsheet | markdown | other), `create_web_static`,
  `create_web_fullstack`. Library on every platform; web at `/artifacts`. Sharing =
  publishing: **static only**; **every publish and every later update to a published link
  needs a fresh one-tap approval** — approvals are one-time, never standing. Unpublished =
  owner-only. Delete is permanent (artifact + data + hosting + share); the 30-day file
  trash does not apply to artifacts. Parity note for F5/F13: static vs fullstack is a
  **kind chosen at create**; an edit never converts one into the other.
- **Q-M2 (the card).** `artifact.status` returns `card.widget_id` when a presentable card
  exists; the agent presents it (`widget.present`) — placement is **agent-driven**, not
  automatic on completion. The rendered card shows a preview image, the name, and the kind
  word ("Artifact"); the client adds reaction/reply/share affordances. Prefer the card
  over a link: an artifact has no public address until shared.
- **Q-M3 (the record).** Verified from `spaces.spaces` (concert-week row): `space_slug`
  (PK, pattern `^[a-z0-9][a-z0-9-]*$`), `display_name`, `space_root_path`, `db_path`
  (**null for static** — concert-week has none; set for fullstack), `session_id` (the
  creating session), `construction_status` (`succeeded`), `current_build_id`,
  `created_from_proposal_id`, created/updated/archived timestamps, `source`. The slug is
  **stable across edits and renames** (edit takes the slug as identity; name is a separate
  mutable field). Edits re-run the builder against the same record — **no version history**
  is exposed; overwrite-in-place with `updated_at` moving. Delete = full teardown (catalog
  entry, managed schedules, public share; file artifacts: the directory, guarded by a
  `.src` marker so a user's own folder can never be deleted by mistake; a slug existing in
  both namespaces refuses rather than guess).
- **Q-M4 (build contract).** The create call is the contract: `verbatim_request` (the
  user's exact words — authoritative scope; the builder gathers and validates its own
  sources), `name`, `icon_subject` (factual subject for icon choice, kept apart from the
  instructions), `capabilities` (public_web_read + exact connector methods with purposes,
  validated server-side; declared reads may ask approval once and it persists for that
  artifact; writes keep per-request authorization), `goal_id`, `refresh_triggers` (cron,
  fullstack), `research_dir`, `template`. `needs_user_input`: the build **ends** with that
  status and one question; the agent relays it verbatim with its choices and never answers
  it; the artifact stays listed as interrupted; the user's reply resumes **the same build**
  via `artifact.edit` with the reply as `verbatim_request`. `artifact.send_input` steers a
  *running* build. → F7 should pull the pause-with-question **into scope**.
- **Q-M5 (audit).** There is no audit tool on the caller side: the audit is the **builder's
  internal review**; `artifact.inspect` is the after-the-fact diagnosis path. The audit
  result shape (from Kyle's trace): `assessment.advisory` (a content-critique summary,
  e.g. "0 P0, 1 P1, 0 P2 findings"), `expected_lockdown_effects`, `fix_before_attesting`,
  `next`. P0 blocks attestation, P1 is should-fix, P2 minor — Concert Week delivered with
  one P1 open, disclosed in the agent's message ("exited with unresolved finding"); the
  card itself carries no findings state. The builder reads **desktop and mobile**
  screenshots of its own build and iterates edits around the audit. → F8's
  findings-on-the-record + "Ready, 1 finding open" is **better than parity**; keep it as a
  deliberate divergence.
- **Q-M6 (previews).** Web artifacts get captured previews (360×360 thumb, 640×400 card)
  from the build's audit frame — taken at build, refreshed on rebuild/edit (the manifest
  carries `captured_at` and `capture_source`). "Preview unavailable" is what file artifacts
  without a capture show (Kyle's grid: the text decks and the HTML review decks) — captures
  belong to the hosted-web pipeline; other kinds show content-derived previews or the
  unavailable state. F9's triggers (build + update) match.
- **Q-M7 (Library menu).** A person's own Share click opens the publish dialog; publishing
  (and every re-publish after an edit) requires the fresh one-tap approval — the dialog's
  confirm **is** the approval, so F10's ruling stands (no separate agent card for the
  owner's own action; an agent-initiated share is a different path). Download of a page =
  `artifact.export`: **web_static only**, one self-contained `.html` with assets inlined,
  written to `workspace/your_files/<slug>/<slug>.html`; fullstack cannot be exported. The
  card's type word comes from the **catalog kind**, not the file extension.
- **Q-M8 (activity).** The entry is a general **agent-execution record** (the runtime's
  activity monitor over its agent table), not artifact-specific: every delegated unit of
  work gets a titled thread ("Create artifact example"), its steps are the agent's tool
  calls in order, subagents nest as sections (SUBAGENT 01), each step opens to a detail
  pane, and the line under the title is the final step's outcome ("Presented your Concert
  Week artifact"). F11's journal + subagent-rows design is the right parity shape; Muse's
  ledger covers all delegated work, F11 scopes to artifacts first (already its boundary).
- **Q-M9 (data and actions).** Concert Week is **static, snapshot at build**: the builder
  read `workspace/ticket-deal-watch/baselines.json` while building and embedded the values;
  a static page never fetches at open, and its record's `db_path` is null. Live data is the
  fullstack kind: the app's own database + **declared actions** (listed with
  `list_actions`, each with a request schema; run with `invoke_action` + JSON args) +
  `refresh_triggers` cron for refresh. → F12's sidecar is the static-parity path; F13
  should mirror the fullstack contract, including a **capabilities manifest at create**.
- **Q-M10 (sandbox).** **Not observable from my side** — no doc or schema gives the
  serving origin or CSP values, and my agent browser is blocked from muse.ai entirely.
  Verified only: a static page "runs full JavaScript"; a fullstack app cannot be shared or
  exported. D-0011 as proposed (opaque origin, never `allow-same-origin`) achieves the
  guarantee; do not chase header-parity that cannot be verified.
- **Q-M11 (export limits).** Export: web_static + completed build only; inlines assets; no
  size cap is stated in any doc or schema available to me. Create content caps likewise
  unpublished (the builder enforces practical limits internally). F5's 1 MiB
  (the file store's `FILE_MAX`) stands as **Fletch's own stated cap**, not a parity figure.

## Deltas these answers make to the Fable plan

1. F5: Phase 1's `page` kind is static by definition; the stateful kind arrives in F13 as
   a separate create, never a conversion (mirrors Q-M1).
2. F7: pull `needs_user_input` (pause with one question; resume the same build) into scope
   (Q-M4).
3. F8: unchanged, now labelled a deliberate improvement over parity (Q-M5).
4. F10: Share ruling confirmed (Q-M7).
5. F13: add a capabilities manifest at create — exact connector/tool methods with
   purposes, validated, approvals persisted per artifact (Q-M9).
