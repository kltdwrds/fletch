---
id: D-0017
title: fletch holds no payment instrument and submits no payment; the person pays in a live page they take over
status: proposed
door: one-way
decided: 2026-10-30
decider: agent
confirmation: review
review-by: 2026-12-31
revisit-when: the first owner asks the agent to pay for something it cannot hand over, or a connector fletch wants (a direct checkout, a booking API) can only complete with a payment method the agent holds
---
Ruling: the agent keeps no payment instrument of any shape (no card number, expiry or code, no provider customer or
method id, no network token) and never submits a payment; a purchase is proposed to the person's card and, when
allowed once, the agent hands the live page over (`browse_handoff`) and the person pays there with their own method;
a purchase the agent cannot hand over is refused in words, and a card typed in chat is held as a `typed` secret and
expires unused (P12 delta 1) — because Muse's own wallet is a provider's (Link or Shop Pay: a one-time virtual card
funded after the person approves on the runtime's payment sheet, state in the provider's service), the P12 contract
(`docs/plan-v2/contracts/P12-wallet.md`) finds every money-moving step either outside the agent or behind that
provider, and holding an instrument on a self-hosted Worker is a security boundary and a storage schema (PCI scope,
a `card` Vault kind, a spend table outside the content-free journal) while submitting a payment spends money — if
wrong, the one path is a wallet provider's one-time card: a provider host in egress with its placement, a connect
page the person completes, an opaque method id the model never sees, a `payments` `HostFeature` so a deploy without
the provider refuses `HOST_PAYMENTS_UNAVAILABLE` (D-0001), an opt-in binding (D-0004), and a spend table of its own;
never a stored card number.

## Context

The parity design leaves "how payment goes through Cloudflare" open (O5: wallet and payments are spine, P12). The
interrogation of Muse (`docs/plan-v2/evidence/p12-wallet/answers/step-1.md` to `step-7.md`) found both providers
`not_connected`, five read-only `wallet.*` tools whose descriptions say the namespace "does not add, select, charge, or
approve a payment method", card entry only on the provider's page, the person's one approval on a runtime-drawn
payment sheet, no standing allowance, and spend state in three runtime tables that held no row. fletch today has no
instrument kind, no production tool with `purchase: true`, a grants engine that never lets a purchase run under a
lasting grant, a job runner and a sub-agent gate that refuse every action, and a browse handoff in which the person
pays. The two agree on everything but reach: Muse can complete a checkout with a provider's card; fletch cannot.

## Options

- **This record**: no instrument, no submission; the person pays in the handed-over page. Nothing to leak, nothing
  to refund, no PCI scope; the agent prepares and the person pays. F38 and F39 need nothing more.
- **A provider's one-time card** (Muse's model): a connect flow on the provider's page, an opaque method id, a
  checkout the agent submits after the card's `once`. Spends money under the person's approval; adds a provider
  boundary (host, webhook or return route), a `payments` feature in the published `@qyvr/host`, a spend table and an
  opt-in binding. Rejected for now: no owner has asked, and the self-hosted deploy has no provider account.
- **A stored instrument** (a `card` Vault kind holding a PAN): rejected outright; it puts every owner's card inside a
  Worker's storage and under PCI scope for a self-host, against `VISION.md`'s one-owner, own-account shape.

## Consequences

Accepted: P12's clauses are graded on the refusal and the handoff (T-P12-07, T-P12-10, T-P12-11, T-P12-13); no Wallet
pane is drawn; P16's checkout connectors are flag-only until this record is revisited. Rejected (the provider path):
a part under P12 after the spine with its own contract clauses (the connect page the person completes, the method id
never shown, the checkout submitted only under a card's `once` with `max_amount`, the decline and the
re-authentication as events, the spend table), a `payments` `HostFeature`, and tests that plant a stored card number
and a submission without a grant.
