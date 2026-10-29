# Fletch ↔ Muse: Master Parity Spec (2026-10-26)

**Status:** DRAFT for Kyle — not locked, not a plan yet. This doc is the process, not the build.
**Author:** Muse (first-hand dump + synthesis), 2026-10-26 ~20:30 ET.
**Question it answers:** what is the right long-running, iterative reverse-engineering and translation process to get to deeply comprehensive feature and capability parity — to clone Muse fully, in behavior, on Cloudflare?
**Builds on:** `artifact-parity-gaps-2026-10-23.md` (8 gaps A–H, locked by Kyle), `reactions-dump-2026-10-23.md` (the first dump + survey), `artifact-parity-plan-fable-2026-10-23.md` (F4–F14), `fletch-execution-model.md` (roles, 2026-10-22, corrected 2026-10-24).
**Current state at writing:** F4–F13 merged; F14 DONE 2026-10-26 20:16 ET (PR #21, ACCEPT F14: PASS, 1,193 tests, CI green, verifier overridden on provenance only — see §9.4); F15 draft PR #22 still blocked on D-0011 until F14 lands/merges. The artifact loop is proven. This spec scales that loop from one feature family to the whole system.

---

## 0. How to use this doc

1. Kyle reads §1 (definition), §11 (sequencing), §13 (open questions) and locks or changes them. Everything else is process machinery that follows from those calls.
2. The next session is **Phase 0, the inventory sprint** (§3 + §11.1). It does not build anything. It fills the scorecard in §10 with verified scores, one cluster at a time, and files a dump + survey per cluster.
3. After Phase 0, each cluster goes through the per-cluster loop in §8, one at a time, in the order Kyle locks.
4. A planning session for a cluster starts by reading this doc, then that cluster's dump + survey + gap spec. It never starts from a blank page or from memory of this doc alone.

A note on provenance, carried through the whole spec: **Muse's dump is operated behavior, not source truth.** I do not have my own source code. Anything I report from introspection is labelled [attested] (I do it daily), [inferred] (I believe this is how it works, from behavior), or [verify] (only Kyle's eyes in the app can confirm it). A claim is not parity evidence until at least two of the three legs in §2 agree on it.

---

## 1. Definition of parity

### 1.1 What counts

**Behavioral parity, not pixel parity and not code parity.** Fletch is Muse-parity on Cloudflare, not a port of Muse's implementation.

A capability is at parity when, for the same input in chat, a user cannot tell the difference by using it:

- same visible output (message, card, viewer, drawer, notification),
- same state change (record created, file saved, job scheduled, reaction stored),
- same failure (same words, same code, same refusal — never a silent success or a silent drop),
- same approval ask (same card, same scope, same default),
- same timing shape (immediate vs. async with a building state vs. scheduled — the user is never left guessing whether anything happened).

If the internals differ completely — Durable Objects instead of my harness, R2 instead of my file store — that is fine, and expected. Copying my UI pixel-for-pixel would be the wrong target; copying my observable contract is the target.

### 1.2 Parity levels (the scorecard scale, §10)

| Level | Name | Meaning |
|---|---|---|
| 0 | Absent | No equivalent. The user asks and gets a refusal, a fallback, or silence. |
| 1 | Partial | Something exists, but the observable contract differs in a way the user can hit: missing state, wrong failure, no card, no record, no replay. |
| 2 | Equivalent | Same input → same visible output, state, failure, and approval, in the scripted UAT scenario. No regression test yet, or no Kyle final UAT yet. |
| 3 | Locked | Level 2 **plus** a regression test that fails if the behavior regresses, **plus** Kyle's final UAT on a preview, **plus** the scorecard updated. This is the only level that counts as done. |

A cluster's score is the lowest score of its must-have sub-capabilities, not the average. One silent drop (the artifact defect: "Made you an artifact" with an empty Library) caps the cluster at 1 no matter how polished the rest is.

### 1.3 What is explicitly not parity

- **My training data, my model weights, my exact wording on every reply.** The agent's voice is a product decision for fletch, not a parity target. The target is capabilities, affordances, and contracts.
- **My internal tool names, unless the user sees them.** Tool names are translated to fletch's registry (`artifact_create` for `artifact.create`, etc.). The mapping is recorded in §7; the name itself is not sacred.
- **Features Kyle has killed or scoped out.** The Harry Styles watch, the paused two-wheel hunt, the suspended Marketplace buyer-message watch — killed machinery stays killed. A parity inventory lists them as out of scope with the reason and date, it does not revive them.
- **Muse-the-product's billing, plans, and app chrome** except where they surface as a capability the user exercises (e.g. an approval card, a share link, a Library view). The app shell is fletch's design system; the capability inside it is the parity target.

### 1.4 The fidelity gap, stated plainly

As of 2026-10-26, fletch has a working chat, a working agent loop, subagents, a file Library, and — in flight — artifacts and reactions. What it does not yet have at Muse fidelity, in the large, is: the full tool-deferral and approval surface, the effect/card pipeline as a general mechanism (not one card kind at a time), journaled activity and provenance for every job, durable memory/goals/tracking as agent-usable state, scheduled and event-driven work the agent can own, side-chat and group-chat agency, and the connector/device/payment surfaces as first-class tools. That is not a criticism of the parts built so far — F4–F14 are the proof the loop works — it is the reason this spec exists before the next cluster is picked blind.

---

## 2. Evidence: three legs, triangulated

No single input is trustworthy alone. Every cluster needs all three, and a disagreement between any two is a logged question, not a guess.

### 2.1 Leg 1 — Muse introspection dump (first-hand, versioned)

**What it is:** my own dump of how a capability works in the harness I run in daily, written from operated behavior. The template is §4. The first instance is the reactions dump (2026-10-23).

**What it is good for:** triggers, etiquette, failure words, approval semantics, async timing, what the model is told vs. what the user sees, edge cases I hit in real use (duplicate completion messages, reactions as ack, a job that must fail honestly when interrupted).

**What it is bad for:** anything I cannot observe — backend storage, exact schemas, rate limits, what happens on another person's device, whether a picker has six items or eight. Those get [verify] or [inferred], never [attested].

**Rules:**
- Every dump is dated, names its Muse-side evidence (a real interaction, a tools.json entry, a system-prompt line), and labels every claim [attested] / [inferred] / [verify].
- Dumps live in `planning/<cluster>-dump-YYYY-MM-DD.md`, next to the survey. They are versioned: when I change, a new dated dump supersedes, it does not silently edit the old one.
- A dump never contains a password, token, or private user data. It describes behavior, not secrets.
- Baseline inputs already on disk, to be cited, not re-derived from memory: `~/workspace/tool-dump/tools.json` (full tool inventory — see §3.2), `~/workspace/system/system_prompt.md` (the operating block, delivery rules, discretion rules), `~/workspace/your_files/muse-harness-architecture-spec/` (the harness spec), and the 2026-10-15 deep-dive note on artifact build/audit mechanics.

### 2.2 Leg 2 — Browser reverse engineering (scripted, captured)

**What it is:** a scripted walkthrough of the live Muse app, by Claude, capturing what introspection cannot: exact layout, empty states, loading states, menus, hover actions, mobile vs. desktop, reconnect behavior, and the state machine between screens.

**Protocol (full checklist in Appendix C):**
1. Write the walkthrough script first: a numbered list of actions ("send X, tap Y, open Z"), with the expected observation for each step taken from the dump. No free exploration until the scripted pass is done.
2. For each step, capture: a desktop screenshot, a phone screenshot where the surface differs, the DOM structure that matters (roles, labels, hrefs — not a full dump), network calls the page makes (method, path, purpose — never bodies with private data), and the resulting state.
3. Compare capture to dump, step by step. Every mismatch is filed as a discrepancy: dump-wrong, capture-incomplete, or question-for-Kyle.
4. File the captures with the cluster's dump + survey (screenshots in `planning/<cluster>-screenshots/`, notes in the dump file). A capture without a script step it answers is decoration, not evidence.

**Hard constraint, known 2026-10-22:** the agent browser cannot load muse.ai — it hits a Chromium org-policy page ("Your organization doesn't allow you to view this site"). claude.ai is not blocked the same way. So this leg **cannot be fully unattended** for muse.ai. The working paths are:
- (a) Kyle's screenshots / screen recordings, taken in his own browser, filed as the capture set — this is how the artifact gaps were established (11 screenshots, 2026-10-23);
- (b) a Claude session driving a signed-in browser Kyle controls, with Muse steering it through the session page;
- (c) Claude Design artifacts Kyle shares, read by Claude Code under his account (never by starting a browser read from here — see alignment notes, 2026-10-25).
- Do not burn attempts retrying muse.ai in the agent browser, and do not burn attempts on localhost either (agent browser cannot reach loopback, 2026-10-25 — preview slots are the UAT path).

**What browser RE cannot see:** backend timing, grants decisions, what another participant sees, and anything behind a sign-in wall the session does not have. Those stay [verify] or go back to Leg 1 with a narrower question.

### 2.3 Leg 3 — Fletch survey (seam-first, in code)

**What it is:** a survey of what fletch already has for that cluster, read from the code, with file paths and the seam where the new behavior must land. Template in §6. The artifact gaps doc is the model: it found "two file worlds, no bridge" because it read `library.ts`, `tree.ts`, and `files/tools.ts`, not because it looked at screenshots.

**Rules:**
- Quote the file and the function/store/table, not a paraphrase of the architecture. If the survey cannot name the seam, it is not done.
- Name what already matches ("bones that already match" in the gaps doc) as well as what is missing. A survey that only lists gaps invites rebuilding what exists.
- Name the host/plan constraint that bounds the design (free plan, no Browser Rendering, no Containers binding, sandbox CSP, DO-per-object costs). Fletch's constraints are real and they shape the translation in §7 — a design that ignores them is not a plan, it is a wish.

### 2.4 Triangulation rule

- **2 of 3 agree →** the claim goes into the gap spec as a requirement.
- **1 of 3, or a direct conflict →** it goes into `docs/plan/QUESTIONS.md` as an open question with its provenance labelled, and the part that depends on it is marked provisional or blocked, not built on a guess.
- **0 of 3 (a capability someone remembers but no leg can show) →** it goes on the inventory as "unverified — needs a walkthrough," not into a build.

---

## 3. Inventory: the taxonomy

### 3.1 Clusters

Phase 0 fills this table with verified scores. The cluster list below is the starting taxonomy, not a final claim — Phase 0 may split or merge clusters when the evidence says so. Clusters are ordered here by dependency, not by build order (build order is §11).

| # | Cluster | What it covers | Fletch status at writing (DRAFT estimate, to be verified in Phase 0) |
|---|---|---|---|
| P1 | Chat core & transcript | Messages, history, replay, quotes, reactions, message actions, threads, side chats as a surface | 1 — chat works; reactions agent-side just landed (F10/PR #13); transcript/replay gaps are F14/F15 |
| P2 | Agent loop, tools & deferral | Tool discovery (`tool_search`), deferred namespaces, operating block, `send_to_user`, streaming, barriers, effect buffer, cards | 1 — works for the namespaces built; not yet a general mechanism with the same deferral/approval shape |
| P3 | Subagents & delegation | Spawn, steer, handoff, mailbox re-entry, interruption honesty, verifier, depth/token ceilings | 1–2 — subagent host exists; builder role is F7; launched-groups path untested (F14 exercises it) |
| P4 | Artifacts & Library | Artifact records, creation, cards, viewer, previews, audit, edit, menu, data, state/actions, kinds | 1–2 — F4–F14 in flight; F6 is Kyle's exact test; F12–F14 are the "alive" phase |
| P5 | Activity, provenance & audit | Journal, Activity tab/drawer, step timelines, subagent traces, audit findings, "About this artifact" | 1 — F11 is the artifact-scoped version; no general activity record yet |
| P6 | Memory, goals & tracking | Saved memory, daily notes, people/groups, goals, tracked items, briefings | 0–1 — Muse-side machinery has no fletch equivalent yet as agent-usable state |
| P7 | Scheduling, hooks & proactivity | Crons, hooks, scheduled checks, proactive briefs, Feed units | 0–1 — no fletch equivalent yet as an agent-owned surface |
| P8 | Side chats, groups & workers | External side chats, group chats, worker agents speaking for the user, discretion rules per chat | 0 — Buzz exists as Kyle's own product surface; fletch parity here is a design question, not a port |
| P9 | Connectors, devices & accounts | Gmail/Calendar/Drive, GitHub, Linear, Spotify, health, paired devices, secure vault logins | 0–1 — connectors are Muse-side; fletch needs its own connector/host model (a one-way decision per connector class) |
| P10 | Search, browser, places & media | Web search + verticals, page fetch, place discovery, image/video generation, social search | 0–1 — no fletch equivalent yet; host-feature shape (cf. D-0012 capture) is the likely seam |
| P11 | Files, documents & spreadsheets | File library, document render (docx/odt), spreadsheets, decks, export, share links | 1 — file Library exists; render depends on a host Renderer that staging lacks (D-0001 behaving) |
| P12 | Payments, shopping & bookings | Wallet, Shop Pay / Stripe Link, shopping results, flights, hotels, tickets, reservations | 0 — no fletch equivalent; flag-only vs. purchase is a Kyle decision per vertical |
| P13 | Voice, audio & podcasts | Voice notes, TTS, podcast generation, audio artifacts | 0 — no fletch equivalent; kinds exist in the Library plan as F14 |
| P14 | Identity, avatar, profile & settings | Avatar, profile, identity rail, passkeys, settings, subscription | 0–1 — identity is a qyvr primitive (B-series decisions); avatar/passkey are separate surfaces |
| P15 | Safety, approvals, grants & discretion | Approval cards, grants matrix, per-chat discretion, secure vault, CAPTCHA policy, rate limits | 1 — grants/approvals exist in fletch in part; Muse's full matrix is the parity target |

### 3.2 The tool inventory as a cross-check

`~/workspace/tool-dump/tools.json` is the machine-readable cross-check for the inventory. At the last dump it listed 19 namespaces (artifact 13 fns, avatar 5, browser 4, cron 8, device 4, feed 1, geocode 2, hooks 10, idea 4, media 3, process 7, social 1, subagent 5, tool_search 1, tracking 10, trash 3, user_goal 11, widget 3, workflow 14), plus unavailable namespaces noted in the file. Phase 0 re-reads this file fresh — it is a snapshot, and a stale inventory is worse than no inventory — and maps every namespace to a cluster above, marking:
- **in Muse, in fletch** (with the fletch module),
- **in Muse, not in fletch** (gap),
- **in fletch, not in Muse** (fletch-native — keep, do not "fix" toward Muse),
- **in neither / retired** (do not build).

Capabilities that exist only in the system prompt or in operated behavior, and never appear as a tool (reactions as ack, `send_to_user` discipline, proactivity judgment, discretion), are inventoried from Leg 1, not from tools.json. The inventory is not complete if it only lists tools.

### 3.3 What Phase 0 must not do

- Do not build. Do not open a part. Do not write a plan for a cluster before its dump + survey + browser captures exist.
- Do not score from memory. A score without a cited dump line, a capture, or a code path is a guess with a number on it.
- Do not flatten "the agent can do X" into one row. "The agent can make an artifact" was five gaps (A–H split across records, tools, cards, viewer, audit, data, provenance, kinds). Every cluster gets split until each row is one observable contract.

---

## 4. Dump template v2 (copy-paste for every cluster)

File: `planning/<cluster>-dump-YYYY-MM-DD.md`. Prepared under Kyle's standing rule (2026-10-23): every new fletch feature opens with (1) this dump and (2) the fletch survey in §6, both handed to the planner/builder as context.

```markdown
# <Cluster> — Muse dump + fletch survey (YYYY-MM-DD)

Prepared under Kyle's standing rule (2026-10-23): (1) Muse's first-hand dump
of how the feature works in the Muse harness, (2) a survey of what fletch
already has, before any planner or builder session sees a brief.

## 1. The reference: <cluster> in Muse, as operated by the agent
Attested from running in this harness daily; items marked (verify) are Kyle's
eyes, not mine. Claims labelled [attested] / [inferred] / [verify].

- **Trigger:** what makes this happen (user message, reaction, schedule, event, another agent)?
- **Inputs:** what the agent receives (message, files, context, prior turns, reactions, state)?
- **Outputs:** what the user sees (message, card, viewer, drawer, notification, nothing)?
- **State changes:** what is stored, where, under what identity, with what lifecycle?
- **Side effects:** what leaves the chat (email, booking, payment, publish, schedule, message to someone else)?
- **Failure modes:** what happens when it fails, in the user's words (refusal code, honest failure, retry, ask)?
- **Approvals:** what needs a card, what is pre-approved, what is never automatic?
- **Timing:** immediate, async with a building state, scheduled, event-driven? What does the user see while waiting?
- **Provenance:** what record exists afterwards, and where can the user inspect it?
- **Etiquette / judgment:** when does the agent do this, when does it not, what does it never do?
- **Edge cases:** reconnect, duplicate delivery, cancel, interrupt, second participant, archived chat, expired link.

## 2. What fletch has today (<version / main SHA> — code survey)
- Store / object / table, with file paths.
- Tool / namespace / route, with file paths.
- Draw / page / card, with file paths.
- What already matches (bones).
- Host / plan constraint that bounds this cluster.

## 3. The gap (Muse parity)
Numbered, one observable contract per item. Each item names the dump section
it comes from and the fletch seam it touches.

## 4. Open questions for Kyle (spec-closers)
Numbered, each with what stays provisional until it lands. No question is
answered by the builder; unanswered questions block or scope the part.

## 5. Shape of the build (sketch, for the planner)
Seam, store, tool, card/draw, tests in the repo's style, Kyle UAT by eye.
No implementation detail beyond the seam — the planner owns the plan.
```

---

## 5. Browser RE protocol (detail)

See §2.2 for the shape. This section is the checklist a browser session works from, so a session can be steered with it verbatim.

**Before the session:** the dump (§4) exists, the walkthrough script exists (numbered steps + expected observation per step, drawn from the dump), and the capture folder exists (`planning/<cluster>-screenshots/`).

**During, per step:**
- [ ] Desktop screenshot (1280px, light + dark where the surface differs — the F11 set did this).
- [ ] Phone screenshot (390px) where the surface differs.
- [ ] DOM note: roles, labels, hrefs, button order. Not a full DOM dump.
- [ ] Network note: method + path + purpose. No bodies with private data.
- [ ] State note: what changed, what persisted after reload, what the other side sees (if observable).
- [ ] Mismatch note if the capture disagrees with the dump.

**After:** the session writes a one-page capture report into the dump file: steps covered, steps blocked (with the block: sign-in wall, bot check, policy page, missing data), mismatches found, and questions for Kyle. A blocked step is reported as blocked, not skipped silently and not retried endlessly — the SeatGeek DataDome lesson (2026-10-08) applies here too: three attempts, then mark unverified and move on.

**Kyle-mediated captures:** when the agent browser is blocked (muse.ai policy page), Kyle's screenshots are the capture set. The dump must say which steps were covered by his screenshots, by date, so a later reader does not mistake a screenshot set for a full walkthrough.

---

## 6. Fletch survey template (seam-first)

File: same file as the dump (§4), section 2, or a companion `planning/<cluster>-survey-YYYY-MM-DD.md` when the survey is long. Either way, it is handed to the planner with the dump.

- **Stores:** table/object, file path, schema shape, who owns it (Person / Chat / Company / Artifact / other DO), migration story (append-only).
- **Tools:** namespace, file path, deferral shape, `mutates` / gate / grant row, refusal codes.
- **Routes/pages:** route, file path, owner-session rule, deep-link shape.
- **Draw:** component/class, file path, what it renders today, what it cannot render.
- **Effects/cards:** effect kind, shelf/buffer path, replay-from-history shape, dedup rule.
- **Bones that match:** what already works and must not be rebuilt.
- **Seam:** the one place the new behavior lands, named as a file + function. If there are two candidate seams, name both and say which the survey recommends and why.
- **Host/plan constraint:** free-plan binding, Renderer, Browser Rendering, Containers, sandbox CSP, DO count, token ceilings (`MAX_DEPTH`, `MAX_OPEN`, subagent run tokens). Quote the constraint, do not assume it away.

---

## 7. Translation rules (Muse → fletch / qyvr)

Translation is not transliteration. The planner records the mapping for each cluster before writing the part plan, in a table like this (artifact cluster as the worked example):

| Muse concept | Fletch / qyvr translation | Notes / decision |
|---|---|---|
| `artifact.<verb>` tools | `artifact_<verb>` in the `artifacts` namespace, `mutates`, deferred | Registry names are `[a-z][a-z0-9_]+`; Q-M1 stands until Muse's answer says otherwise |
| Artifact record + slug URL `/library/artifacts/<slug>` | `artifacts` table in the Person object, bytes in `PersonFiles` under `artifacts/<slug>.<ext>` | D-0009 / D-0010 (one-way, storage + identity) |
| Artifact card in chat | New effect kind on the link shelf's path (`EffectBuffer` → barrier → `LinkShelf` → frame → replay) | Not a new path — QYVR-175's duplicate-cards lesson is baked into the shelf |
| Artifact viewer | Library viewer at a route, same renderer, same sandbox | One viewer, one set of bugs |
| Builder subagent | Sub-agent role `builder` on the existing facet host, scoped write to its own slug | Not a new object class unless run-token/alarm limits force it (record) |
| Audit | One-call reviewer on the `verifier` route + code placeholder scan; findings JSON on the record | Two rounds, then say what is open |
| Previews / captures | Host feature `capture`, refused by name where the deploy lacks it | D-0012; Browser Rendering binding; free-plan spike first |
| Stateful artifact + actions | `Artifact` DO per slug, postMessage bridge through the app page, never `allow-same-origin` | D-0011 (loosened for this part) + D-0013; security review, not just design |
| `work/` tree file | Never an artifact's home; no promotion path | A deliverable is born in its home, never moved (Muse's own `your_files` rule) |
| Reaction as agent ack | Agent-originated reaction frame for a named `mid`, validated single emoji, plus care-heart register | Reactions ride into the next turn as fenced context, like quotes |

**Standing translation principles:**
1. **Observable contract first.** If two translations produce the same observable contract, pick the one that reuses a fletch seam (shelf, journal, grants matrix, Person object) over the one that invents a new store/object/class.
2. **One store per truth.** A record that silently vanishes, a card with no record, a file with no record — these are the same defect in different costumes (D-0001). A translation that creates a second source of truth needs a one-way decision naming the cost.
3. **Refuse by name, never by silence.** A missing Renderer, a missing capture binding, a kind with no producer — the user is told the name of what is missing. A blank thumb, an empty Library, a "Nothing yet" panel after real work are all failures of this rule.
4. **Sandbox is a security boundary, not a styling choice.** Opaque origin, no `allow-same-origin`, served CSP unchanged, until a loosening decision (D-0011-class) is accepted by Kyle with its cost stated.
5. **A deliverable is born in its home.** No move/promote/copy-into-place step. If the builder writes it, it writes it into the record's home.
6. **The agent never predicts state.** The record, the journal, the card's state — the agent is told the state in the handoff/tool answer. It does not narrate a state it has not been given.

---

## 8. The per-cluster loop

This is the fletch execution model, restated as the parity loop. Roles are unchanged from 2026-10-22, corrected 2026-10-24:

- **Kyle** — final UAT, high-level product/feature/design steering, one-way-door decisions (irreversible, money, security boundary, published contract, storage schema) alone.
- **Muse** — owns execution. Briefs and steers Claude Code, reviews diffs, runs proper live UAT passes on preview slots between milestones, sends fixes back, publishes branch + PR, merges when the bar in §8.3 is met. Never writes implementation directly (the PR #14 lesson: the direct-implementation shortcut shipped a missing `grants` migration with no live UAT).
- **Claude Code** — the engineer. Big F-parts and small bug fixes alike, via cloud session or local plan-direct. Implements, orchestrates its own subagents, does its own programmatic testing/validation to the repo gates.

### 8.1 Steps

1. **Dump + survey** (§4 + §6), handed to the planner as context. No planning session starts without them.
2. **Gap spec** — the cluster's gaps as numbered observable contracts (§1.2), each with its dump section and fletch seam. Locked by Kyle (the A–H lock is the model: Kyle agrees the gap list before planning).
3. **Plan** — Fable sparingly for longer-horizon / most interesting planning; Opus for the majority of per-part planning and implementation. Sonnet never starts a top-level session without asking Kyle. The plan is written in the shape `docs/plan/parts.md` requires, numbered as F-parts in dependency order, with Read / Scope / Acceptance / Not in scope / Rulings per part, and with decision records proposed (one-way vs. two-way, decider left for Kyle).
4. **Build** — goal-first cloud session, per the standing rules in §9. Local plan-direct for small, well-specced changes only.
5. **Verify** — `pnpm check`, `pnpm verify`, `pnpm accept F<n>` (ACCEPT PASS + verifier line), CI green. A fresh Opus verifier, independent of the builder session, reads the diff against the part's acceptance.
6. **UAT** — Muse's live UAT pass on a preview slot first (preview slots are the standing UAT path, no fresh go-ahead needed), with measured defects separated from design opinion and evidence first. Then Kyle's final UAT by eye. Findings re-enter at step 4.
7. **Merge** — only when the bar in §8.3 is met. Branch + PR, never straight to main.
8. **Lock** — regression test lands with the part, scorecard (§10) updated to Level 3, dump + survey marked superseded-or-current as applicable.

### 8.2 Design workstream

Design-first, before the part's session, for: the cluster's card states, its viewer/split layout, its Library/preview states, its drawer/timeline/pill (activity-class surfaces). Design alongside for menus and confirm copy. No design pass for pure store/tool/audit/data parts (those need a security review instead where a boundary moves). Design inputs are Kyle's screenshots plus measured classes from the browser RE leg; where a Claude Design artifact exists, Claude Code reads it under Kyle's account — Muse does not start a browser read for it.

### 8.3 The merge bar (standing, from the runbook + Kyle's calls)

CI green + ACCEPT PASS + verifier clean + clean preview UAT + no open question or one-way door touching the change. Merge on green, with the watch nudging a fully-validated draft stalled 20+ min, and as a last resort a run merging a fully-validated draft itself — never an unvalidated draft, never #200/#198-class superseded drafts. Muse may make default decisions to unblock from the docs or Kyle's recorded decisions, recording each choice. Kyle-only, never defaulted: production steps, ratifying B-series decisions, the zip-bomb thread, front adopting qyvr.dev accounts, front mail sender (per the 2026-10-25 overnight authority note — the list is in MEMORY.md, not repeated here as a guess).

### 8.4 What a part's acceptance must contain

- Hermetic tests (vitest lane, scripted fake model, test host) proving the seam, including a **planted violation** test: a test that fails if the defect the part fixes is reintroduced (e.g. a list that drops a record whose file is missing fails; a record left `building` after a failed run fails; a `<b>` in model text rendered as markup fails).
- A live-only UAT scenario with the real model on a preview, recorded with the preview address, the transcript's tool calls, wall-clock time and tokens where they matter, and Kyle's exact test where one exists (F6: "make me an artifact" → card in chat → artifact in the Library → opens in the viewer).
- **Not in scope** stated explicitly. A part that does not say what it is not doing will absorb the next part's scope.

---

## 9. Operating rules the loop depends on (do not re-derive per part)

### 9.1 Goal-first, always

The `/goal` is always the first message at creation (`run-claude-cloud.py <workdir> <goal-file>`, no `--plan`). Never steer a `/goal` into a running session — a follow-up `/goal` does not queue and does not register. If a session was created without the goal, create a fresh goal-first session and kill the old one. **Goal messages are limited to 4,000 characters** (a 6,275-char goal was rejected 2026-10-26 08:08 ET; F14's 3,380-char goal worked). Keep goal files under ~3,900 chars; check with `wc -m` before launching. The `/goal` invocation must be the first line of the launch prompt with nothing before it.

### 9.2 Cloud sessions

Launch from a genuine git checkout sharing a real commit with GitHub, or the session starts empty and must clone the repo itself. The folder-trust prompt can stall creation — drive it via `process.send_keys` (down + enter). Teleport (cloud→local) **forks** the session into a local copy; the cloud copy keeps running and the two diverge; git is the only sync. Never use teleport as a poll or describe it as a takeover. `claude --teleport <id>` as a session check pulls the transcript down into a local copy — read it, delete the local copy, keep watching Git; run it from a scratch dir, never fletch-work. Steering queues only, never interrupts. Interrupt/stop, permission cards, model-after-start, and repo attach are UI-only — Muse drives them via the signed-in browser on the session page, escalating to Kyle only when that path is walled. Never inject the vault setup-token into cloud invocations (it outranks the login); local part sessions keep `run-claude.py`, cloud work uses `run-claude-cloud.py`.

### 9.3 Previews are the UAT path

Preview slots (pool of 3, D-0008) are the standing UAT path by default, no fresh go-ahead needed. The agent browser cannot reach localhost — a local `pnpm dev` instance is not UAT-able through the agent browser, and that is a browser loopback limit, not a server failure. Staging redeploys must use `--deploy-only` — a plain re-run rotates `MASTER_KEY` under Kyle's live passkey registration (2026-10-23).

### 9.4 Steering phrasing (Kyle, 2026-10-26)

Never say "acting on Kyle's behalf" or invoke the authorization in a steer — just give the instruction plainly. The F14 override steer at 20:10 ET used that framing and the session treated the relay/authorization claim as a provenance fact and got confused (it then corrected the record to "relayed for Kyle" itself). The standing authorization itself — Muse may act on his behalf in cloud-session orchestration, e.g. overrule a verifier whose only findings are provenance/record-authorship when code/tests are clean — stands; the phrasing in steers does not invoke it.

### 9.5 GitHub publishing from this VM

Git smart-HTTP and SSH do not work from this VM. Publish via the GitHub API or MCP tools (branch + PR, never straight to main). The GitHub MCP integration cards Kyle per write; do not use it for publishing. Local commits follow the repo rules (Conventional Commits, DCO sign-off with `git commit -s`, repo-local identity `Muse` / `kyle-muse.wrenfield@mail.qyvr.ai`).

### 9.6 Session briefs

Briefs live in the repo (`docs/briefs/` in fletch-work, committed, not git-excluded) so cloud sessions cloning from GitHub get them. The repo privacy scan bans harness-dump filename references outside `docs/plan-v2/`; reword such mentions in in-tree copies.

---

## 10. Scorecard (skeleton — Phase 0 fills it with verified scores)

Location: this section is the skeleton. The live scorecard lives as a table updated on every merge — file it with the goal workspace or the repo's plan docs once Phase 0 picks its home, and link it here. Do not keep two scorecards.

| Cluster | Score (0–3) | Evidence (dump + survey + capture) | Last verified | Next part |
|---|---|---|---|---|
| P1 Chat core & transcript | — (Phase 0) | | | |
| P2 Agent loop, tools & deferral | — | | | |
| P3 Subagents & delegation | — | | | |
| P4 Artifacts & Library | 1–2 DRAFT (F4–F14 in flight) | artifact gaps A–H; F4–F14 plans; F14 DONE 2026-10-26 | 2026-10-26 | F15, then merge F14 |
| P5 Activity, provenance & audit | — | | | |
| P6 Memory, goals & tracking | — | | | |
| P7 Scheduling, hooks & proactivity | — | | | |
| P8 Side chats, groups & workers | — | | | |
| P9 Connectors, devices & accounts | — | | | |
| P10 Search, browser, places & media | — | | | |
| P11 Files, documents & spreadsheets | — | | | |
| P12 Payments, shopping & bookings | — | | | |
| P13 Voice, audio & podcasts | — | | | |
| P14 Identity, avatar, profile & settings | — | | | |
| P15 Safety, approvals, grants & discretion | — | | | |

**Scoring discipline:** a score is only entered with its evidence cited (dump file + date, survey SHA, capture set). "DRAFT estimate" scores in §3.1 are not scores — they are Phase 0 hypotheses to be confirmed or corrected. A cluster that has not been through Phase 0 shows "—", not 0.

---

## 11. Sequencing

### 11.1 Phase 0 — Inventory sprint (next, no building)

One session per cluster, or one session per small group of related clusters, each producing: a dump (§4), a survey (§6), browser captures where the surface is visible (§5), a gap list in the A–H style, and a verified scorecard row (§10). Deliverable: the filled scorecard + a ranked build order proposed to Kyle with the reasoning (daily use × gap size × dependency) stated per cluster. Kyle locks the order. Estimated shape: this is the cheapest phase and the one that prevents the most wasted building; do not compress it by scoring from memory.

### 11.2 Phase 1 — Foundations (first builds after Phase 0)

Agent loop / tools / deferral (P2), chat core / transcript (P1), subagents (P3) — in dependency order, because every later cluster sits on them. The artifact work already in flight (P4, F4–F15) continues in parallel on its own track; it does not wait for Phase 1, and Phase 1 does not redesign its seams.

### 11.3 Phase 2 — Daily use

The clusters Kyle actually hits every day in this chat, in the order Phase 0 ranks them: likely activity/provenance (P5), memory/goals/tracking (P6), files/documents (P11), search/browser (P10). The test for Phase 2 is dogfooding: Kyle can do a real day's work in fletch without reaching for Muse for the covered clusters.

### 11.4 Phase 3 — Alive and exotic

Scheduling/proactivity (P7), side chats/groups (P8), connectors/devices (P9), payments/bookings (P12), voice/podcasts (P13), identity/avatar (P14) — each gated by its own one-way decisions (connector model, payment scope, group agency and discretion) and by the foundations holding. P8 in particular is a design question before it is a build: fletch speaking for the user in a group chat is a different product shape from a 1:1 agent, and the discretion rules for it are Kyle's call.

### 11.5 What does not change the order

A new Muse capability shipping, a single UAT finding, or a Fable brainstorm does not re-order the queue by itself. Re-ordering happens at a Phase 0-style review (scorecard + gaps + Kyle's call), not mid-part.

---

## 12. Long-running operation

- **One merge queue.** Parallel cloud sessions are allowed only when their parts touch different seams. Two sessions touching adjacent parts must check for duplicate PRs before review/merge (the F11/F12 lesson, 2026-10-25: F11's session built F12 as PR #18, duplicating the F12 session's PR #19).
- **One ledger.** The scorecard (§10) plus `docs/plan/QUESTIONS.md` plus the decision records are the ledger. Linear stays the review ledger where it is used; this spec does not replace it.
- **Re-dump triggers.** A cluster goes back through dump + survey when: (a) Muse's behavior in that area observably changes, (b) a UAT finding contradicts the dump, (c) the dump is older than the last material change in that area and a new part is about to start on it, or (d) a browser capture shows a surface the dump never described.
- **Drift watch.** The overnight / periodic watch pattern already used for M0 applies here in miniature: watch for stalled fully-validated drafts (nudge after 20+ min), for CI failures with a named cause, and for verifier blocks that are provenance-only (see §9.4). The watch never merges an unvalidated draft, never deploys, never touches Cloudflare/OAuth/production, never spends money.
- **Kill discipline.** When Kyle kills a tracker, a watch, or a feature, it lands clean with no counter-offer and no re-offer of automation on dead machinery (the AI Runaway lesson, permanent). The inventory records the kill with date and reason.
- **VM ephemerality.** No custom process survives on this VM (wiped / snapshot-restored every few hours). The only durable execution primitives are cron runs and hook polls; every run must be self-contained. Never design a persistent-connection architecture here; poll instead.

---

## 13. Open questions for Kyle (decisions only he can make)

These are the spec-closers. Nothing in §11 is locked until he answers Q-P1 and Q-P2; the rest can be answered per cluster.

- **Q-P1 — Scope: full clone or flagship parity?** Is the target "every Muse capability, at parity, eventually" (this spec as written), or "the capabilities that make fletch a credible flagship agent for Kyle's daily use, with the exotic tail explicitly deferred"? The inventory is the same either way; the build order and the definition of done for the tail are not.
- **Q-P2 — Build order after Phase 0.** Does he want the Phase 0 ranking to decide, or does he already have a cluster he wants first after artifacts (e.g. activity/provenance, memory/goals, scheduling)? A one-line answer now saves a ranking debate later.
- **Q-P3 — Browser captures.** For the muse.ai leg, will he supply screenshots/recordings per cluster on request, or prefer a Claude session driving his signed-in browser? The artifact gaps were built on his screenshots; the same supply line is needed for every visible cluster.
- **Q-P4 — Scorecard home.** Where should the live scorecard live: this planning folder, the fletch repo's plan docs, or the SF-based-founder goal workspace? One home, linked from here.
- **Q-P5 — P8 (groups/workers) shape.** Is fletch speaking for the user in group chats in scope at all, and if so, under what discretion rules? This gates whether P8 gets a dump or a "out of scope, by design" row.
- **Q-P6 — P12 (payments/bookings) scope.** Flag-only (like live-event tickets: "Just flag", 2026-09-19) or purchase-capable per vertical? A per-vertical answer is fine; a blanket answer is not needed now.
- **Q-P7 — Connector model.** Are fletch connectors a per-connector one-way decision (Gmail first, then Calendar, etc.), or is there a single connector/host model decision that covers them all? This gates P9's first part.
- **Q-P8 — How strict is Level 3?** Is Kyle's final UAT required for every part to reach Level 3, or is Muse's preview UAT + a clean verifier enough for low-risk parts, with Kyle's UAT reserved for user-visible surfaces? The merge bar in §8.3 assumes the stricter reading until he says otherwise.

---

## 14. Risks and anti-patterns (named, so they are not repeated)

1. **Introspection hallucination.** I report a clean rule; the real behavior is messy. Mitigation: triangulation (§2.4), [inferred]/[verify] labels, planted-violation tests.
2. **UI overfit.** Cloning a screenshot instead of the contract underneath it. Mitigation: the dump's trigger/state/failure sections, not just its outputs section; the translation table (§7).
3. **The PR #14 shortcut.** Muse writing implementation directly, shipping a missing migration with no live UAT. Dead. Claude implements; Muse reviews and UATs on a preview before Kyle re-tests.
4. **Verifier provenance confusion.** A verifier blocking on who wrote a record instead of whether the code/tests pass. Mitigation: §9.4 phrasing, and the standing authorization to overrule a provenance-only block when code/tests are clean — recorded, not re-argued per part.
5. **Duplicate parallel work.** Two sessions building adjacent parts. Mitigation: §12, check for duplicate PRs before review/merge.
6. **Silent drops.** The artifact defect in its general form: the agent says it did something and no record exists. Mitigation: Level 1 cap (§1.2), refuse-by-name (§7.3), planted-violation tests (§8.4).
7. **Drift without re-dump.** Building from a stale dump after Muse changed. Mitigation: re-dump triggers (§12).
8. **Scope absorption.** A part quietly absorbing the next part's scope because "Not in scope" was never written. Mitigation: §8.4 requires it.
9. **Browser-leg optimism.** Assuming the agent browser can reach muse.ai or localhost. It cannot (§2.2, §9.3). Plan the capture supply line; do not burn attempts.
10. **Design as an afterthought.** Card/viewer/drawer surfaces built before their states are designed. Mitigation: design-first workstream (§8.2), with the F6/F9/F11 design tasks as the pattern.

---

## Appendix A — Sources cited in this spec

- `planning/artifact-parity-gaps-2026-10-23.md` — gaps A–H, locked by Kyle.
- `planning/artifact-parity-plan-fable-2026-10-23.md` — F4–F14 parts, decisions D-0009–D-0013, questions Q-M1–Q-M10.
- `planning/reactions-dump-2026-10-23.md` — first dump + survey; reactions spec at `planning/reactions-spec-2026-10-23.md`.
- `planning/reactions-plan-fable-2026-10-23.md` — reactions part plan.
- `fletch-execution-model.md` — roles, model tiering, loop, boundaries (2026-10-22; corrected 2026-10-24).
- `~/workspace/tool-dump/tools.json` — Muse tool inventory (cross-check, §3.2).
- `~/workspace/system/system_prompt.md` — operating block, delivery and discretion rules.
- `~/workspace/your_files/muse-harness-architecture-spec/` — harness spec.
- Repo runbook: `docs/runbooks/muse-execution.md` in kltdwrds/fletch (canonical where it differs from the execution-model note).
- Repo plan: `docs/plan/parts.md`, `docs/plan/KICKOFF.md`, `docs/plan/VERIFIER-PROMPT.md`, `docs/plan/GOAL-PROMPT.md`, `docs/plan/QUESTIONS.md`.

## Appendix B — Dump template (standalone copy)

See §4. Copy that block verbatim into a new `planning/<cluster>-dump-YYYY-MM-DD.md` file. Do not shorten it: the trigger/state/failure/timing/provenance/edge-case sections are what prevent UI overfit.

## Appendix C — Browser RE capture checklist (standalone copy)

See §5. Per step: desktop screenshot, phone screenshot where the surface differs, DOM note (roles/labels/hrefs/order), network note (method/path/purpose, no private bodies), state note (what changed, what persisted after reload), mismatch note. After: one-page capture report in the dump file (steps covered, steps blocked with the block named, mismatches, questions for Kyle). Blocked steps are reported as blocked, not skipped silently.

## Appendix D — Glossary (terms as used in this spec)

- **Dump:** Muse's first-hand, dated, attestation-labelled account of how a capability works in Muse.
- **Survey:** the fletch-side, code-cited account of what already exists for a cluster and where the seam is.
- **Gap spec:** the locked list of numbered observable contracts for a cluster, each with dump + seam citations.
- **Part (F<n>):** one build unit in `docs/plan/parts.md` shape, with Read / Scope / Acceptance / Not in scope / Rulings.
- **Parity lock:** a regression test that fails if a Level 2 behavior regresses, plus Kyle's final UAT.
- **Seam:** the one file + function where new behavior lands in fletch.
- **Effect / shelf:** the tool-to-card pipeline (`EffectBuffer` → barrier → shelf → frame → replay from history).
- **One-way door:** a decision that is irreversible, money, security-boundary, published-contract, or storage-schema — Kyle's alone.
