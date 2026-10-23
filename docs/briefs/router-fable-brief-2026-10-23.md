# Brief: Fable planning analysis — router / URL audit for Fletch

You are the planning session (Fable tier) for the fletch repo in this working copy. Read
AGENTS.md, VISION.md and docs/runbooks/muse-execution.md first. This is a PLANNING task:
your final message is the deliverable (Muse applies any file changes). Do not edit files.

## The frame (Kyle, the owner)

Fletch is **Muse-parity on Cloudflare**. Kyle reviewed the scope below in the router
side chat on 2026-10-23 and LOCKED it ("Lock this scope — I'll finalize the primer
for Fable", 13:44 ET). Do not re-litigate the in/out scope — plan against it. The five
open calls in §5 are yours to *propose* (with the recommended defaults given); Kyle
accepts or amends them as decision records. Never write `decider: Kyle` yourself.

## Inputs

1. **The locked scope / dissection** (read it fully — it carries the evidence tables):
   `~/workspace/qyvr-for-muse/planning/router-url-audit-primer-DRAFT-2026-10-23.md`
   §1 = Muse URLs observed in Kyle's 8 screenshots (2026-10-23, in
   `~/workspace/user/media_library/image/`); §2 = Fletch today from the code;
   §3 = the seven surface differences; §4 = locked scope; §5 = open calls.
2. **The codebase** (this working copy), especially:
   - `packages/agent/src/http/routes.ts` and `serve.ts` — the server surface: one page
     route (`GET /` → the SPA), everything else API; the unauthenticated page
     redirect to `/login` in `serve.ts`.
   - `packages/agent/src/http/app/shell.ts` — `show(view)`, the boot reads of
     `?chat=` / `?file=`, TAB_VIEWS (chat/feed/goals/library), Settings as a dialog.
   - `packages/agent/src/http/app/chat.ts` — `open()` and its
     `history.replaceState(null, "", "?chat=" + id)`; the WebSocket at `/chats/<uuid>/ws`.
   - `packages/agent/src/http/app/library.ts` — sections, sort, viewer state, and the
     copy-link that builds `/?file=<path>`.
   - `packages/agent/src/http/app-routes.ts` plus the other `*-routes.ts` files — the
     full API namespace inventory (out of scope for renaming; in scope as the
     boundary the page routes must not collide with).
   - `packages/host-cloudflare/src/passkeys/routes.ts` — `/login…`, `/logout`:
     page routes that already exist outside the SPA and must keep working.
   - `docs/plan/parts.md` (F0–F3 landed) and `docs/decisions/` (D-0001…D-0008).
3. **The artifact plan — read it before proposing any numbering or any artifact URL:**
   `~/workspace/qyvr-for-muse/planning/artifact-parity-plan-fable-2026-10-23.md`
   It reserves parts **F4–F14** and already proposes **D-0010**: an artifact's identity
   is a slug and its URL is `/library/artifacts/<slug>`; its **F6** builds that one
   route (viewer beside the chat, Close → Library list, back → the chat the card
   was in, Library card + Copy link use the artifact URL). D-0009/D-0010/D-0011 are
   `proposed`, awaiting Kyle — **do not re-decide D-0010 and do not renumber F4–F14
   silently.** Your plan must take an explicit position on sequencing (§Deliverable 3):
   either a minimal routing foundation lands *before* F6 so F6 builds on it, or F6's
   route is built to the grammar you propose and your parts generalise from it
   afterwards. Price both; recommend one.
4. **The design artifacts:** condensed notes at
   `~/workspace/qyvr-for-muse/design-artifacts-2026-10-22.md` — the DS/prototype
   behind a sign-in wall you cannot pass. Note: the artifact Fable session already
   asked whether the prototype's `routes.md` has `/library/` entries; if your plan
   needs that answer too, fold it into your questions for Muse (Deliverable 5)
   rather than asking twice.

## Locked scope (from the primer, §4 — summary; the primer's text governs)

**In:** a complete inventory (every Fletch surface/view/overlay/object × current URL
or "none" × Muse analogue or "no analogue" × proposed URL); a URL grammar (path
segments; uuid vs slug vs path per object kind; query params reserved for state
*within* a surface — sort, filter/view, search query; trailing-slash / case /
encoding rules); client routing (`pushState` vs `replaceState` per transition,
back/forward semantics, cold-load/deep-link for every route, unauthenticated →
`/login` → return-to); server routing (SPA served on the new paths — or per-route
pages if you argue for it — without breaking the API namespaces; unknown-path
behaviour: real 404 vs app fallback, split by page vs API callers as `serve.ts`
already splits them); the `?chat=` / `?file=` migration call (repo rule: no
backwards-compat until fletch has users — a shim is argued, not defaulted);
tests/acceptance per part in the repo's parts shape.

**Out:** renaming API routes (`/app/…`, `/api/…`, `/admin/…`, `/_platform/…`,
`/hooks/…`, `/vault/…`); artifact identity/records themselves (the artifact thread
owns them — you own only the URL grammar they sit in); any visual redesign;
qyvr/Forge project URLs.

## The one discrepancy you must resolve first

Kyle's staging screenshot shows `fletch-staging…/chat/70d8a801-3778-4414-86e8-05e759aa8825`,
a path-based chat URL the code in this checkout never produces (chat is `?chat=`).
Probe what you can from here: unauthenticated `curl` against
https://fletch-staging.edwards-ky1.workers.dev for `/health`, `/`, `/chat/<uuid>`,
`/thread/<uuid>`, `/library/artifacts/x`, recording status, content-type and redirect
for each — and state plainly what the auth wall prevents those probes from proving
(every page GET without a session is redirected to `/login` before routing, so a
302 proves nothing about the route behind it). If the discrepancy cannot be settled
from code + probes, say which of the three explanations (staging ahead of this
checkout / a dispatcher in front rewriting / an older build) the evidence best
supports, and put the decisive check in your questions (Deliverable 5) instead of
guessing.

## Open calls — propose, with these recommended defaults

1. **Vocabulary:** default *keep `chat`* (`/chat/<uuid>`) — the whole codebase, the
   `Chat` DO and staging's own screenshot say chat; Muse's `thread` is the outlier.
   Cost the other side honestly (UI copy says "Side chats"; Main chat has no segment
   in Muse — say what `/` and Main chat are in your grammar).
2. **Grammar target:** default *cleaned-up Muse grammar* — one query key for
   filters, consistent collection names — not a byte-copy of Muse's `?sort=` /
   `?view=` / `artifacts` / `media` inconsistencies. Name each inconsistency and
   whether you keep or clean it.
3. **Route set:** default routes for chat, new chat (`/chat/new` if call 1 goes
   that way), feed, goals, library + section, one file, one artifact (per D-0010),
   search, and a settings pane. Default *state, not routes* for approvals, jobs,
   activity and the agent panel's tabs — argue any exception.
4. **History:** propose per-transition semantics; default is a history entry for
   chat switches and top-level view changes, `replaceState` for state within a
   surface (sort, filter, viewer open/close within the library).
5. **File identity:** default a library-relative path segment (encoded), not the
   raw workspace path; say how it relates to an artifact's slug URL when the file
   *is* an artifact (one canonical URL, or two that resolve to the same viewer?).

## Deliverables (in your final message, in this order)

1. **Inventory + discrepancy verdict.** The full surface × URL table, verified
   against the code; the staging `/chat/<uuid>` question answered or precisely
   bounded as above.
2. **The URL grammar.** The route map (every proposed path, its object/state,
   its query params), the identifier rules per object kind, and the disposition
   of each Muse inconsistency (kept/cleaned, why). Include: `/` and Main chat,
   `/chat/new` → first-send transition, search as a route or not, settings panes,
   and what an unknown path does for a page caller vs an API caller.
3. **The part plan**, in the repo's parts shape (Read / Scope / Acceptance /
   Not in scope / Rulings), each part sized for one build session, hermetically
   testable acceptance marked vs live-only. Numbering must not collide with the
   artifact plan's F4–F14: continue after them, or explicitly propose the
   interleave + renumber cost in your sequencing position (Inputs §3). Sequence
   so the server foundation (SPA on new paths, 404 behaviour, login return-to)
   lands before the client history work that depends on it.
4. **Decision records to propose.** As `proposed` records with a recommendation
   and the cost of each side: the URL grammar itself, identifier style per object
   kind, history semantics, and the `?chat=` / `?file=` break-or-shim call.
   Continue the numbering after D-0013 (the artifact plan proposes D-0009…D-0013).
5. **Questions for Muse.** Where the static dump + screenshots are thin — e.g.
   back-button behaviour out of Muse's artifact split view, the
   `/thread/new` → first-send URL transition, whether Muse's search/feed/goals
   are routes or state, the prototype `routes.md` question shared with the
   artifact plan — list precise questions, and mark which plan sections stay
   provisional until each answer lands.
6. **Risks and unknowns.** Collisions with existing API paths; the service
   worker (`/sw.js`) and PWA manifest under real routing; WebSocket reconnect
   on history navigation; deep links into a chat the session does not own
   (ownership is checked where the data lives — a route must not leak a
   chat's existence, matching the `/chats/<uuid>/ws` rule); link rot in
   already-copied `?file=` share/copy links.

House rules that bind the plan: D-0001 (refused, never faked — a route that cannot
be served says so, never silently lands on the chat view); branch on codes, never
message text; copy in the product's plain voice; pre-beta, no backwards-compat
shims unless a proposed record argues one in; a part is done only at ACCEPT +
verifier, so every acceptance line must be checkable.
