---
id: D-0009
title: Every page is a path in one grammar module both the server and the page script read; anything else is a 404 page
status: accepted
door: two-way
decided: 2026-10-23
decider: agent
confirmation: test/workers/f4-pages.test.ts, test/workers/f4-router.test.ts
revisit-when: a host cannot serve the shell on every grammar path, or a page needs an address the grammar cannot say
---
Ruling: the app's pages are the paths in `packages/agent/src/http/pages.ts` (`/`, `/chats/<uuid>`, `/feed`, `/goals`,
`/library`, and the rows reserved for Settings and the Library's collections); the server answers `APP_PAGE` for a GET
on exactly those, a browser on any other path under a session the page with a 404 that the shell draws as not found,
and an API caller its JSON 404; the page script reads the same rows as JSON and `app/router.ts` is the one place that
changes the address, by `go` from what the person did; a message's position is the fragment (`/chats/<id>#<mid>`) —
because a path is what a person pastes, a server logs and a notification opens, one table cannot drift between the
two sides, and a path nobody serves answered as home is a failure shown as success (D-0001) — if wrong (a host that
cannot serve the shell on every path), the grammar module is the one place to change.

## Context

Before F4 the app had one address, `/`, with the open chat in `?chat=` written by `open()` on every connection, so a
chat connected in the background overwrote whatever the person had open (it lost `?file=`), and any unknown path was a
JSON 404 even to a browser. F4 (the 2026-10-23 router audit) gives each view its own address. Two-way under "No
backwards compatibility until fletch has users": `?chat=` is deleted outright, not redirected.

## Options

- **Chosen:** paths, from one data module emitted into the page script as JSON, as `APP_VIEWS` is.
- Rejected: a hash router (`/#/chats/<id>`): the server never sees the page, so it cannot 404 a wrong one, and the
  fragment is then not free to name a message.
- Rejected: query parameters (`/?view=feed&chat=<id>`): the old shape, whose writes from the background are the bug.
- Rejected: a second copy of the patterns in the page script: the script is a string the suite runs as shipped, and
  two copies drift; the fallback, if one module stops serving, is a generated `pages.json`.
- Rejected for the message's position: `?at=<mid>`, which the server would see and ignore.

## Consequences

A new page is one row in `PAGES` and a drawing in the router; `test/workers/f4-pages.test.ts` fails if a row overlaps
an API route. `/` is replaced by the last chat's address, never pushed, so one back leaves the app. F5, F6 and F7 add
their addresses as rows here.
