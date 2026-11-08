---
id: D-0027
title: Shopping and bookings on fletch are find, compare, cite and hand over: the agent purchases or books nothing in any vertical, and no merchant or travel provider API goes on the egress allowlist, until Kyle picks purchase for a vertical
status: accepted
door: one-way
decided: 2026-11-08
decider: Kyle
confirmation: review
review-by: 2026-12-31
revisit-when: Kyle picks purchase for a vertical (design O5), rules on D-0017, or wants a read-only provider search API for one vertical
---
Accepted on Kyle's one-hour ruling of 2026-11-08 ("answer all of these with defaults and best effort to unblock, then continue work for the next hour in as much fan-out and parallel work as possible; no blockers, just move; we can always go back later and reconcile"); reconcile at his next check-in: a line under `## Steering` in `docs/plan-v2/WAITING-ON-KYLE.md` reverses it and the record goes back to `proposed`. Confirmation to come: the contract check test the Translate part F80 adds names this record; until it exists the record is held by `review` with its review-by date.

Ruling: in every vertical P16 names (shopping, flights, hotels, event tickets, restaurants, groceries, ground transport)
fletch's agent researches read-only, compares and cites what it read, and on the person's word hands over the live page
where the person commits and pays themselves; it purchases, books, holds or carts nothing, refuses a request to do so by
name with the live page offered, and no merchant or travel provider API (Duffel, Ticketmaster Discovery, a product
catalog, Shopify UCP, Expedia) joins `PUBLIC_HOSTS` or a connector manifest, research going through the browse lane
alone — because both are one-way doors the Defaults let the orchestrator propose and not take (a purchase is
irreversible spend at a third party under D-0017, which is itself only proposed; a provider API is a new egress
crossing for a value, with keys and terms, and two of them exist to commit), and the interrogation found every seller
refusing dates a year out, so Muse's own offer and checkout shapes are unmeasured — if wrong, the record is rejected,
the vertical Kyle picks for purchase gets its provider path, its egress entry and a `commerce` `HostFeature`
(`HOST_COMMERCE_UNAVAILABLE`, D-0001) proposed then, and P16 stays at level 0 with no code to remove.

## Context

The P16 interrogation of 2026-11-08 (`docs/plan-v2/contracts/P16-shopping-bookings.md`: 13 clauses, 12 tasks, 5 two-way
deltas, two one-way doors) found that Muse's shopping is a research widget and a hand-over, that its commitments run
through connectors and a wallet provider fletch does not have, that the owner's own memory line already makes tickets
flag-only, and that Duffel, Google Flights, a hotel picker and Ticketmaster all refused dates a year out, so no flight,
hotel or ticket offer card was drawn. The record's two doors, in the contract's order: (a) per vertical, purchase or
flag-only (design O5); (b) provider APIs on the egress allowlist. Written by the orchestrator in Kyle's absence
(`docs/plan-v2/ORCHESTRATOR-OVERNIGHT.md`, Queue 9) so the doors sit on the index with a review date; nothing is built
on it. Three further questions Kyle alone answers are in Q43: whether the agent remembers a booking the person reports,
whether the flag-only ticket rule extends to other verticals, and whether Muse is re-interrogated with dates inside
the sale window.

## Alternatives rejected

- Build the tier-1 refusal (T-P16-07) and the hand-over tasks now under D-0001 and D-0017: D-0017 is proposed, not
  accepted, so a refusal that rests on it is a door, not a check.
- Put one read-only search API (Duffel offers, Ticketmaster Discovery) on the allowlist for better coverage: a key, a
  terms of service and a new crossing for names and dates, which is door (b) itself.
