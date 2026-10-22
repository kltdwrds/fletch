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
