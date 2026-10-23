# Parts

The roadmap, one part per section: what one session builds and proves with `pnpm accept F<n>`. The session protocol
is `docs/plan/KICKOFF.md`; status lives in `docs/plan/PROGRESS.md`, not here.

Rules for every part:

- **Shape.** `## F<n> <title>` (or `### F<n>.<p>` after a split), then **Read:** (the only documents to load),
  **Scope:**, **Acceptance:** (claims a test can prove, each naming its test file once written), **Not in scope:**
  (binding), and **Rulings:** where the plan session settled something up front, each written
  "Ruling: X — because Y — if wrong, Z".
- **Splitting.** A session may split its part into `F<n>.1`, `F<n>.2`, … here, log the split in `docs/decisions/log.md`,
  and do exactly one.
- **Tags.** Every new test file's top-level `describe` carries `[F<n>]` (or `[F<n>.<p>]`); accept selects the
  part's tests and every earlier one by it, and fails a part with no test of its own.
- **Writing parts.** Kyle's plan session adds and reorders parts; a part session never adds one. A part names a
  one-way decision it needs as a blocker in its Read line, so a session stops instead of taking it.

F0 and F1 were written after the fact from the commits, tests and README (2026-10-22); their acceptance names what
exists.

## F0 The harness

**Read:** `scripts/accept.ts`, `test/m0/`.

**Scope:** The repository skeleton and the acceptance harness carried over from qyvr-co and cut to fletch: the
boundary check, `pnpm accept` with `F<n>` part ids and test tags, the secret and privacy scans, the pre-commit hook,
the hermetic vitest lane and CI.

**Acceptance:** `test/m0/accept.test.ts` (part ids and tags), `test/m0/harness.test.ts` (each check fails on a planted
violation; the pre-commit hook refuses a real commit), `test/m0/scans.test.ts`, and each script's `*.test.mjs`.

**Not in scope:** the platform's steps (the binding audit, the upstream pin check, the adapter contract suite), which
stayed in qyvr-co.

## F1 The self-host path

**Read:** README.md ("Set up your own fletch", "What is not in this build"), `docs/decisions/README.md`,
`docs/runbooks/live-deploy.md`.

**Scope:** One owner on one account, set up in about ten minutes on the free plan: the host seam (`@qyvr/host`,
`singleAccountHost`), secret-backed keys, passkey login with the setup token and a recovery code, the provisioning
library and `create-fletch`, the primitives' publish build, refusals by name for what a self-host lacks, Workers AI
models with no gateway, and the live exit test.

**Acceptance:** the `[F1]` tests in `packages/host/test/`, `packages/host-cloudflare/test/`,
`packages/create-fletch/test/`, `test/workers/` (the `f1-*` files), `test/live/` and the publish-manifest and
rewrite-dts script tests; and one passing run of `test/live/f1-deploy.live.test.ts` against a throwaway account,
its wall-clock time recorded in PROGRESS.md.

**Not in scope:** mail, the shared workspace, rendering and Access members (refused with their
`HOST_<FEATURE>_UNAVAILABLE` codes); publishing `create-fletch` so it runs without a checkout.

## Next parts

Written by the planning session of 2026-10-22 from Kyle's steering on search and the preview session's measurements
(`fletch-pv-1`): `/app/search` matched chat titles and memory lines only, never a message, so "think", on screen in
the open chat, answered "No results". F2 is the fix; F3 is the surfaces on it. The two Claude Design artifacts Kyle
shared sit behind a sign-in wall this machine cannot pass, so both parts specify the design from his screenshots of
the Muse app's search, as he described them; the Read lines say so.

## F2 Message-content search

**Read:** `docs/decisions/README.md`. No one-way decision is needed: the index is derived at query time (Ruling 1),
and Q4 in `docs/plan/QUESTIONS.md` is open and not blocking. Then `packages/agent/src/http/connector-routes.ts` (the
`/app/search` route as it stands), `packages/agent/src/http/app-routes.ts` (the `/app/chats` fan-out to each `Chat`,
the shape to copy), `packages/agent/src/chat/store.ts` and `packages/agent/src/chat/history.ts` (what a thread draws
and where it sits), `packages/agent/src/objects/chat.ts` (the owner decided on every method),
`packages/agent/src/person/chats.ts` (the owning store of whose chats these are), and the `[M27.3]` Search dialog
tests in `test/workers/m27-chat.test.ts`, which stay green on the new answer. The design reference is Kyle's
screenshots of the Muse app's search (the artifacts are behind a sign-in wall): each result pairs a chat's title with
the matched message line and a time.

**Scope:** Search finds what the owner said and what the agent answered. Each `Chat` answers a `search` call for its
owner alone: the entries its thread draws (`you` and `agent`, as `history()` returns them) whose text contains the
query, case-insensitive, newest first, each with the message's `mid`, its time, a line of at most 120 characters
around the first match and the match's offsets in that line. `/app/search` keeps its one answer for both surfaces:
with a query it fans out to every live chat of the person in parallel (as `/app/chats` does), merges the title
matches, the message matches and the memory half as it stands, and answers one row per chat (`chatId`, `title`,
`main`, `at`, `line`, `mid`, `more`: the newest match's line and time, and how many other messages in that chat
matched); a title match without a message match keeps the chat's time and no line. A chat that could not be searched
is named in the answer with its code beside the rows that were found, as the memory half already is; the route never
answers nothing-found for a read that failed. With an empty query the recents are the person's live chats by last
connection, newest first. The query cap stays 80 characters and the row cap is 20.

**Acceptance:** `test/workers/f2-search.test.ts`: a word in the owner's own message and a word in the agent's reply
each find the chat with the message's line, offsets, `mid` and time, in either case; a word only in a thinking block,
a tool result or an injected input is not found; two matches in one chat are one row with `more`, the newest as its
line; a title match alone carries no line, and a chat matched by title and by message carries the message's; the
rows come newest first; a second member's search never finds the owner's chat, and a `Chat` asked by anyone but its
owner refuses with a code; a chat whose search throws is named with its code while the other chats' rows are still
answered (the violation planted on the route's path: a search answered as empty with a failure dropped fails the
test); a compacted message is not found; recents follow the last connection; and the `/app/search` answer keeps the
fields the `[M27.3]` dialog draws, with that suite green. Marked `<b>` text in a message and in a query comes back as
text, never markup.

**Not in scope:** the surfaces (F3: the dialog's rows, the drawer's filter, the dismissal); a stored index (Q4);
archived chats, notices, cards, thinking, tool output, attachments and files; ranking beyond newest first; stemming or
tokenising; any change to the memory half; a model-facing tool that searches chats.

**Rulings:**

- Ruling: the index is derived at query time, each `Chat` scanning its own `messages` table (a `LIKE` prefilter on
  the stored body, then the drawn text) — because one owner has tens of chats, a scan is one call per live chat as
  `/app/chats` already makes, and it binds no storage schema, so no one-way door is taken — if wrong (a search over a
  second on the preview with Kyle's real history), Q4's FTS5 table per chat is the stored index, as a `chat.search-index`
  migration under a `proposed` record Kyle accepts.
- Ruling: what is searched is what the thread draws — because a hit must open to a line on screen (F3), and the page
  draws no compacted row — if wrong, widen to the compacted rows, which still sit in `messages` with `compacted = 1`.
- Ruling: one row per chat, the newest match as its line and `more` for the rest — because the design pairs each
  chat's title with one snippet — if wrong, a `hits` array on the row.
- Ruling: a chat that could not be searched is named with its code beside the rows found (D-0001) — because the
  measured defect was a failure's shape, an empty answer, shown for a search that never looked — if wrong, the rule
  still holds; only the words change.
- Ruling: matching is a plain case-insensitive substring over the drawn text — because the word typed finds the word
  on screen, predictably — if wrong, FTS5's tokeniser arrives with Q4.
- Ruling: recents are by last connection (`connected_at`, which the `Person` already records) — because recent is
  where the person was, not what they opened first — if wrong, by `opened_at` as before.

## F3 The search surfaces: dialog, drawer filter and dismissal

**Read:** F2's answer shape (`packages/agent/src/http/connector-routes.ts` as F2 leaves it). No one-way decision is
needed. Then `packages/agent/src/http/app/search.ts` (the dialog), `packages/agent/src/http/app/chats-list.ts` and
the drawer in `packages/agent/src/http/app/shell.ts`, `packages/agent/src/http/app/overlays.ts` (`closeDialog` waits
for every exit animation), the `.qf-scrim2` motion in `packages/agent/src/design/fletch/ds/components/bundle.css`,
`packages/agent/src/http/app/message-actions.ts` (each bubble's `data-mid`), and the two suites whose expectations
this part changes on purpose: `test/workers/m27-chat.test.ts` (the Search dialog) and
`test/workers/m29-6-motion.test.ts` (the dialog scrim's exit). The design reference is Kyle's screenshots of the Muse
app's search (the artifacts are behind a sign-in wall): one clear control in the field, results of title, snippet
and relative time, recents on an empty query, and a sidebar whose search filters the chat list in place with snippets.

**Scope:** Four changes, each on F2's one answer.

1. The dialog's rows: each result is the chat's title, under it the matched line with the match emphasised and the
   message's relative time (minutes and hours within the day, then the list's Yesterday, weekday and date labels, one
   helper both surfaces share); a title-only match shows the chat's kind as today. Choosing a result opens the chat
   scrolled to the matched message (`data-mid`) with a brief highlight; Enter opens the first result and the arrow
   keys move the active row. An empty query lists recents; a chat that could not be searched is named with its code
   under the rows, as the memory half is.
2. One clear control. Measured in the markup: the field is `<input type="search">`, so Chrome and Safari draw their
   own cancel glyph beside the dialog's Clear button once a query is typed, two x glyphs side by side. Every search
   field in the app (the dialog's and the Connectors page's) becomes `type="text"` with `enterkeyhint="search"`, the
   dialog's Clear stays the one control, shown only with a query, and the dialog closes by the scrim, Escape and its
   hidden Cancel, with no second glyph.
3. The drawer's search is its own surface: its pill becomes a field in the drawer's head. Typing filters the chat
   list in place from the same route: the section headings give way to the matching chats, each with its matched
   line under the title; no match says so in words; a chat that could not be searched is named with its code; the
   drawer stays open throughout; clearing the field or Escape in it restores the full list. The rail's Search and the
   phone's More sheet still open the dialog, and the Library's search still launches it.
4. Dismissal. Measured today: closing a dialog marks its scrim `.is-closing`, the card's `qf-pop-out` ends after
   `--qf-dur-fast` (150 ms) but the scrim's `qf-scrim-out` runs `--qf-dur-scrim-dialog` (1 s), and `closeDialog`
   hides nothing and blocks every click until the last animation ends: a second of darkened, dead page after the
   search is gone. A dialog's close runs the scrim's fade and the card's exit at one duration, `--qf-dur-fast`, in
   parallel, so the page is live within it; the enter motion is unchanged.

**Acceptance:** `test/workers/f3-search-dialog.test.ts` (the hermetic page harness of `m27-chat`): a result row draws
the title, the line with the match emphasised as a text node and the relative time, and marked text in a line comes
back as text, never markup; choosing a result connects to that chat and scrolls to the bubble with its `mid`; Enter
opens the first row; the app page's markup holds no `type="search"` (the violation planted: the old field fails it);
Clear is hidden without a query and shown with one; a failed chat's code is drawn under the rows; the `[M27.3]`
dialog suite is updated where this part changes its expectations and green. `test/workers/f3-drawer-filter.test.ts`:
typing in the drawer's field draws only the matching chats with their lines, no match says so, a failed chat is named
with its code, the drawer stays open, clearing restores the list with its headings, and the rail's button still opens
the dialog over the drawer. `test/workers/f3-search-motion.test.ts` (Chromium, as `m29-6-motion`): on the Search
dialog's close, the scrim's exit and the card's exit run at the same duration, the node is hidden, the scrim is gone
and no `.is-closing` is left within that duration, for the dialog opened from the rail and from the drawer; the
`[M29.6]` suite's expectation for the dialog scrim's exit changes with it; planted: with the scrim's exit restored to
`--qf-dur-scrim-dialog` the check fails.

**Not in scope:** F2's route and index; a results page or a search in the thread itself; search history or
suggestions; highlighting in the thread beyond the brief flash; the Library's own search (it launches the dialog);
the enter motion and the other overlays' timings; a phone-only Done or Close button (Ruling 2).

**Rulings:**

- Ruling: the double x is the native cancel glyph of `<input type="search">` beside the dialog's own Clear, and every
  search field becomes `type="text"` with `enterkeyhint="search"`, held by a test over the page's markup — because
  the browser draws that glyph and no field of the system shows one — if wrong (a platform that needs the search
  semantics), keep `type="search"` and hide `::-webkit-search-cancel-button` under the same test.
- Ruling: the dialog has no visible close control; the scrim, Escape and the hidden Cancel close it — because the
  design shows one control in the field and the system's dialogs close on their scrim — if wrong, a phone-only Done in
  the field's row, never a second x.
- Ruling: the drawer filters in place from the same route and answer — because one answer, two drawings, and the
  drawer must not become a second launcher — if wrong, a list-only parameter on the route, never a second route.
- Ruling: dismissal at one duration applies to every `.qf-scrim2` dialog, in the system's bundle — because a second
  of dead, darkened page is wrong on every dialog, not only on search — if wrong, scope it to the search scrim with
  `.qf-scrim2:has(> #search)` and leave the system's rule.
- Ruling: no debounce timer on either field; a request per input with the sequence guard the dialog already keeps —
  because the tests own no clock (`scripts/check-test-hygiene.mjs`) and the route is one parallel fan-out — if wrong,
  a short debounce behind a hook the tests can call.
- Ruling: a result opens the chat at the message — because a snippet that opens the top of a long chat is half an
  answer — if wrong (the message no longer drawn), open the chat with a line saying the message was compacted away.

## Next parts

Written by the planning session of 2026-10-23 from a URL audit of the app at e275ead: the page is one document at
`/`, the address holds only `?chat=` and `?file=`, nothing pushes history, so back leaves the app, reload loses the
view, a shared file link can lose its file at boot, and a signed-out deep link ends at `/`. F4 to F7 give every
surface an address under one grammar (ten rules, `packages/agent/src/http/pages.ts` once F4 lands), in the order a
build can prove each on its own. The artifact plan's `/library/artifacts/<slug>` (the artifact record, proposed on Kyle's thread and not yet in this repository)
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

- Ruling: pages are paths, not a hash and not a query — because the artifact record names a path and a path is what a person
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

**Read:** F4's grammar and router. No one-way decision is needed; the artifact record (proposed, Kyle's on the artifact thread)
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

**Not in scope:** the artifact collection and its drawing (the artifact plan and its record); a file's content in the
address; the signed `/app/file/raw` links, unchanged; the Library's search, which launches the dialog (F3).

**Rulings:**

- Ruling: a file's id is its path in segments — because the artifact record puts an artifact's id in segments and two shapes under
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
