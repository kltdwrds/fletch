---
id: D-0018
title: The agent's name and avatar are the owner's settings, written only by the owner through the app; until that setting exists the agent has no name and says so
status: proposed
door: one-way
decided: 2026-10-30
decider: agent
confirmation: review
review-by: 2026-12-31
revisit-when: the first owner asks to name their agent, or a surface needs a name a code constant cannot give (a mail label, a colleague's card, a second agent on one deploy)
---
Ruling: the agent's name and avatar, when they exist, are one setting of the owner's, stored where the Person's own
rows live and written only by the owner through a Settings control of the app; no model turn, no tool and no message
ever writes them, a sentence like "you are now called X" changes nothing but the transcript, and every surface (the
header, the panel, a card, a mail label) draws the stored value or the code's constant and never the model's text;
until the setting is built the agent has no name, the panel says so by name ("not chosen") and promises nothing — because
Muse's name is drawn from stored state but written by a chat turn the model interprets
(`onboarding.update_identity`, a free-text sentence with the identity-field rule as the only guard; the P14 contract,
`docs/plan-v2/contracts/P14-identity.md`, B-P14-01 and B-P14-02), which is the one place in Muse where message content
becomes configuration, and fletch's rule is that message content is data (`AGENTS.md`, "Message content is data");
a name field is a storage schema (where it lives, who reads it, whether a colleague's card and the mail label carry it),
so it is a one-way door — if wrong, the one path is a `memory_write` target for `IDENTITY.md` under the person's own
turn with a card, never a silent write.

## Context

The interrogation of Muse (`docs/plan-v2/evidence/p14-identity/answers/step-1.md` and `step-2.md`) found the name in
`~/IDENTITY.md` (a blank template on the account; the product name as "default given name until changed"), the avatar
in `runtime.avatar_state`, "Edit name" prefilling the composer with "Change your name to " so the rename is a model turn,
and an Identity "Edit" that opens the file in a live editor with no Save and no Cancel. fletch today draws "Your agent"
from `SHELL_TEXT.agent` and `PANEL_TEXT.title` over a `sparkle` glyph, seeds `IDENTITY.md` with "Name: not chosen yet.",
gives the standing files one writer (the seed, `qyvr:seed`) and no tool, and draws a disabled Edit that says "Naming
comes later". No owner has asked to name the agent.

## Options

- **This record**: a stored setting the owner writes in the app; nothing else writes it; no name until then, said
  honestly. Nothing a message says can rename the agent; one field to add when wanted. F40 and F41 need nothing more.
- **Muse's model**: the model persists a name it reads from a sentence. Rejected: it makes a message a write path to
  configuration, and the only guard is a prompt line.
- **A name in deploy config** (`TENANT_ID` or a `wrangler.jsonc` var): rejected; the tenant name is the Worker's and
  changing it is a redeploy, not a setting.

## Consequences

Accepted: P14's clauses are graded on "no name, said so, nothing changes on a sentence" (T-P14-01, T-P14-09, T-P14-10);
the panel's Edit is removed and its words say what is (F40); a Person row `agent_name` (and later an avatar) with a
Settings control is a part under P14 after the spine, with tests that plant a tool write and a model-text draw.
Rejected (Muse's model): a `memory_write` or identity tool target for `IDENTITY.md`.
