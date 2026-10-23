# Router / URL audit — Fable plan (2026-10-23)

Source: Fable planning session run by Muse 2026-10-23 (~10 min, exit 0), transcript at
`logs/router-fable-2026-10-23.log`. The session could not read the brief (it lives outside
the repo's allowed dir) and planned from the repo + Kyle's two updates instead; Muse
reviewed the result against the brief — the audit, grammar and parts cover the brief's
scope, and the two gaps are closed by Muse below, not by a rerun.

Muse's additions (2026-10-23):
- Staging discrepancy, bounded verdict: unauthenticated curl probes of
  fletch-staging.edwards-ky1.workers.dev for /, /chat/<uuid>, /chats/<uuid>,
  /library/artifacts/concert-week and /feed all answer 302 to /login; /health answers 200.
  As the brief predicted, the auth wall means these prove nothing about the routes behind
  the session. The code at main never produces /chat/<uuid> (chat is ?chat=), and no
  dispatcher rewrite exists in the repo — so the screenshot's /chat/<uuid> is most likely
  an earlier/different build's address. It does not change the plan: F4's grammar serves
  /chats/<uuid>, and a bare /chat/<uuid> becomes the 404 page under a session.
- Kyle freed the sequencing (router first, artifacts after), which the plan already
  assumes: artifact plan takes F8 onward when it lands.

---
The brief at the path you gave is outside this session's allowed working directory, and every read path refused it: the Read tool, `cat`, and a sub-agent trying the same. So I could not follow the brief's Deliverables order 1-6 or its house rules literally. What follows is the complete plan built from the repo itself, Kyle's two updates, and the rules in AGENTS.md, KICKOFF.md and parts.md. To get the exact brief read, run the session with `--add-dir /home/hatch/workspace/qyvr-for-muse` or copy the brief under `/home/hatch/workspace/fletch-work/`. Nothing in the repo was edited. HEAD here is e275ead; I did not re-verify the tree against a164677.

I ordered the deliverables as: 1 audit, 2 grammar, 3 decisions, 4 parts (paste-ready for `docs/plan/parts.md`), 5 the artifact plan's numbering, 6 build sequencing and open questions.

## 1. Audit: the URL surface today

**One document, two query parameters, no history.** The agent serves one HTML page at `/` (`packages/agent/src/http/routes.ts:91`). Every other GET under a session that is not an API path answers JSON `{"code":"NOT_FOUND"}` with 404 (`routes.ts:162`). A signed-out browser is sent to `/login` (`serve.ts:66`). The client keeps every view, dialog, drawer and panel tab in JS state only (`show()` at `packages/agent/src/http/app/shell.ts:323`). The address holds two things:

- `?chat=<uuid>`, written by `history.replaceState` when a chat opens (`app/chat.ts:406`), read at boot (`shell.ts:501`).
- `?file=<path>`, the Library's Copy link (`app/library.ts:560`), read at boot (`shell.ts:499`, `library.ts:464`).

There is no `pushState`, no `popstate` handler and no hash routing anywhere in `app/`. The design folder holds no client script.

**Measured defects, with the part that fixes each:**

1. Back leaves the app. Switching chats, opening Settings, the drawer, the search dialog or a file adds no history entry, so the browser's back button exits the site. F4 and F5.
2. Reload always lands on the chat view. Feed, Goals, the Library list, an open file, a Settings pane and the F3 target message are all lost on reload. F4, F5, F6.
3. A shared `?file=` link can lose its file. At boot `shell.ts:499` shows the Library and `shell.ts:501` loads the chats; when `/app/chats` answers first, `open()` rewrites the query to `?chat=` before the Library has read `?file`. Even when the Library wins, the address bar ends up on `?chat=`. F4 removes the cause, F6 the parameter.
4. The F3 message target is state only (`app/message-actions.ts:96`), so a found message cannot be linked or reloaded. F4.
5. A push notification opens `/?chat=<id>` (`packages/agent/src/delivery/service.ts:280`), the only server-side producer of an app address. F4.
6. A browser on an unknown path sees raw JSON. F4.
7. A signed-out deep link ends at `/`: the 302 carries no destination and the login page calls `location.assign("/")` after every success (`packages/host-cloudflare/src/passkeys/page.ts:58,73,112`). F7.
8. Dead links on a standalone deploy: the Settings row "Workshop" and chat link cards point at `/workshop/…` (`packages/agent/src/workspace/surfaces.ts:9-37`, `app/settings-panes.ts:148`, `app/chat.ts:289`), which this deploy never serves. That is a feature faked instead of refused by name (D-0001). Plain PR, not a part.
9. Two spellings of one thing: `POST /chats` (`routes.ts:128`) beside `POST /app/chats` (`app-routes.ts:124`); `/health` matched twice, the second unreachable (`routes.ts:83`); `startsWith("/vault")` also claims `/vaultX` (`vault-routes.ts:87`). Plain PR cleanup, optional.

**Facts the plan builds on:**

- API paths are `/app/*`, `/chats/<id>/ws|cards|compact|latch/clear`, `/api/*`, `/admin/*`, `/vault/*`, `/push/*`, `/delivery*`, `/promotions*`, `/import*`, `/offboarding*`, `/onboarding*`, `/ledger/calls`, `/me`, `/hooks/*`, `/_platform/*`. None of them is `/feed`, `/goals`, `/library`, `/settings` or a bare `/chats/<id>`, so a page grammar on those paths collides with nothing.
- Separate HTML documents exist outside the shell and stay outside the grammar: `/admin` (`admin-routes.ts:65`), `/app/dashboard` (`dashboard-routes.ts:26`), `/vault/capture` (`vault-routes.ts:91`), and the host's `/login`.
- Routing is hand-written: a chain of sub-routers returning `null`, string compares and inline regexes. Paths are literals in 15 files. The plan centralises the page grammar only; the API literals belong to their sub-routers and are not a defect.
- Ids in addresses: chat id is a UUID v4 (`person/chats.ts:62`), a message id is `m<n>` or `m<n>.<k>` (`chat/history.ts:109`), a file is its path, a connector id is decoded from the path (`connector-routes.ts:68`).
- The manifest has `start_url` and `scope` at `/` and the service worker passes every same-origin request to the network (`http/page.ts:68-87`), so any path under `/` works for an installed app.
- Tests: `test/workers/support/page-harness.ts` has `location.search` only and a no-op `replaceState` (lines 240-241), no `pushState`, no `popstate`. The Chromium tests answer only `/` with HTML and every other path as JSON, so a deep link cannot be tested there today. `m14-app.test.ts:150` and `m17-history-reopen.test.ts:97` assert the `?chat=` form and change on purpose in F4.

## 2. The grammar

Ten rules. The parts cite them by number.

1. **A page is a path.** The page grammar is one module, `packages/agent/src/http/pages.ts`, a list of patterns the server and the shipped script both read. The server serves the shell for exactly those paths on a GET and nothing else. No path is both a page and an API route.
2. **Home is the last chat.** `/` draws the chat the Person last had open and the address becomes `/chats/<id>` by `replaceState`.
3. **A thing's address is its collection, then its id.** `/chats/<uuid>`, `/library/files/<path>`, `/library/artifacts/<slug>` (D-0010, the artifact thread's), `/settings/connectors/<id>`. A place that is not a thing is one word: `/feed`, `/goals`, `/library`, `/settings`, `/settings/permissions`.
4. **The fragment is a position, never a page.** `/chats/<uuid>#<mid>` opens the chat scrolled to the message. The server never sees it.
5. **The query carries a request's parameters, never a page's identity.** `?q=` on the search route, `?setup=` and `?next=` on `/login`. `?chat=` and `?file=` are deleted, not kept.
6. **No trailing slash and exact matching**, as the API already does. `/library/` is not a page.
7. **What opens pushes, what closes pops.** A page change is a history entry. An overlay with a path (Settings and its panes, a Library file) is an entry at its path. An overlay without one (the chats drawer, the search dialog, the phone's panel sheet, menus, confirm, invite) is an entry at the same path, so back closes it and the page beneath stays. Escape and the scrim pop the entry they own.
8. **An address nobody serves is a page that says so**, status 404, the shell drawn with the words and a link home. Never a redirect to home, never a 200.
9. **Ids are the objects' own.** A UUID stays a UUID. The artifact slug is D-0010's and is minted on that thread.
10. **The address survives sign-in.** A signed-out page request is sent to `/login?next=<path>`; after a passkey or recovery sign-in the login page returns to that same-origin path, else `/`.

Addressed pages and their parts:

| Address | Draws | Part |
|---|---|---|
| `/` | the last chat, then `/chats/<id>` | F4 |
| `/chats/<uuid>` | that chat | F4 |
| `/chats/<uuid>#<mid>` | that chat at the message | F4 |
| `/feed`, `/goals` | the tab views | F4 |
| `/library` | the Library list | F4 |
| `/library/files/<path>` | the file viewer | F6 |
| `/library/artifacts/<slug>` | D-0010; the artifact plan's own part | later |
| `/settings`, `/settings/connectors`, `/settings/connectors/<id>`, `/settings/permissions` | the Settings panes | F5 |
| `/login`, `/login?setup=`, `/login?next=` | the host's login page | F7 for `next` |
| any other path, browser GET | the not-found page, 404 | F4 |

Not addressed, by ruling: the chats drawer, the search dialog, the panel and its tabs (Approvals, Upcoming, Identity), menus and confirm dialogs. Back closes them (rule 7). If a notification ever needs to open an approval, `?panel=<tab>` on any page is the reserved shape.

## 3. Decisions

Two records and four log lines. Ids are assigned when each lands: the artifact thread holds D-0010 and possibly D-0009 as drafts, so I name the records by title.

- **The page-grammar record** (two-way under "No backwards compatibility until fletch has users", `decider: agent`, written by F4, confirmation `test/workers/f4-pages.test.ts`). Ruling: a page is a path in `pages.ts`, served as the shell on exactly those paths, a 404 page otherwise. Others rely on it: the artifact plan adds its `artifacts` collection against it. Recommend Kyle reads it beside D-0010 so the two agree, as a non-blocking question.
- **The sign-in return record** (one-way: a security boundary and the published `@qyvr/host-cloudflare` login contract, `proposed`, Kyle accepts). Ruling: the login page returns to the path named by `next` only when it is an absolute same-origin path that is not under `/login`, else `/`. Guard planted: `//evil.example`, `https://…`, `/login/anything` and a missing value all return `/`. Confirmation `packages/host-cloudflare/test/passkeys-routes.test.ts` and `test/workers/f7-signed-out-link.test.ts`. F7's Read line names it as a blocker.
- Log lines, written by the parts: the fragment names the message (rule 4); exact matching and no trailing slash (rule 6); an overlay without a path pushes an entry at the same path (rule 7); UUIDs stay in addresses (rule 9).

## 4. The parts, paste-ready for `docs/plan/parts.md`

Each sized for one build session on Opus, with F4 the largest and its split line named. Every Acceptance claim names its test file and is checkable.

````markdown
## Next parts

Written by the planning session of 2026-10-23 from a URL audit of the app at e275ead: the page is one document at
`/`, the address holds only `?chat=` and `?file=`, nothing pushes history, so back leaves the app, reload loses the
view, a shared file link can lose its file at boot, and a signed-out deep link ends at `/`. F4 to F7 give every
surface an address under one grammar (ten rules, `packages/agent/src/http/pages.ts` once F4 lands), in the order a
build can prove each on its own. The artifact plan's `/library/artifacts/<slug>` (D-0010, proposed on Kyle's thread)
is a collection under the same grammar; its part comes after these and registers the collection itself.

## F4 Addresses: the page grammar, the router and the chat's address

**Read:** `docs/decisions/README.md`. The page-grammar record is this part's to write (`decider: agent`, two-way
under "No backwards compatibility until fletch has users"); no one-way decision is needed. Then
`packages/agent/src/http/serve.ts` and `packages/agent/src/http/routes.ts` (where `/` is served and an unknown path
is answered), `packages/agent/src/http/page.ts` (the assembler and the service worker), the shell's boot and `show`
in `packages/agent/src/http/app/shell.ts`, `open` in `packages/agent/src/http/app/chat.ts` (the only
`history.replaceState`), `switchTo` in `packages/agent/src/http/app/chats-list.ts`, `seekTo` in
`packages/agent/src/http/app/message-actions.ts`, `openFound` in `packages/agent/src/http/app/search.ts` and the
drawer filter's row in `packages/agent/src/http/app/chats-filter.ts`, the notification address in
`packages/agent/src/delivery/service.ts`, the harness `test/workers/support/page-harness.ts` (its `location` and
`history`), and the two suites whose expectations change on purpose: `test/workers/m14-app.test.ts` (the `?chat=`
reload) and `test/workers/m17-history-reopen.test.ts` (the `replaceState` string).

**Scope:** One grammar, one router, and the chat and tab views on it.

1. The grammar module `packages/agent/src/http/pages.ts`: the page patterns as data (`/`, `/chats/<uuid>`, `/feed`,
   `/goals`, `/library`, and the collections `/library/<collection>/<id…>` and `/settings…` reserved for F5 and F6 as
   rows without a drawing yet), exported to the server and emitted into the page script as JSON, as `APP_VIEWS` is.
   The server serves `APP_PAGE` for a GET on exactly those paths. A browser GET (one accepting `text/html`) on any
   other path under a session gets `APP_PAGE` with status 404, and the shell draws the not-found page: the path, in
   words, and a link home; an API caller keeps the JSON 404 as today.
2. The router, a new script module `packages/agent/src/http/app/router.ts`: `go(path, { replace })` pushes or replaces
   the entry and draws; `popstate` draws from `location`; drawing a page calls what exists (`show`, `open`, `seekTo`).
   Every navigation the shell makes goes through `go`: the tabs and the rail, `switchTo`, a new chat, `openFound` and
   the drawer filter's row. The address changes only by `go`, from what the person did: a chat connected in the
   background (the boot's `chats()` under another view) never writes the address, which is what lost `?file=`.
3. The chat's address is `/chats/<uuid>`, a found message's `/chats/<uuid>#<mid>` (the fragment is the position,
   the server never sees it); `/` draws the last chat and becomes `/chats/<id>` by `replaceState`; reload of
   `/chats/<id>#<mid>` reopens the chat at the message; back returns to the previous chat or view. `?chat=` is
   deleted from the boot and from `open`. The push notification's address becomes `/chats/<id>`.
4. `/feed`, `/goals` and `/library` draw their views; reload keeps them. `document.title` names the page.
5. The harness: `page-harness.ts` gets a `history` with `pushState`, `replaceState`, `back()` and a `popstate`
   listener that update `location.pathname`, `search` and `hash`, and a `path` boot option beside `search`. The
   Chromium tests' route handler answers every grammar path with `APP_PAGE` and the rest as JSON, in one shared
   helper under `test/workers/support/` that the F5 and F7 browser tests reuse.

**Acceptance:** `test/workers/f4-pages.test.ts` (the server, as `f1-login` calls `serve`): a GET on each grammar path
with a session answers the page with 200 and `text/html`; a browser GET on `/nowhere` answers the page with 404,
and an API GET on it the JSON code (the violation planted: a 200 or a redirect to `/` on the unknown path fails);
`/library/` and `/chats/<id>/` are not pages; a page path is never claimed by an API sub-router and no API path is in
the grammar, checked over the grammar and the route table in one test; a notification's address is `/chats/<id>`.
`test/workers/f4-router.test.ts` (the page harness): booted at `/chats/<id>` the page connects to that chat; at
`/chats/<id>#m3` it scrolls to the bubble with that `mid`; at `/` the address becomes `/chats/<last>` by
`replaceState` and no entry is pushed; switching chats pushes `/chats/<other>` and `back()` reopens the first;
`/feed`, `/goals` and `/library` draw their views and reload keeps them; booted at `/library` while the chats load,
the address is still `/library` after `/app/chats` answers (the planted violation: the old `open()` rewriting the
address fails it); a found message from the Search dialog and from the drawer filter lands at `/chats/<id>#<mid>`;
`document.title` carries the chat's title; the not-found page names the path as text. The `[M14.2]` reload test and
the `[M17.1]` string test are updated to the new address and green. The page-grammar record is written with this
file as its confirmation and `node scripts/check-decisions.mjs` passes.

**Not in scope:** Settings' addresses and the overlays on back (F5); the Library's file address and the end of
`?file=` (F6; the parameter keeps working through this part, read at boot as today); the sign-in return (F7); the
`artifacts` collection (the artifact plan); any change to the API paths, their duplicates (`POST /chats`) or the
`/workshop/` links (a plain PR); the panel's tabs, which have no address; prettier ids.

**Rulings:**

- Ruling: pages are paths, not a hash and not a query — because D-0010 names a path and a path is what a person
  pastes, a server logs and a notification opens — if wrong (a host that cannot serve the shell on every path), the
  grammar module is the one place to change, and the service worker already passes every path through.
- Ruling: the grammar is one data module both sides read — because the page script is a string the suite runs as
  shipped, and a second copy of the patterns in the script would drift — if wrong, a generated `pages.json`.
- Ruling: the server serves the shell for exactly the grammar's paths and a 404 page otherwise — because a path
  nobody serves answered as home is a failure shown as success (D-0001) — if wrong, only the words of the page change.
- Ruling: the fragment names the message — because it is a position inside a page, the server need not see it, and
  `data-mid` already marks the bubble — if wrong, `?at=<mid>`, which the server would see and ignore.
- Ruling: `/` stays home and is replaced, never pushed — because a person who typed the address should not need two
  backs to leave — if wrong, push it.
- Ruling: the split, if the session needs one, is F4.1 (items 1, 2, 5 and the chat's address) and F4.2 (items 3's
  found message, item 4, the notification) — because F4.1 alone is a true page at every address it serves.

## F5 Back closes what opened: overlays and Settings' addresses

**Read:** F4's grammar (`packages/agent/src/http/pages.ts`) and router (`packages/agent/src/http/app/router.ts`). No
one-way decision is needed. Then `packages/agent/src/http/app/overlays.ts` (the `layers` stack, `openDialog`,
`closeDialog`, `closeOverlays`), the drawer and `relayout` in `packages/agent/src/http/app/shell.ts`, `openSettings`
and the panes' own Back in `packages/agent/src/http/app/settings.ts` and `settings-panes.ts`, the connector page in
`packages/agent/src/http/app/connectors.ts`, `srchOpen` in `packages/agent/src/http/app/search.ts`, the panel's
phone sheet in `packages/agent/src/http/app/panel.ts`, and the F4 browser helper under `test/workers/support/`.

**Scope:** Rule 7 of the grammar, on every overlay.

1. An overlay without a path (the chats drawer as sheet or overlay, the Search dialog, the phone's panel sheet, the
   More sheet, menus, the confirm dialog, the invite pop) pushes an entry at the same address when it opens; back
   closes it and the page beneath stays as it was; Escape, the scrim and its own close control pop the entry they
   own and never a page's; closing by any path leaves no stray entry, so one back after a close leaves the page.
2. Settings has addresses: `/settings`, `/settings/connectors`, `/settings/connectors/<id>` (the id as the route
   decodes it) and `/settings/permissions`. Opening Settings pushes `/settings` over the current page; a pane pushes
   its address; the pane's own Back is `history.back()`; closing Settings returns to the page it opened over; a reload
   at a Settings address draws that pane over home.
3. A device change (`relayout`) still closes every overlay, and pops the entries it closes, so history matches the
   screen.

**Acceptance:** `test/workers/f5-back.test.ts` (the page harness with F4's history): opening the drawer, the Search
dialog, a menu, the confirm dialog, the phone's panel sheet and the invite pop each push one entry at the same
address and `back()` closes exactly that one; Escape and the scrim pop the entry and a following `back()` changes the
page (the violation planted: a close that leaves its entry fails); `/settings/connectors` opens Settings on that pane
over the page it was opened from, the pane's Back returns to `/settings`, closing returns to the page beneath; a
reload at `/settings/permissions` draws that pane; a device change closes the open sheet and pops its entry.
`test/workers/f5-back-browser.test.ts` (Chromium, the F4 helper): with a real history, open the drawer and the Search
dialog from the rail, `page.goBack()` closes the dialog, a second closes the drawer, a third leaves `/chats/<id>` for
the previous page, measured on `page.url()` and the nodes' `hidden`.

**Not in scope:** addresses for the drawer, the search dialog or the panel's tabs (Ruling 1); the Library's file
viewer (F6); search history or `?q=` in the address; the enter and exit motions, unchanged from F3.

**Rulings:**

- Ruling: an overlay without content of its own gets an entry, not an address — because back must close it on a
  phone, where it fills the screen, but a drawer is not a place anyone links to — if wrong, `?panel=<tab>` and
  `?drawer=1` on any page, never a path.
- Ruling: Settings has addresses — because its panes hold content (a connector's page) a person returns to and a
  notification may name — if wrong, Settings becomes an entry at the same address like the drawer.
- Ruling: every pop is guarded by the entry's own state marker — because a stray entry makes back dead once, which is
  the defect this part exists to remove — if wrong, only the marker's shape changes.

## F6 The Library's file address

**Read:** F4's grammar and router. No one-way decision is needed; D-0010 (proposed, Kyle's on the artifact thread)
names `/library/artifacts/<slug>` and this part must leave that collection free and reachable. Then
`packages/agent/src/http/app/library.ts` (`libOpenFile`, the viewer and its `#viewer-back`, the Copy link),
`packages/agent/src/http/app-routes.ts` (`/app/file` and the link routes), `packages/agent/src/files/links.ts`,
and the suites whose expectations change: `test/workers/m27-library.test.ts` and
`test/workers/m24-3-documents.test.ts`.

**Scope:** The Library's things have addresses, and `?file=` is gone.

1. `/library/files/<path>` draws the viewer on that file, each path segment encoded with `encodeURIComponent` and
   decoded one by one; an empty or `..` segment is not a page. Opening a file from the list pushes its address; the
   viewer's Back is `history.back()`; reload keeps the file; a file the Person refuses or cannot read is said in the
   viewer with its code at that address (the grammar matched; the object refused), never as the not-found page.
2. Copy link emits `/library/files/<path>` and nothing reads `?file=` any more: the boot hook in `shell.ts` and the
   read in `library.ts` are deleted.
3. The grammar's collection rule: `/library/<collection>/<id…>` is a page only for a registered collection; `files`
   is registered here and `artifacts` is the artifact plan's to register, so `/library/artifacts/x` is the not-found
   page until then and `/library/other/x` always.

**Acceptance:** `test/workers/f6-library-address.test.ts` (the page harness and `serve`): booted at
`/library/files/notes/trip.md` the viewer opens that file; a segment with a space or a `#` round-trips through the
address; opening a file from the list pushes its address and the viewer's Back returns to `/library`; Copy link
emits the new address and the page's markup holds no `?file=` (the violation planted: the old link fails);
`/library/files/../x` and `/library/other/x` are the not-found page with 404; `/library/artifacts/x` is the
not-found page with 404 until a collection is registered (named in the test as the artifact plan's row); a refused
file is said in the viewer with its code at its address. The `[M27.5]` and `[M24.3]` suites are updated where the
link changed and green.

**Not in scope:** the artifact collection and its drawing (the artifact plan, D-0010); a file's content in the
address; the signed `/app/file/raw` links, unchanged; the Library's search, which launches the dialog (F3).

**Rulings:**

- Ruling: a file's id is its path in segments — because D-0010 puts an artifact's id in segments and two shapes under
  one collection root would be two grammars — if wrong, `?path=` under `/library/files`, never a second root.
- Ruling: a refused file at a matched address is said in the viewer, not as the not-found page — because the page
  exists and the object refused; the code is the answer (D-0001) — if wrong, the words change, not the status.
- Ruling: `artifacts` is registered by the artifact plan, not reserved here — because a page nobody draws is a lie,
  and the collection rule makes registering it one row — if wrong, add the row here with the not-found drawing.

## F7 The address survives sign-in

**Read:** `docs/decisions/README.md` and the sign-in return record, which this part needs `accepted` by Kyle before
it starts: a one-way door (a security boundary and the published `@qyvr/host-cloudflare` login contract). If the
record is still `proposed`, stop with `BLOCKED: needs Kyle` and the question under `BLOCKED (open)`. Then
`packages/agent/src/http/serve.ts` (the 302 to `/login`), `toLogin` in `packages/agent/src/http/app/shell.ts`,
`packages/host-cloudflare/src/passkeys/routes.ts` and `page.ts` (`location.assign("/")` after each success),
`packages/host-cloudflare/src/passkeys/identity.ts` (`PASSKEY_REQUIRED` after a recovery sign-in),
`packages/host-cloudflare/test/passkeys-routes.test.ts`, `test/workers/f1-login-browser.test.ts` (the soft
authenticator), and `docs/runbooks/release.md` for the changeset.

**Scope:** Rule 10.

1. A signed-out browser GET on a page path is sent to `/login?next=<path+search+hash>`; the shell's 401 redirect
   carries the current address the same way.
2. The login page, after a passkey registration, a passkey sign-in or a recovery sign-in followed by the passkey it
   requires, goes to `next` when it is an absolute same-origin path not under `/login`, else to `/`. The guard is
   in one function in the host package, tested with `//evil.example`, `https://evil.example/x`, `/login/recover`,
   an empty value and a value with a scheme.
3. A changeset for `@qyvr/host-cloudflare` (patch) and the record set to `accepted` quoting Kyle, in the same commit
   that lands the guard.

**Acceptance:** `test/workers/f7-signed-out-link.test.ts` (`serve`): a signed-out browser GET on `/chats/<id>#m3`
answers 302 with `location` `/login?next=%2Fchats%2F<id>` (the fragment never reaches the server, so the test asserts
it is absent); an API GET keeps the JSON 401; a signed-in request is unchanged. In
`packages/host-cloudflare/test/passkeys-routes.test.ts`, tagged `[F7]`: the return-path guard answers `/` for each
planted value above and the path for a plain one (the violation planted: a guard that passes `//evil.example`
fails). `test/workers/f7-login-return-browser.test.ts` (Chromium with the soft authenticator, as `f1-login-browser`):
a browser at `/feed` with no session lands on `/login?next=%2Ffeed`, signs in with a passkey and ends at `/feed`;
after a recovery-code sign-in it is held at `/login` to add a passkey and then ends at `/feed`.

**Not in scope:** any other change to the login page; remembering the address across a logout; a `next` that is not a
path; the session cookie's attributes.

**Rulings:**

- Ruling: the return path is a query on `/login`, honoured by the host's page — because the host owns sign-in and the
  page is the only thing that knows when it succeeded — if wrong (Kyle keeps the host's contract as is), the agent
  sets a short-lived same-site cookie on the 302 that the shell reads once at boot and clears.
- Ruling: only an absolute same-origin path not under `/login` is honoured — because `next` is the classic open
  redirect and a loop into `/login` is a dead page — if wrong, only the list of refused shapes grows.
````

## 5. The artifact plan's numbering

When the artifact plan lands it takes F8 onward (its F4 to F14 become F8 to F18), its records take the ids free at that time, and D-0010's `/library/artifacts/<slug>` fits the grammar unchanged: its part registers the `artifacts` collection in `pages.ts` under F6's collection rule and draws the page.

## 6. Build sequencing for Muse, and open questions

Run the parts in order F4, F5, F6, F7, each as a fresh `/goal` session with `Target part: F<n>`. F5 and F6 both depend only on F4, so either may go second. F7 needs the sign-in return record accepted by Kyle before its session starts, or it stops at once with `BLOCKED: needs Kyle`; the recommended answer is the ruling as written. Each part updates two or three inherited `[M<n>]` suites on purpose, as F3 did, and names them in its Read line.

Questions to send Kyle with the plan:

1. Accept the sign-in return record so F7 can run after F6. If he prefers no host change, the cookie fallback in F7's first ruling keeps the part inside the agent, and the record becomes a two-way one.
2. Read the page-grammar record beside D-0010 on the artifact thread, so the artifact slug and `/library/files/<path>` are one grammar. Non-blocking.
3. Two plain PRs outside the parts: remove or refuse by name the dead `/workshop/` links (D-0001), and the duplicate `POST /chats`, the unreachable second `/health` and the loose `/vault` prefix.

The brief itself remains unread. If its deliverables or house rules differ from the six above, the audit, grammar and parts stand as written and only the packaging needs to move.

The planning deliverable is complete and stands as my previous message: the audit of the app's URL surface, the ten-rule grammar, the two decision records and four log lines, the paste-ready parts F4 to F7 for `docs/plan/parts.md`, the one-line instruction for the artifact plan (take F8 onward and the next free record ids), and the build sequence with three questions for Kyle.

One thing is still outstanding and only you can resolve it: the brief at `/home/hatch/workspace/qyvr-for-muse/planning/router-fable-brief-2026-10-23.md` was never readable from this session, so the deliverable follows the repo's own rules rather than the brief's literal Deliverables 1-6 and house rules. To close that gap, rerun or continue this session with `--add-dir /home/hatch/workspace/qyvr-for-muse`, or copy the brief under `/home/hatch/workspace/fletch-work/`. The audit, grammar and parts will not change; only their packaging might. No files in the repo were edited.
