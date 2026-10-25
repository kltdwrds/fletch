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

## F8 A new chat is a drafted placeholder at `/chats/new`

**Read:** F4's grammar and router (D-0009), F5's overlay history rules. Kyle's direction, 2026-10-23: a new chat
starts as a client-side drafted placeholder, fast to navigate to; the chat is created and named from the first
input when it is sent, and the address reroutes to the assigned id as the response comes in (muse.ai's
`/thread/new` flow). Then `packages/agent/src/http/pages.ts` (the chat row is a strict UUID pattern — the literal
`new` needs its own row, matched before any id pattern), `packages/agent/src/http/app/chats-list.ts`
(`NEW_CHAT.onclick` at line 159 creates a chat over `POST /app/chats` on the click, then navigates — the behaviour
this part removes), `packages/agent/src/http/app/chat.ts` (the composer, the send path and where the open chat's
id is held), `packages/agent/src/http/app/router.ts` (the replace/push choices), and the server side of
`POST /app/chats` in `packages/agent/src/http/app-routes.ts` (what a created chat's title is before any rename:
today the literal `New chat`). Also the `#new-chat` button in `packages/agent/src/http/app/shell.ts` (line 219)
and the `qf-ibtn` styles: Kyle asked for a hover state on the `+`, with the tooltip naming the action, as Muse's
`+` shows `New side chat` on hover.

**Scope:** `/chats/new` is a page in the grammar that holds a draft; nothing exists on the server until the
first message is sent.

1. The grammar gains the literal row `/chats/new` (view `chat`, no id). It never matches a UUID row and no UUID
   is ever `new`. The server serves the page on it like any page path; a signed-out browser is sent to sign in
   as elsewhere (F7's return is not this part's problem).
2. Clicking New side chat navigates to `/chats/new` at once — a push, like opening any chat — and fires **no**
   `POST /app/chats`. The composer is focused and ready. An unsent draft's text stays in the composer when the
   person navigates away and back to `/chats/new` in the same page session; it is never sent and never saved
   anywhere else.
3. The first send from the placeholder creates the chat and sends the message through the existing paths (one
   `POST /app/chats`, then the message on the created chat), and when the creation answers, the address is
   **replaced** with `/chats/<id>` — Back from the created chat never lands on the placeholder. The reply streams
   into the same view without a redraw of the conversation.
4. The created chat is named from the first prompt: when its first message lands, its title in the list and the
   document title is drawn from that prompt (trimmed, on one line, sensibly capped), not the literal `New chat`,
   unless the person renames it — a rename always wins, before or after. The mechanism (server names it on the
   first message, or the client sets it through the rename path) is the session's choice; the claim is what the
   person sees. A chat created any other way with no message keeps `New chat`.
5. Leaving `/chats/new` without sending creates nothing: no empty chat appears in the list, then or after a
   reload. (Today's two-step: every `+` click leaves a real `New chat` row behind — the violation this part
   removes.)
6. The `#new-chat` button gets its hover state: on hover (and on keyboard focus) it shows the same visible
   treatment the design system's icon buttons use for hover, and a tooltip naming the action (`New side chat`,
   the button's existing accessible name). No other button's behaviour changes.

**Acceptance:** `test/workers/f8-new-chat.test.ts` (the page harness and `serve`): booted at `/chats/new` the
composer is the chat view with no id and no `POST /app/chats` is recorded while the page opens or the person
types (the violation planted: the old click handler's create-on-open fails this); clicking `#new-chat` from an
open chat pushes `/chats/new` and records no create; sending a first message records exactly one create, the
address is replaced by `/chats/<new id>` (a following `history.back()` does not return to `/chats/new`), and
the reply renders in place; after the send the list row and the document title show the prompt-derived name,
not `New chat`; navigating from `/chats/new` to the main chat and back keeps the unsent text and still records
no create; a reload at `/chats/new` serves the page (200). The hover claim is covered in the harness by the
button's tooltip text and hover class hook, and by eye at UAT — CSS pseudo-classes are not asserted in tests.

**Not in scope:** an LLM-summarised title (the name is drawn from the prompt's own words; a summariser is a
later part if Kyle wants one); attachments staged on the placeholder (the composer's existing attach flow is
unchanged — if it needs a chat id today, that limit stays and is said in the part's report); drafts surviving a
reload; the main chat's creation, which is the Person's own; F7's sign-in return.

**Rulings:**

- Ruling: creation waits for the first send — because a chat nobody wrote in is list noise (Kyle's screenshot
  showed two `New chat` rows from two clicks) and Muse's `/thread/new` proves the placeholder flow — if wrong,
  creation returns to the click and the placeholder is only an address.
- Ruling: the reroute replaces, never pushes — because the placeholder was never a place the person was; Back
  from the new chat belongs to where they came from — if wrong, it pushes and Back shows an empty composer.
- Ruling: the name comes from the first prompt's own words, set once when the first message lands — because the
  list must say which chat this is without a model call on the send path — if wrong (Kyle wants a summary), a
  later part renames it when the first reply completes, and this part's claim moves there.

## F9 Hover/touch parity: nothing a person needs is reachable only through hover

**Read:** Kyle's screenshots of Muse on desktop and mobile (2026-10-23) and the audit of the served CSS at `e3938557`: three control clusters were revealed only on hover, and the app CSS carried no `@media (hover …)` rule anywhere — message actions (`.acts`, `packages/agent/src/http/app/message-actions.ts`), a chat row's time and kebab (`.qf-row-end`, the bundle in `tokens.ts`), and a Library card's more button (`.cmore`, `library.ts`).

**Scope:** a hover-revealed control rests visible wherever the pointer cannot hover finely, and is hidden at rest only under `@media (hover: hover) and (pointer: fine)` — capability, never form factor (`device()` is not consulted). The three clusters above, plus any other hover-gated reveal the sweep finds in the served CSS; hover *styles* (backgrounds) are not parity problems and do not move. On the phone layout the message actions stay behind the existing under-bubble ⋯ and press-and-hold routes.

**Acceptance:** `test/workers/f9-hover-parity.test.ts`: the served CSS (page CSS and the bundle) holds no `:hover` reveal (`opacity`, `pointer-events`, `visibility`, `display`) outside the capability gate — planted ungated copies of all three old rules fail it; each cluster's rest state and gated reveals are asserted in the served-CSS style. Kyle's UAT by eye on staging: on a phone the row times and kebabs and the Library more-buttons rest visible; on desktop they reveal on hover as before.

**Not in scope:** hover styles and motion; new touch gestures; the drawer's phone-kebab rule (it hides nothing); any change to what the controls do.

**Rulings:**

- Ruling: controls show by default and hide only inside the gate — because a hovering coarse pointer would otherwise be left with the control behind a hover — if wrong, they hide by default and show under `(hover: none)`. (Logged in `docs/decisions/log.md`, 2026-10-24.)
- Ruling: the gate is capability, `@media (hover: hover) and (pointer: fine)` — because the same browser window can be either (Kyle's own shots were a phone frame inside a desktop browser) — if wrong, form factor decides and the frame case regresses.

## F10 Reactions, full circuit: the agent reacts, reactions reach the model, a reaction answers a question

**Read:** `docs/briefs/reactions-plan-fable-2026-10-23.md` (the build plan), the spec and dump beside it in `docs/briefs/`, `packages/agent/src/chat/message-actions.ts`, `history.ts`, `frames.ts`, `mailbox.ts`, `intake.ts`, `engine.ts`, `context/assemble.ts`, `assemble-turn.ts`, `tools.ts`, `tools/search.ts`, `http/app/message-actions.ts`, `http/app/chat.ts`; `VISION.md` ("it asks before it acts": a reaction is never a grant decision).

**Scope:** (1) a `react` tool in the core namespace queues a `react` effect; the outbox stores it under the reactor `agent` and broadcasts `reaction` with `by: "agent"`; any single emoji grapheme, on the person's messages alone, set or replace. (2) Standing reactions ride each turn's envelope as a fenced `chat:reactions` block naming reactor, emoji and message id. (3) A reaction on the agent's last message when that message asked a question (and no turn runs, and the latest turn ended done without a card) becomes a `reaction` mailbox row carrying the harness signal, starting or steering a turn; it draws no bubble. Any other reaction is ambient. (4) History and the frame collect reactions by `by`; the page draws one pill with both; the person's bubble is named on `turn_started`/`queued` so a reaction lands live. (5) `CHAT_TASK` teaches when to react.

**Acceptance:** `test/workers/f10-reactions.test.ts` and `test/workers/f10-reactions-page.test.ts` (claims T1–T5 of the plan: collected pill; envelope block fenced by mid with a byte-identical prefix and a clean transcript; live naming; the agent's 👍 before its words, stored, reloaded, replaced, refused by code for a bad emoji, its own message or an unknown id; the question case starts a turn reading the signal with no bubble and no URL-table write, the ambient case starts nothing, a card case starts nothing, the steer case, the duplicate case), each guard planted. Kyle's UAT on staging: react 👍 to a fletch question → it proceeds; ask for a job → 👍 lands on his message before the result.

**Not in scope:** other people reacting (admission stays owner-only); removing an agent reaction; an explicit ask marker (follow-up if the `?` rule misfires); reaction notifications outside the chat; counts; custom emoji; F9's hover-reveal changes.

**Rulings:**

- Ruling: the pending question is the agent's last drawn message carrying `?` — because the ASKING contract makes that the agent's convention and the engine holds no other state — if wrong, an explicit `awaiting_reply` marker on the turn replaces the test.
- Ruling: the agent's reaction is set/replace, never toggle — because the outbox replays an effect after a crash and must land on one state — if wrong, a `remove` flag joins the tool.
- Ruling: reactions enter context through the envelope, never the stored transcript — because they change after the fact and the envelope is the per-turn, unpersisted, replayed block — if wrong, a harness message is appended at assembly and recorded for replay.

## F11 Activity design: the task drawer specimens, before any code draws one

**Read:** `~/workspace/qyvr-for-muse/planning/activity-plan-fable-2026-10-25.md` §(b.7) and §(c) F11; the primer's §1
(the five PR #15 screenshots, catalogued) and §5 Phase 0; `packages/agent/src/design/fletch/ds/components/bundle.css`
(`.qf-tl`, `.qf-items-head`, `.qf-status`, `.qf-dlg--960`, `.qf-src`, `.qf-acc`, the phone sheet rules at the
`qf-scrim2--sheet` block); `packages/agent/src/http/app/panel.ts` (`PANEL_CSS`, the job dialog's markup and
`openJob`); `scripts/ds-tokens.ts` (how the bundle reaches `tokens.ts`); `test/workers/f9-hover-parity.test.ts`
(served-CSS assertions, the style to copy). No one-way door.

**Scope:** The drawer's look is settled in the design system before F15 draws it. One new comment block in
`bundle.css`, "Task drawer (activity)", holding: the drawer body `.qf-task` (two panes from 768 px, the timeline
at 360 px and the detail filling the rest; one pane under 768 with `.qf-task.is-detail` showing the detail and a
Back control); the head row `.qf-task-head` with the status pill on `.qf-status` and four tones `--done`,
`--run`, `--fail`, `--wait` (dot colours from the tokens' success, accent, error and tertiary fills) and the
title; the timeline on `.qf-tl` with a selected row `.qf-tl li.is-sel`, a failed rail mark `.qf-tl .rail
b.is-fail`, a waiting mark `.is-wait`, a nested list `.qf-tl--nested` for a coordinator's workers, and a one-line
ellipsised title `.qf-tl .nm`; the section header reusing `.qf-items-head` for `SUBAGENT 01`; the code block
`.qf-code` (the `.qf-src` face) with its control bar `.qf-code-bar` (Copy, Download), the fold `.qf-code.is-cut`
and the Show more control `.qf-more`; the file card `.qf-fcard` (name, type, an eight-line preview); the empty
and could-not-read states reuse `.panel-note`. A static specimen document,
`packages/agent/src/design/fletch/ds/specimens/task-drawer.html`, uses only the bundle's classes and shows the
PR #15 drawer with its main steps, a `SUBAGENT 01` section, one selected step with a code detail, one edit
detail and the summary with two file cards, in light and dark. A screenshot set of that specimen at 1280 px
and 390 px, light and dark, made with the pinned `playwright-core` Chromium, is attached to the PR for Kyle's
approval. `pnpm ds` regenerates `tokens.ts`; neither it nor `icons.ts` is edited by hand.

**Acceptance:** `test/workers/f11-activity-specimens.test.ts`: the served `PAGE_CSS` (`http/page.ts`) carries each
rule named above by selector (planted: deleting `.qf-tl li.is-sel` from the bundle fails it); the two-pane rule
sits inside a `min-width: 768px` media query and the one-pane rule outside it (planted: an ungated two-pane
rule fails); the specimen document's class names are all defined in the bundle (planted: one undefined class
fails); the specimen draws every step kind the primer's §1.3 catalogues (a bash-shaped code step, an edit, a
launch, a summary with file cards, a bare Started) as text in the document. By eye, not by test: Kyle approves
the screenshot set or returns questions before F15 starts.

**Not in scope:** any script, route or store; the page's drawer (F15); the detail's behaviour (F16); copying the
Claude Design artifacts, which hold no activity screen (the plan's §(b.7)); glyph additions to `SCRIPT_GLYPHS`
(F15 takes them when a drawing needs them).

**Rulings:**

- Ruling: the drawer extends the bundle's own goal-detail timeline (`.qf-tl`), status pill (`.qf-status`) and
  section header (`.qf-items-head`) — because they exist, match the screenshots' rail-and-glyph shape and keep
  one timeline language across goals and tasks — if wrong, a `.qf-task-tl` of its own is one renamed block.
- Ruling: two panes from 768 px, the panel's own pin breakpoint — because the panel is pinned beside the chat
  from the same width (`shell.ts`, M29.2) and one breakpoint is one rule — if wrong, the drawer's own breakpoint
  is one media query.
- Ruling: the truncation rules are three and stated here: a list title is one line, ellipsised at the pane
  edge; a command, a script or a change in the detail is never truncated; a result block folds past 40 lines
  behind Show more and says "cut at 20,000 characters" when the route cut it — because the reference's output
  truncation had no affordance (primer §1.4) — if wrong, the fold length and the route cap are two constants.

## F12 A task is a record: a turn's work becomes a titled task with its join keys

**Read:** `~/workspace/qyvr-for-muse/planning/activity-plan-fable-2026-10-25.md` §(b.1), §(b.6) and §(c) F12; the primer's
§2, §4.2 and decisions 6.1–6.3, 6.6; `packages/agent/src/chat/store.ts` (`turns`, `turn`, `history`, the
`typed:` meta, `compactBefore`), `packages/agent/src/chat/mailbox.ts` (the start-kind read at the
`delivery = 'start'` query), `packages/agent/src/chat/engine.ts` (`send`, `request`, `handoff`, `beginHandoff`,
`cardsFor`, `lastAt`), `packages/agent/src/objects/chat.ts` (`cardsFor`, `lastAt`, `search` as owner-checked
reads), `packages/agent/src/http/app-routes.ts` (`/app/activity`, the approvals fan-out, `part`),
`packages/agent/src/index.ts` (the `app` directory at the `activity:` line), `packages/agent/src/http/app/chats-list.ts`
(`promptTitle`, `TITLE_FROM_PROMPT`), `packages/agent/src/obs/activity-words.ts` (keep the words tables, delete the
note projection), `packages/agent/src/grants/journal.ts` (`runId` is the turn id; `id` is the effect id). No
one-way door: no schema changes.

**Scope:** Every main-agent turn's work is a task the owner can list, without a gated effect having happened.

1. `packages/agent/src/chat/activity.ts`: `TaskRecord { id, chatId, title, origin: "typed" | "request", status:
   "running" | "waiting" | "done" | "failed" | "stopped", code, startedAt, endedAt, turnIds, stepCount, groups,
   summary: null, capped: false }` and `tasksOf(store, mailbox)` / `taskOf(store, mailbox, id)`. The anchor rule
   from the plan's §(b.1): a turn begun by the person's own words (the `typed:` meta, or a mailbox start of kind
   `user`) or by a colleague's request (`requestText:` meta) is an anchor and a task; every other turn attaches to
   the latest anchor before it. `stepCount` is the number of `toolCall` parts across the task's turns, read with
   a new `ChatStore.rowsOfTurns(turnIds)` that does not filter `compacted` (the steps themselves are F13).
2. `promptTitle` and `TITLE_FROM_PROMPT` move to `packages/agent/src/chat/prompt-title.ts`; `chats-list.ts`
   re-exports them. A typed task's title is `promptTitle` of the anchor's text; a request task's is
   `promptTitle` of its `requestText:` meta.
3. `ChatEngine.tasksFor(person)` and `taskFor(person, id)` (null unless `person` is the owner, as `cardsFor`),
   exposed on the `Chat` object; `AppDirectory.chatTasks(person, chatId)` and `chatTask(person, chatId, turnId)`;
   `index.ts` wires them to `getAgentByName(env.CHAT, chatId)`.
4. `GET /app/activity` answers `{ ok, tasks, unread }`: the person's chats from `dir.chats(view)`, each asked in
   parallel for its tasks (`TASKS_PER_CHAT = 50` newest), merged newest first by `startedAt`, cut at
   `TASKS_SHOWN = 100`; a chat that could not be read is in `unread` with its code. `GET
   /app/activity/<chatId>/<turnId>` answers `{ ok, task }` or the refusal with its code (403 on `CHAT_NOT_OWNER`,
   404 on `TASK_NOT_FOUND`). `notesOf`, `ActivityNote` and the Ledger `activity` wiring are deleted.
5. The panel's Activity tab (`panel.ts` `sheetActivity`) draws the tasks as `prow`s in day groups: title, the
   status in words from one table (`ACTIVITY_TEXT.status`: "Complete", "Running", "Waiting on you", "Failed:
   <code>", "Stopped"), the time; the glyph by status (`ACTIVITY_GLYPH` re-keyed: `check`, `pulse`, `bell`,
   `x`, `dot`). Rows are not yet buttons (F15). `activityEmpty` stays, said only when there are no tasks.

**Acceptance:** `test/workers/f12-activity-tasks.test.ts` (the authority world and the `m27-panel` page harness):
a turn that only writes a file (`file_write`, no gated effect) produces a task with its title from the prompt,
`done`, start and end times and one turn id, and the Activity tab draws it instead of "Nothing yet" while the
Ledger holds no journal row for it (the planted violation: a list read from the journal alone fails); a mail
proposal decided later continues under the same task (the continuation turn attaches); a delegation's handoff
turn attaches to the task that delegated; a colleague's request is its own task titled from the request;
a compacted anchor still lists with its step count (`compactNow`, then the read; planted: a `compacted = 0`
filter in `rowsOfTurns` fails); Bo cannot list or open Ada's task (his list has none; `GET /app/activity/<ada's
chat>/<turn>` answers 403 with `CHAT_NOT_OWNER`); a chat whose read fails is named in `unread` and the tab says
"Could not read" for it, never empty; `promptTitle` through `chats-list.ts` is unchanged (the F8 test still
passes).

**Not in scope:** the steps (F13), sub-agent sections (F14), the drawer (F15), typed detail (F16); a job run as a
task (its gated effects leave the Activity tab; the Upcoming tab's run history keeps them — a later part makes
runs tasks on `jobs/store.ts`'s steps); an address for a task.

**Rulings:**

- Ruling: a task is an anchor turn plus the turns that continue it without new words from the person — because
  `MAX_STEPS_PER_TURN` is 8 and a reviewer's handoff is its own turn, so one turn per task would split one
  request's work into untitled pieces — if wrong, `tasksOf` returns one task per turn and the attach step goes.
- Ruling: the title is the anchor's own words under F8's cap, no model call — because the list must name the
  task on the read path and F8 settled the cap — if wrong, a later part renames from the summary.
- Ruling: the journal-only Activity feed is deleted, not kept beside the tasks — because two lists of what the
  agent did drift, and the journal's rows are now joined into the tasks' steps (F13) — if wrong, an "Other
  activity" group returns from the journal rows whose `runId` is no chat turn.

## F13 The step timeline: a task's tool calls, in order, with their results

**Read:** `~/workspace/qyvr-for-muse/planning/activity-plan-fable-2026-10-25.md` §(b.2), §(b.4) and §(c) F13; the primer's
§1.2 (the step catalogue), §1.5, §4.3, decision 6.6; `packages/agent/src/chat/history.ts` (`visibleHistory`,
`textOf`: what the timeline must not reuse and why), the pi-ai `ToolResultMessage` type
(`node_modules/@earendil-works/pi-ai/dist/types.d.ts`, `toolCallId`, `isError`, `timestamp`, `durationMs`,
`details`), `packages/agent/src/chat/turn.ts` (the barrier; `afterToolCall` fences every result),
`packages/agent/src/context/fence.ts`, `packages/agent/src/files/tools.ts`, `packages/agent/src/code/tool.ts`,
`packages/agent/src/chat/todo.ts`, `packages/agent/src/memory/tools.ts`, `packages/agent/src/tools/registry.ts`
(a tool's error is `CODE: reason`), `packages/agent/src/chat/approvals.ts` (`row`: journal `id` and `runId`),
`packages/agent/src/chat/tools.ts` (`ActionEffect.detail`), `packages/agent/src/objects/ledger.ts` (`journalRows`).
No one-way door.

**Scope:** A task's steps are its tool calls as the transcript stores them, named by code.

1. `packages/agent/src/chat/activity-steps.ts`: `StepRecord { n, turnId, callId, kind, tool, title, state:
   "started" | "done" | "failed" | "waiting" | "refused", code, startedAt, endedAt, durationMs, detail }` and
   `stepsOf(rows, journal)`: each `toolCall` part of an assistant message in seq order is a step; its result is
   the `toolResult` with the same `toolCallId`; `startedAt` is the message's `timestamp`, `endedAt` the
   result's, `durationMs` the result's; the result's text is read with the outer `tool:<name>` fence stripped
   (an `unfence` beside `fence`). `send_to_user` and `react` are not steps.
2. `STEP_WORDS`, one table by tool name: the kind (`read | edit | write | delete | search | code | todo | memory
   | load | launch | close | action | observe | other`) and the title in code's words ("Read `<path>`",
   "Edited `<path>`", "Wrote `<path>`", "Searched for `<pattern>`", "Ran a script", "Updated the checklist: 2
   open, 3 done", "Saved to memory", "Loaded the jobs tools", "Started 1 sub-agent: <first line of the brief>",
   a gated action by its label); an unknown tool is "Called <tool with spaces>". A step whose result `isError`
   is `failed` with the code parsed from the leading `CODE:` token (else `TOOL_FAILED`) and the title `<title>
   failed (<CODE>)`. The same path edited twice is two steps; the same tool called twice is two steps.
3. The journal join: for the task's turn ids, the Ledger's rows for the person with `runId` in them, matched
   to a step by `id === callId` or `id === callId + ":decision"`: outcome `DONE` → `done`, `PENDING` →
   `waiting`, a denial → `refused` with the outcome as its code; the decision and the outcome words
   (`OUTCOME_WORDS`, kept) go into the detail's lines. Memory tools have no row and need none.
4. `STEPS_PER_TASK = 200`: past it, the first 199 steps, a marker step saying how many are not shown, then the
   summary; `TaskRecord.capped` is true. `summaryOf`: the last done turn's final assistant text, plus up to
   three file cards for the paths of `edit` and `write` steps (newest first), each with the first eight lines
   of the change as preview. The summary is the task's last step (`kind: "summary"`), never the title.
5. `detailOf(step)` fills the plan's §(b.4) `StepDetail` for every kind, with the route's `BLOCK_CHARS =
   20_000` cut per block and `cut: true` when it cut. `GET /app/activity/<chatId>/<turnId>` now answers
   `{ ok, task, steps }`, the summary last.

**Acceptance:** `test/workers/f13-activity-steps.test.ts` (the authority world with the working tree, as
`m24-3-*` tests use it): a scripted task of the fallback shape (file_read, file_edit, file_edit of the same path,
code_execute whose script throws, code_execute that returns, todo_write, memory_write, a final text) lists its
steps in that order with the table's titles and kinds; the failed script step is `failed` with its code in the
title and in the detail's result; the two edits are two steps (planted: a dedupe by path fails); every step with
a stored result carries a start time and a duration; a gated action's step carries the journal's outcome by
call id (an auto mail → `done`; a card left pending → `waiting`; a declined card → `refused` with `DECLINED`),
and a join that drops `id` or `runId` before matching finds nothing (planted); a compacted task lists every step
(planted: `compacted = 0`); a task of 250 calls answers 199 steps, the marker and the summary and is `capped`;
no `send_to_user` step appears; the summary names the edited file with a preview of its change; a `<b>` in a
todo item is text in the step's title (the data, not the page: the page half is F16).

**Not in scope:** sub-agent steps and sections (F14); drawing anything (F15, F16); a model-written reading
sentence under a step (the plan's §(g)); per-step cost.

**Rulings:**

- Ruling: a message to the person (`send_to_user`) and a reaction are not steps — because they are the chat,
  drawn there already, and the reference draws the final message as the summary, not as a step — if wrong, two
  rows in `STEP_WORDS`.
- Ruling: the step's evidence comes from the transcript and only the outcome from the journal — because the
  journal is content-free by design (D-0001 territory: never reconstruct from prose) and the transcript is the
  chat's own owner-only record — if wrong, a `steps` table is a one-way door for Kyle.
- Ruling: the detail's sentence is code's words — because v1 makes no model call on a read path — if wrong, a
  later part asks the cheap route for one sentence per step and stores it beside the summary.

## F14 Sub-agent nesting: `SUBAGENT 01`, the launch step and the verdict in both places

**Read:** `~/workspace/qyvr-for-muse/planning/activity-plan-fable-2026-10-25.md` §(b.3) and §(c) F14; the primer's §1.2
(the sub-agent section), §1.5, §4.2, decision 6.4. **Blocker:** D-0011 (`docs/decisions/0011-subagent-transcript-read.md`,
proposed in the plan's §(g)) must be `accepted` by Kyle before this part reads a facet's transcript; if it is
not, build the section from the parent's rows alone and answer the child's steps with
`SUBAGENT_STEPS_UNAVAILABLE`, and record the half in `docs/plan/QUESTIONS.md`. Then
`packages/agent/src/subagents/store.ts` (`group`, `children`, `handedOffAt`), `packages/agent/src/subagents/host.ts`
(`delegate`, `run`, `deliver`, `renderHandoff`), `packages/agent/src/subagents/run.ts` (`subagent_transcript`),
`packages/agent/src/objects/subagent.ts`, `packages/agent/src/objects/chat.ts` (`ctx.facets.get`),
`packages/agent/src/chat/outbox.ts` (`startSubagents`, the group id), `test/workers/support/subagent-world.ts`.

**Scope:** A delegation is a step in the parent and a section of the child's own steps.

1. `groupIdOf(turnId, callId)` exported from `chat/outbox.ts` and used by `startSubagents` and by the reader.
2. The launch step's detail (kind `launch`): one paragraph in code's words naming each request's role, the brief
   (as text), the spawn status from the rows (queued, running, waiting, done, failed with its code), whether
   results are back (`result !== null`), and the verifier contract ("its handoff is checked by the verifier
   before it returns: pass, fail or unverified, with a reason").
3. `SubAgent.transcript()` on the facet (`objects/subagent.ts`): the facet's `subagent_transcript` rows as
   `Message[]`, in seq order. The parent calls it only after it has matched the child's row `person` to the
   session person; the route never names a facet.
4. The task answer gains `subagents: Array<{ n, grp, launchStep, rows: Array<{ id, role, depth, parent, brief,
   status, code, verdict, verdictReason, steps: StepRecord[] | { ok: false, code } }> }>`, one per group in
   creation order, numbered `01`, `02`; a coordinator's workers nest by depth; the child's steps come from
   `stepsOf` over the facet's messages with no journal (sub-agents are refused every action by their gate);
   the child's final text is its last step, "Handed off", with the text as the detail.
5. The verdict in both places: a synthesized `verdict` step in the parent, after the launch step's turn and at
   the group's `handed_off_at`, titled "Sub-agent 01 returned: pass" (or fail, unverified) with the stored
   reason as the detail; the chat handoff (`deliver`, unchanged) keeps carrying the same verdict.

**Acceptance:** `test/workers/f14-activity-subagents.test.ts` (the sub-agent world, with Bo from
`test/fixtures/people.json` as the second member): after a delegation, the task's `subagents[0]` is `01` with
the child's setup steps in order (its reads, as the fixture tools record them), the launch step names the role,
the brief, the spawn status and that results are not yet back; after the handoff the parent timeline holds the
verdict step with the stored verdict and reason and the chat's handoff carries the same verdict (both places,
one stored value); a child that failed shows its code at the section head and its steps up to the failure; a
second delegation is `02`; a coordinator's workers nest under it; Bo's read of Ada's task answers
`CHAT_NOT_OWNER` and never reaches a facet (planted: a reader that takes the person from the request instead of
the parent's row fails); a facet whose read throws answers the section with `SUBAGENT_STEPS_UNAVAILABLE`, never
an empty list.

**Not in scope:** drawing (F15); the child's detail shapes beyond F13's builders; closing or steering
sub-agents from the drawer.

**Rulings:**

- Ruling: the verdict lands as a parent step and as the chat handoff, drawn from one stored value — because the
  drawer must be complete on its own and the chat's behaviour is settled (M7.2) — if wrong, the step goes and
  the section head keeps the verdict.
- Ruling: sections number groups in creation order within the task, workers nest by depth — because the
  reference's `SUBAGENT 01` is spawn order and a coordinator's round is part of its delegation — if wrong, every
  row is its own section.
- Ruling: the parent decides who may read a child's transcript, from its own row — because the row is the
  authority on every spawn today (`depth.ts`) and the facet knows no person — if wrong, the facet stores the
  person at its first write and checks it too.

## F15 The Activity tab lists tasks and a row opens the drawer

**Read:** `~/workspace/qyvr-for-muse/planning/activity-plan-fable-2026-10-25.md` §(b.5), §(e) and §(c) F15; the primer's
§1.1, §1.4, §4.1, decisions 6.5–6.6; F11's specimens; `packages/agent/src/http/app/panel.ts` (`sheetActivity`,
`prow`, `openJob`, `drawJob`, `jobAgain`), `packages/agent/src/http/app/overlays.ts` (`openDialog` forms, the F5
entries), `packages/agent/src/http/app/shell.ts` (`openPanel`, `SCRIPT_GLYPHS`, `COMMON_SCRIPT`'s `el`, `icon`,
`getJson`, `couldNot`, `coded`), `packages/agent/src/http/page.ts` (script order), `packages/agent/src/http/app/icons.ts`,
`test/workers/f5-back.test.ts` (the overlay-entry claim's style). No one-way door; no address.

**Scope:** The drawer exists and shows a task end to end on real turn data.

1. `packages/agent/src/http/app/activity.ts`: `ACTIVITY_TEXT` (every word the drawer says, one table: the
   status words, "Refresh", "Back", "Steps", "Summary", "Show more", "Copy", "Download", "Could not read this
   task", "N more steps are not shown", "Sub-agent"), `ACTIVITY_CSS` (only what the bundle does not hold),
   `ACTIVITY_MARKUP` (`#task-dialog`: head with `#task-state` pill, `#task-title`, `#task-refresh`, the X; body
   `.qf-task` with `#task-steps` and `#task-detail`), `ACTIVITY_SCRIPT` (`openTask(chatId, turnId)`,
   `loadTask(ref)`, `drawTask(t)`, `drawSteps`, `selectStep(n)`, `drawDetail(step)`, `taskRefresh`), wired in
   `page.ts`. `panel.ts` keeps its 600-line headroom: its Activity rows become buttons (`tap`) that call
   `openTask`.
2. The timeline: main steps on `.qf-tl` in order, the glyph by kind, the title one line, a failed step's rail
   mark; then each `SUBAGENT nn` section (`.qf-items-head`) with its status and verdict at the head and the
   child's steps nested; then the summary step. Selecting a step marks it `.is-sel` and draws its detail
   generically from `StepDetail`: the prose, each block as a `.qf-code` with its label, the result with its
   code and duration in words, the lines. The typed polish is F16.
3. The head: the pill in the status tone and words; the title from the record (the same string the list row
   and the detail head show: one record, three places); Refresh calls `loadTask` again and keeps the selected
   step by `n`; a running task's pill says "Running".
4. Opening pushes one history entry (the overlay's own) and Back closes exactly it; the X and Escape close it;
   on a phone the drawer takes the panel dialog's place as the job dialog does and shows one pane with Back
   between them.
5. `SCRIPT_GLYPHS` gains the glyphs the timeline uses, from `icons.ts` only; `pnpm ds` if a glyph is new to
   `icons.ts`.
6. A task that could not be read is said in the drawer with its code (`couldNot`), never drawn empty.

**Acceptance:** `test/workers/f15-activity-panel.test.ts` (the `m27-panel` harness): after a file-only turn the
Activity tab's row is a button whose title, status word and time are the record's; clicking it opens
`#task-dialog`, whose title equals the row's and the detail head's (planted: a drawer that formats its own title
fails); the timeline lists the steps in order with the table's titles and a failed step marked; a delegated
task shows `SUBAGENT 01` with the child's steps and verdict; selecting a step draws its prose, blocks and result
words; Refresh re-reads the route (the second request is recorded) and the selection survives; a running task
says "Running" and offers Refresh; the opening pushes one entry and `history.back()` closes the drawer and
nothing else (F5's harness); on the phone layout the detail pane is hidden until a step is selected and Back
returns to the list; a route refusal draws "Could not read this task" with the code; Bo's panel draws none of
Ada's rows.

**Not in scope:** the typed detail shapes, the code-block controls, the fold, the file cards (F16); an address
(`/app/activity/<id>` stays reserved); live frames for a running task (the plan's §(e) names the follow-up).

**Rulings:**

- Ruling: the drawer is an overlay entry with no address — because decision 6.5 settled it and F5's mechanics
  exist — if wrong, one `PAGES` row and a `drawPage` branch (F4's pattern).
- Ruling: a running task is an open-time snapshot with Refresh — because decision 6.5 settled it and the
  panel already re-reads on open — if wrong, §(e)'s frame lands on the chat socket.
- Ruling: the drawer is its own module, `activity.ts` — because `panel.ts` is at 430 lines against the 600 cap
  and the drawer is a surface of its own — if wrong, nothing: a module split is free.

## F16 The detail pane per step type

**Read:** `~/workspace/qyvr-for-muse/planning/activity-plan-fable-2026-10-25.md` §(b.4) and §(c) F16; the primer's §1.3
(the detail catalogue) and §4.3; F11's specimens; F15's `activity.ts`. No one-way door.

**Scope:** Every step kind draws the shape the reference shows, as data the page sets only as text.

1. The builders in `activity-steps.ts` `detailOf` complete per kind: read (prose "Read `<path>`", the result
   block); edit (prose "Edited `<path>`", "Change:" block of the new text, "Before:" block folded, "Result:"
   the confirmation line); write (the whole text as the change); delete; search (the pattern and the matches);
   code (prose "Ran a script", "Script:" block in `js`, "Result (<n> ms):" block or "Failed (<CODE>, <n> ms):"
   with the error text); todo (the items as lines, open and done); memory (the write's text); load (the
   namespaces loaded); launch and verdict (one paragraph each, F14's); a gated action (the card's own lines
   from the effect's `detail`, the decision and outcome in `OUTCOME_WORDS`); the summary (the final text, then
   the file cards); bare (the title and one sentence). A step that started and has no result says so.
2. The page: each block is a `.qf-code` with its label, Copy (`navigator.clipboard`, falling back to a
   selection) and Download (a Blob URL named `<task>-<n>-<label>.txt`); a block over 40 lines folds behind Show
   more; a block the route cut says "cut at 20,000 characters" after Show more; file cards on `.qf-fcard` with
   the name, the type by extension and the preview; every string reaches the DOM through `el(tag, text)` or
   `textContent`, never `innerHTML`.
3. The phone form: selecting a step switches the drawer to the detail pane (`.is-detail`) with Back.

**Acceptance:** `test/workers/f16-activity-detail.test.ts` (the `m27-panel` harness on the fallback task plus a
delegation): each kind draws its shape (the labels and block count per kind, from one table in the test); the
code detail shows the whole script while the timeline's title is one line; the result words carry the code and
the duration; the edit detail shows the change block and the confirmation line; the summary shows the outcome
sentence and a card naming the edited file with its preview; a `<b>` placed in a todo item, an edit's new text
and the final text comes back as text in the row, the detail and the summary (planted: an `innerHTML`
assignment in `drawDetail` fails); a 60-line result folds with Show more and a cut block says so; every block
has Copy and Download; the phone layout shows the detail with Back after a selection.

**Not in scope:** editing anything from the drawer; a model-written reading; cost per step; syntax colouring
beyond the bundle's `.qf-src` tones.

**Rulings:**

- Ruling: Download is a Blob URL of the block's text — because nothing is served and no route is needed — if
  wrong, a route per block is the follow-up.
- Ruling: the fold is 40 lines on the page and the cut is 20,000 characters on the route — because the page
  must stay light and a cut must be said (D-0001's rule on partial reads) — if wrong, two constants.

## F17 The v1 activity eval: the fallback task, end to end, and the stretch shape

**Read:** `~/workspace/qyvr-for-muse/planning/activity-plan-fable-2026-10-25.md` §(f) and §(c) F17; the primer's §7 (the V1
GATE and the STRETCH) and §8; F12–F16; `docs/runbooks/preview.md`; `test/scenarios/` (any file, for the twice-run
style). No one-way door.

**Scope:** The gate the primer set, run as scenarios and by eye.

1. `test/scenarios/activity/f17-fallback-eval.test.ts`: the fallback task scripted on the authority world with
   the working tree — read a file, edit it, edit it again, run a script that throws, run one that returns,
   update the checklist, save to memory, answer — and asserted through the real routes and the shipped page in
   one scenario: the Activity tab lists the task by its title with "Complete"; the drawer lists its steps in
   that order with the table's titles; the failed script step carries its code in the title and in words in the
   detail; one code detail shows the whole script, the code and the duration; one edit detail shows the change
   and the confirmation; the summary shows the outcome sentence and the file card; no step is dropped; no model
   text is markup.
2. `test/scenarios/activity/f17-stretch-shape.test.ts`: the PR #15 shape in fletch's vocabulary — 27 main
   steps including the same file edited three times, two "verify"-like script runs of which one fails, four
   checklist writes, a memory write, a delegated reviewer whose child makes eight reads, the verdict step, and
   a summary with two file cards — asserting the order, the `SUBAGENT 01` section, both places for the
   verdict, and that the cap is not reached.
3. Live, by eye (the PR body): on a preview slot (`pnpm preview up`), Kyle runs the fallback task with the real
   model and opens the task from the panel: the list row, five step details (read, edit, code, launch where a
   delegation ran, summary), the sub-agent section, the file card. The UAT report lists measured defects apart
   from impressions, with the slot's address.

**Acceptance:** both scenario files pass twice under `pnpm accept F17` (the scenarios lane runs twice); the UAT
report is in the PR body with the preview address and the screenshots; `ACCEPT F17: PASS`.

**Not in scope:** new features; any change to the drawer the eval did not require; the literal PR #15 replay
(a merge, a PR, a staging deploy: fletch has no shell or git tool, the plan's §(g)).

**Rulings:**

- Ruling: the stretch is the PR #15 *shape* over fletch's own tools, not the PR #15 commands — because fletch
  cannot run `sed`, `git` or `pnpm verify` today — if wrong, a shell tool is a part of its own and the replay
  returns as a live eval after it.
