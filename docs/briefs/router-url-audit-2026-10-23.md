# Router / URL audit: Fletch vs Muse — spec + planning primer (DRAFT)

Status: SUPERSEDED 2026-10-23 — Kyle locked this scope 13:44 ET; the final
Fable brief built from it is `router-fable-brief-2026-10-23.md` (same dir).
Kept as the evidence/dissection record the brief points at.
Parallel to, and distinct from, `artifact-parity-gaps-2026-10-23.md`:
that thread decides *what an artifact is*; this one decides *what every
surface is called in the URL* — including the artifact URL that thread assumes.
Once Kyle agrees the scope + the open calls below, this becomes the brief
handed to a Fable planning session, same pattern as the artifact Fable run.
The planner proposes parts and decision records; it does not decide
one-way doors (fletch AGENTS.md: Kyle accepts those).

## 1. Evidence — Muse, from Kyle's 8 screenshots (2026-10-23)

Only URLs actually visible in the screenshots. Anything else is `not observed`.

| Muse URL | Surface |
|---|---|
| `muse.ai/` | Main chat (no path segment for Main) |
| `muse.ai/thread/<uuid>` e.g. `d70009d8-b529-42d3-9137-ec50e2734840` | A side chat |
| `muse.ai/thread/new` | New-thread composer — literal `new` in the id slot; attachments are staged in the composer *before* a thread exists |
| `muse.ai/library/artifacts?sort=date` | Library — All artifacts, sorted |
| `muse.ai/library/artifacts?view=documents` | Library — Documents (note: a different query key, `view=`, for what looks like a filter on the same collection) |
| `muse.ai/library/media?view=images` | Library — Images, but the collection in the path is `media`, not `artifacts` |
| `muse.ai/library/artifacts/concert-week` | One artifact — human slug, not a uuid; opens as a split view: chat on the left, artifact viewer on the right, with its own close / `...` |

Also observed, not in a URL:
- Left sidebar taxonomy: Main chat / Side chats list; rail entries for Chat,
  Search, Library (Artifacts / Documents / Web artifacts; Media / Images /
  Videos / Podcasts), Ideas, Goals/Tasks, System files. Which of those are
  routes vs in-page view state is *not* observable from screenshots alone.
- Public share is a different URL shape again (from memory, 2026-09-18):
  `muse.ai/s/trivia-night-<hash>` — private library URL ≠ shared URL.
- Inconsistencies worth naming, not copying blindly: `?sort=` vs `?view=`
  on adjacent library URLs; `artifacts` vs `media` as collection names;
  Main chat has no segment while a side chat is `/thread/<uuid>`.

## 2. Evidence — Fletch today, from the code (fletch-work, current checkout)

- **One page route only.** `GET /` in `packages/agent/src/http/routes.ts`
  serves the single `APP_PAGE` SPA. No other GET returns a page.
- **View state is not in the URL.** `shell.ts`: `show(view)` switches
  `chat | feed | goals | library` in-page; Settings is a dialog with panes.
  Back/forward, reload, and deep-linking do not see views at all.
- **Chat is a query param, via `replaceState` only.**
  `chat.ts: open()` does `history.replaceState(null, "", "?chat=" + id)`;
  `shell.ts` boots from `?chat=` and `?file=`. No `pushState`, so opening
  chats / views / files creates no history entries.
- **File is a query param too.** Library share/copy-link builds
  `/?file=<path>` (`library.ts`); opening a file is viewer state, not a route.
  Library section (All/Documents/Images/System files), sort, and grid/list
  are all in-page state — none addressable.
- **API routes are a separate, already path-based namespace** and are not
  the subject of a rename by default:
  `/app/chats`, `/app/chats/<uuid>/(archive|rename)`, `/app/library`,
  `/app/file?path=`, `/app/file/(link|raw|rename|pin|delete)`,
  `/app/approvals`, `/app/jobs[/<id>]`, `/app/activity`, `/app/profile`,
  `/app/search`, `/app/connectors`, `/app/permissions`, `/app/usage.json`,
  `/chats` (POST), `/chats/<uuid>/ws`, `/me`, `/health`,
  `/login…`, `/logout`, `/vault…`, `/hooks/share/<token>`, `/_platform/…`,
  plus `/api/…`, `/admin/…` families.
- **One discrepancy to resolve live, not from memory:** Kyle's staging
  screenshot shows `fletch-staging…/chat/70d8a801-3778-4414-86e8-05e759aa8825`
  — a path-based chat URL that the code above does not produce. Is staging
  ahead of this checkout, is a dispatcher rewriting, or is that an older
  build? The audit's first job is to answer this from the deployed Worker.

## 3. Surface-level differences (the dissection)

1. **Addressability.** Muse: every major surface and every object has a
   URL you can copy, reload, bookmark, and land on cold. Fletch: only
   `?chat=` and `?file=` survive a reload; feed/goals/library/settings,
   library section/sort, an open file's viewer, search, approvals — none do.
2. **Identifier style.** Muse mixes both deliberately: chats = uuid,
   artifacts = human slug (`concert-week`). Fletch: chats = uuid (in a
   query param), files = raw filesystem path (in a query param, encoded).
3. **Naming.** Muse says `thread`, Fletch says `chat` (everywhere in code:
   `Chat` DO, `/chats`, `/app/chats`). Muse says `library/artifacts` +
   `library/media`; Fletch's Library is one view with picker sections.
   Fletch also has surfaces Muse's screenshots don't give a URL for:
   Feed, Goals, Approvals (a panel tab, not a view), Jobs/Upcoming,
   Settings panes (incl. Connectors, Permissions), Activity, Profile.
4. **History behaviour.** Muse: navigation is real navigation (back works,
   `/thread/new` is its own place). Fletch: `replaceState` only — the back
   button leaves the app rather than returning to the previous chat/view.
5. **Composing before an object exists.** Muse has `/thread/new`.
   Fletch creates a chat via `POST /chats` / `/app/chats` and then swaps
   the query param — no addressable "new" state, attachments staged in a
   chat that already exists server-side.
6. **Split / overlay surfaces.** Muse's artifact detail keeps the chat
   in the URL's context (`/library/artifacts/<slug>` with chat alongside).
   Fletch's file viewer, panel, dialogs and search are all overlays on `/`.
   The audit must decide which overlays deserve routes and which stay state.
7. **Sharing.** Muse separates private object URL from public `/s/…`.
   Fletch already separates them too (`/?file=` private, signed
   `/app/file/raw?…` and `/hooks/share/<token>` public) — keep that split,
   whatever the private shape becomes.

## 4. Proposed scope

**In scope**
- A complete inventory table: every Fletch surface/view/overlay/object ×
  current URL (or "none") × Muse analogue (or "no analogue") × proposed URL.
- A URL grammar proposal: path segments, when uuid vs slug vs path,
  query params reserved for *state within* a surface (sort, view/filter,
  search query), trailing-slash / case / encoding rules.
- Client routing: `pushState` vs `replaceState` per transition, back/forward
  semantics, cold-load / deep-link handling for every proposed route,
  unauthenticated → `/login` → return-to behaviour.
- Server routing: `routes.ts` / `serve.ts` serving the SPA (or per-route
  pages, if the planner argues for it) for the new paths without breaking
  the API namespaces above; unknown-path behaviour (404 vs app fallback).
- Migration, such as it is: `?chat=` and `?file=` links already copied.
  Fletch's own rule applies — *no backwards compatibility until fletch has
  users* (AGENTS.md) and Kyle is the only user — so a redirect shim is a
  decision to argue, not a default.
- Tests/acceptance shape per part, following the existing part system in
  `docs/plan/parts.md` (this primer should land as one or more `F<n>` parts).

**Out of scope (unless Kyle pulls them in)**
- Renaming API routes (`/app/…`, `/api/…`, `/admin/…`, `/_platform/…`).
- Artifact identity/records themselves — the artifact-parity thread owns
  that; this audit only reserves the artifact URL shape it will need.
- Any visual redesign; a route change must not smuggle in a design change.
- qyvr/Forge project URLs (`<owner>--<name>.<domain>`) — different product,
  different namespace decision (Forge plan v2, D-2 still open).

## 5. Open calls for Kyle (planner treats unanswered ones as provisional)

1. **Vocabulary:** keep Fletch's `chat` (`/chat/<uuid>`) or adopt Muse's
   `thread` (`/thread/<uuid>`)? Staging already shows `/chat/…`, and the
   whole codebase says chat — changing the word is cheap now, expensive later.
2. **Grammar target:** full Muse-parity shapes (`/library/artifacts/<slug>`,
   `/library/media?view=images` — including its `sort`/`view` inconsistency?)
   or a cleaned-up grammar in Muse's spirit (one query key for filters,
   consistent collections)? Recommendation in the draft: cleaned-up, and
   say so in a decision record — parity is about capability, not typos.
3. **Which surfaces become routes?** Proposed default set: chat, new chat,
   feed, goals, library + section, one file/artifact, search, settings pane.
   Approvals/jobs/activity/panel tabs: routes or state? (Default: state.)
4. **History:** every chat/view open = a history entry (Muse-like), or
   only top-level surfaces, with chat switches staying `replaceState`?
5. **File identity in URL:** keep raw path (`?file=work/…`-style, encoded),
   or does a file get a library-relative path segment? Interacts with the
   artifact thread if artifacts get slugs.

## 6. What the planner (Claude/Fable) is asked to produce

1. The inventory table in §4, verified against the code *and* a live
   staging probe (resolving the §2 discrepancy first).
2. A proposed URL grammar + route map, with each Muse inconsistency
   explicitly kept or cleaned, and why.
3. A parts breakdown in fletch's own format (Scope / Acceptance /
   Not in scope per `F<n>`), sequenced so each part ships alone.
4. Proposed decision records (status `proposed`, Kyle accepts) for:
   URL grammar, identifier style per object kind, history semantics,
   and the `?chat=`/`?file=` break-or-shim call.
5. A precise-questions list for Muse (the main agent) where the static
   dump is thin — e.g. how Muse's own router treats back from an artifact
   split view, `/thread/new` → first send transition — marked provisional
   until answered, same as the artifact Fable brief.
