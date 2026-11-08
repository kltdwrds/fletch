---
id: D-0028
title: Web search, places and image generation are capabilities the owner connects, each refused by a HostFeature code until it is
status: proposed
door: one-way
decided: 2026-11-08
decider: agent
confirmation: review
review-by: 2026-12-31
revisit-when: Kyle rules on this record, picks a search or places provider, or wants image generation off the AI binding
---
Ruling: fletch's agent gains web search and places only through a provider API the owner keys with their own
credential (P9's path: the key captured on the agent's own form, held in the Vault, bound to the provider's host and
used only at egress), and image generation only through Workers AI on the deploy's existing `AI` binding, writing one
file into the person's store with its cost in the Ledger; until each is connected it is refused by name, with
`search`, `places` and `imagegen` added to `@qyvr/host`'s `HostFeature` (`HOST_SEARCH_UNAVAILABLE`,
`HOST_PLACES_UNAVAILABLE`, `HOST_IMAGEGEN_UNAVAILABLE`, D-0001) — because each is a one-way door the Translate stage
may propose and not take (a provider is a new egress crossing for the person's queries under a third party's terms,
image generation spends money per call, and a `HostFeature` is a published package's contract), and Muse answers a
changing fact by searching first (`docs/plan-v2/contracts/P10-search-browser-media.md`, B-P10-01) where fletch today
can only say it cannot — if wrong, the record is rejected, P10's refusals stay instruction lines with no code, and
the contract's capability clauses (B-P10-01, 11, 12, 13, 14) keep grading the refusal alone.

## Context

The P10 interrogation of 2026-11-01 (S-P10-01, 13 steps) found Muse's `browser.search` with five verticals, a places
search drawn as a map, `media.generate_image` kept in the Library, a video found through search, and `social.search`
over three Meta platforms. fletch has a page read lane, a live browser, a hand-over and kept sign-ins (M9, M24.3) and
none of the rest; `STATUS_WORDS` even names a `web_search` tool that does not exist. The contract's delta 1 makes the
refusal a plain-words instruction line now (two-way, F91); this record holds the capability and the codes. Written by
the P10 Translate agent under Kyle's one-hour ruling of 2026-11-08 (defaults, best effort, reconcile later); nothing
in F90 to F92 builds on it.

## Options

- **Recommended (above):** owner-keyed providers for search and places, Workers AI for images, three `HostFeature`s.
- Rejected: a platform-held search key (Kyle's money and one key's quota across every owner, and the queries of
  every owner through one account).
- Rejected: scraping a search engine's results page through Browser Run (its terms, its bot walls, and the contract's
  B-P10-10 stop on a wall).
- Rejected: one `HostFeature` named `media` for image, video and audio (P13's speech record, D-0026, owns audio; video
  generation is not in scope).
- Rejected: no capability at all, refusal in words forever (Muse's first move for a changing fact is a search; the
  gap is the cluster's largest).

## Consequences

Accepted, a part adds the three features to `packages/host/src/host.ts` with a changeset, the search and places
connector manifests with their bound hosts, the image tool writing into the person's files, and a test that plants
each refusal on the production path; P10 is re-interrogated for the capability form of its clauses. Rejected, nothing
is removed: no code rests on this record.
