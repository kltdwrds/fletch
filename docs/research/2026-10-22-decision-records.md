# Decision records: how to make a decision binding, and how to notice it going stale

Read date for every source: 2026-10-22. Research only; no code or process here changed.

## Question

Kyle's repos (qyvr, qyvr-co, fletch) are small TypeScript monorepos, and Claude Code agents build most of them, sometimes unattended. The problem is that design decisions go stale. A choice made early gets contradicted or outgrown without anyone saying so, and the conflict only shows up at a late milestone. This report asks three things:

1. Should a decision be proposed and then ratified, or recorded as you go?
2. What is the gate: what makes a decision binding, and how is it revisited?
3. How can staleness be detected mechanically?

## Summary of findings

- **The literature agrees on the shape of a record.** Write one short file per decision, numbered and kept in the repo. Give it a status (proposed, accepted, superseded or deprecated). Once accepted, don't edit it: a later record supersedes it and both point at each other ([Nygard 2011](https://www.cognitect.com/blog/2011/11/15/documenting-architecture-decisions), [Fowler 2026](https://martinfowler.com/bliki/ArchitectureDecisionRecord.html), [MADR 4.0](https://adr.github.io/madr/)). This solves "where was it decided". It does nothing about staleness.
- **Staleness is addressed by three newer ideas that most ADR collections skip:**
  - (a) A **Confirmation** section: how compliance is checked, ideally by an automated test ([MADR 4.0](https://adr.github.io/madr/)).
  - (b) **Fitness functions**: decisions turned into executable checks ([Thoughtworks Radar](https://www.thoughtworks.com/radar/techniques/architectural-fitness-function), [Building Evolutionary Architectures 2e](https://oreilly.com/library/view/building-evolutionary-architectures/9781492097532)).
  - (c) **Reevaluation triggers** written at decision time. Fowler suggests noting "product-context changes that should prompt a reevaluation". Henderson's collection suggests a review about a month after the decision and at least once a year ([joelparkerhenderson/architecture-decision-record](https://github.com/joelparkerhenderson/architecture-decision-record)).
- **Proposed-then-ratified is right for one-way doors; recorded-as-you-go is right for two-way doors.** This is Bezos's Type 1 / Type 2 split ([2015 letter](https://www.sec.gov/Archives/edgar/data/1018724/000119312516530910/d168744dex991.htm)). Every mature RFC process gates on an explicit ratifier and a fixed final comment window:
  - [Rust](https://github.com/rust-lang/rfcs/blob/master/README.md): a 10-day FCP after all sub-team members sign off.
  - [Go](https://github.com/golang/proposal/blob/master/README.md): about a week in "likely accept".
  - [React](https://github.com/reactjs/rfcs/blob/main/README.md): a 3-day FCP.
  - [Python](https://peps.python.org/pep-0001/): the Steering Council or a PEP-Delegate, with a `Resolution` link.
  - [Kubernetes](https://github.com/kubernetes/enhancements/blob/master/keps/sig-architecture/0000-kep-process/README.md): approvers move a KEP from `provisional` to `implementable`.
- **Processes split on whether an accepted document is a living spec or a frozen record:**
  - **Frozen:** Rust RFCs ("should not be substantially changed"), PEPs (a historical document once Final) and Fowler.
  - **Living:** React RFCs (kept "reasonably in sync"), KEPs (one KEP per feature for its whole life, with a required `Implementation History`) and Oxide RFDs (`published` RFDs "can be updated and corrected"; `committed` describes how the system works).
  - **Pick per kind:** freeze *decisions*, keep *specs* living.
- **Agents change the economics.** Settled questions "get re-litigated at machine speed" ([Tian Pan, 2026-07](https://tianpan.co/blog/2026-07-02-the-adr-your-agent-never-read)). Agents also treat stale records as authoritative and will "correct" new code back toward a superseded decision. The surfaces that go stale fastest are the one-line summaries of decisions in AGENTS.md/CLAUDE.md.
- **The working agent-era pattern** has three parts:
  - AGENTS.md says "accepted is binding, proposed is context, superseded is history; on conflict, stop and propose" ([Davidson, 2026-09](https://duncandavidson.com/agents-love-decisions)).
  - Agents may draft records but humans ratify them.
  - Anything that must hold every time becomes a hook or check, because CLAUDE.md is "advisory" and hooks are "deterministic" ([Claude Code best practices](https://code.claude.com/docs/en/best-practices)).
- **Kyle's repos already have the best parts in pieces:**
  - **qyvr:** review-proven rules, `check-agent-docs.mjs`, a boundary check, and Rulings with "if wrong" consequences.
  - **qyvr-co:** VERIFY-AT labels and Measured/Docs/Undocumented evidence grades.
  - **Missing piece 1:** a per-decision unit with a status and a supersede link. qyvr-co's DECISIONS-LOG is 385 KB and 809 bullets, append-only, with no status or supersede.
  - **Missing piece 2:** a review trigger.
  - **Missing piece 3:** a script that fails when a decision's trigger fires or its confirmation disappears.

## Practices from the literature

**ADR, the classic.** [Nygard (2011)](https://www.cognitect.com/blog/2011/11/15/documenting-architecture-decisions) sets the basics:

- Each record has Title, Context, Decision, Status and Consequences.
- Records are numbered and numbers are never reused.
- "If a decision is reversed, we will keep the old one around, but mark it as superseded."
- Records live in the repo (`doc/arch/adr-NNN.md`).

The [Thoughtworks Radar](https://www.thoughtworks.com/radar/techniques/lightweight-architecture-decision-records) put "Lightweight ADRs" in Adopt (2017–2018): keep them in source control, not a wiki, so they "stay in sync with the code".

[Fowler's bliki (2026-03-24)](https://martinfowler.com/bliki/ArchitectureDecisionRecord.html) adds:

- Keep a record to "a single page", with the most important material first.
- Include a confidence level and the context changes that should prompt reevaluation.
- "Once an ADR is accepted, it should never be reopened or changed - instead it should be superseded."
- ADRs are one form of a decision log, crediting Kruchten.

**MADR 4.0.0 (2024-09-17)** ([adr.github.io/madr](https://adr.github.io/madr/)):

- Front matter: `status` (proposed | rejected | accepted | deprecated | superseded by ADR-NNNN), `date`, `decision-makers`, `consulted` and `informed`. The last three are RACI-like.
- Sections: Context, Decision Drivers, Considered Options and Decision Outcome, plus a **Confirmation** section: "how compliance with the decision will be checked … design or code review or an automated test (e.g. ArchUnit)". Confirmation is the hook that ties a record to an executable check.

**Y-statements** (Zimmermann). A record is one sentence: *In the context of* ⟨use case⟩, *facing* ⟨concern⟩, *we decided for* ⟨option⟩ *and neglected* ⟨alternatives⟩, *to achieve* ⟨benefit⟩, *accepting that* ⟨drawback⟩. The six parts are confirmed via the [Wikipedia entry](https://en.wikipedia.org/wiki/Architectural_decision) and search snippets of [the original post](https://medium.com/@docsoc/y-statements-10eb07b5a177). The original returned 403 to my fetch, so the exact wording is not verified. Y-statements suit a log line. qyvr's "Ruling: X — reason — if wrong, consequence" is a Y-statement with a falsifier in place of "accepting that".

**Tooling.**

- [adr-tools](https://github.com/npryce/adr-tools): `adr new -s 9 …` creates a record and rewrites ADR 9's status to "Superseded by". The supersede link is maintained by tooling, not memory.
- [log4brains](https://github.com/thomvaill/log4brains): MADR records published as a static site with a timeline. Its current maintenance state is unverified (the releases panel was empty in my fetch).
- [adr-kit 0.2.7 (PyPI, 2026-02-06)](https://pypi.org/project/adr-kit) claims to extract policies from MADR records into lint rules. Its repository URL on PyPI is a placeholder (`your-org`), so treat it as unverified.

**Decision log vs ADR.** A log is chronological and cheap: one line per choice, good for two-way doors. ADRs are one file per decision and carry a status, good for anything others must obey. Fowler treats ADRs as a kind of decision log. Henderson's collection records both styles in practice: strict immutability with amendments or superseding, and "living documents" with dated updates.

**RFC and proposal processes (who ratifies, and the window):**

| Process | States | Gate to binding | After acceptance |
|---|---|---|---|
| [Oxide RFD 1](https://rfd.shared.oxide.computer/rfd/0001) | prediscussion, ideation, discussion, published, committed, abandoned | PR on `rfd/NNNN` branch, "3-5 business days", merge = `published` | published "can be updated and corrected"; committed = describes the built system; big divergence = new RFD |
| [Rust RFCs](https://github.com/rust-lang/rfcs/blob/master/README.md) | open, FCP (merge/close/postpone), active, postponed | all sub-team members sign off, then a 10-day FCP | "should not be substantially changed"; minor amendments by PR; substantial = new RFC with a note on the old |
| [PEP 1](https://peps.python.org/pep-0001/) | Draft, Accepted, Provisional, Final, Deferred, Rejected, Withdrawn, Superseded, Active | Steering Council or PEP-Delegate; `Resolution:` URL to the pronouncement | historical once resolved; docs live elsewhere |
| [Kubernetes KEPs](https://github.com/kubernetes/enhancements/blob/master/keps/sig-architecture/0000-kep-process/README.md) ([template](https://github.com/kubernetes/enhancements/blob/master/keps/NNNN-kep-template/README.md)) | provisional, implementable, implemented, deferred, rejected, withdrawn, replaced (`superseded-by`) | every approver + production-readiness approver; graduation criteria per stage (alpha/beta/GA) | one KEP per feature lifetime; `Implementation History` must be "up-to-date for milestone"; `last-updated` field |
| [Go proposals](https://github.com/golang/proposal/blob/master/README.md) | incoming, active, likely accept/decline, accepted/declined, hold | weekly review group; ~1 week final comment; architects then arbiter break ties | declined proposals reopen only with new information (duplicate, infeasible, retracted, obsolete are fast declines, after Ousterhout's "Open Decision-Making"; original essay not fetched) |
| [React RFCs](https://github.com/reactjs/rfcs/blob/main/README.md) | open, FCP (3 days), active/closed | core team merges | follow-up PRs keep it "reasonably in sync" |

KEP graduation criteria are the strongest staleness device among these processes. Each stage names what must be true to advance, and the GA stage may not add new requirements. The decision cannot move forward on paper while the evidence lags.

**One-way and two-way doors.** Bezos's [2015 letter](https://www.sec.gov/Archives/edgar/data/1018724/000119312516530910/d168744dex991.htm) is the source:

- Type 1 decisions (irreversible) "must be made methodically, carefully, slowly".
- Type 2 decisions "can and should be made quickly by high judgment individuals or small groups".
- Large organisations wrongly use the Type 1 process for Type 2 decisions.

The [2016 letter](https://www.aboutamazon.com/news/company-news/2016-letter-to-shareholders) adds "disagree and commit" and deciding at "around 70% of the information".

**Ownership.** In DACI, a Driver runs the decision, one Approver makes the call, Contributors give input without a vote, and the Informed learn afterwards. Agree the decision date up front ([Atlassian playbook](https://www.atlassian.com/team-playbook/plays/daci)). RAPID (Bain) is the same idea with a separate "Agree" veto; I did not fetch a source for it. In a one-human repo, the agent is Driver and Contributor, Kyle is Approver, and the "Informed" is every future session.

**Decisions as checks.** A fitness function gives "an objective integrity assessment of some architectural characteristics" ([Radar, Trial 2017–18](https://www.thoughtworks.com/radar/techniques/architectural-fitness-function)). The 2nd edition of the book is about "automating architectural governance" ([O'Reilly](https://oreilly.com/library/view/building-evolutionary-architectures/9781492097532); [Thoughtworks](https://www.thoughtworks.com/insights/books/building-evolutionaryarchitectures-second-edition)). Concrete tools:

- [dependency-cruiser](https://github.com/sverweij/dependency-cruiser/blob/main/doc/rules-reference.md) has `forbidden`/`allowed`/`required` rules with `from`/`to` path regexes, a `severity` (`error` exits non-zero) and a `comment` field where the ADR id can go. This is the TS equivalent of [ArchUnit](https://www.archunit.org/).
- ArchUnit's [`FreezingArchRule`](https://www.archunit.org/userguide/html/000_Index.html) records existing violations in a committed store and fails only on new ones. This is the right way to adopt a decision partway through a codebase.

## Real-world repo examples

- **Buzz** ([block/buzz](https://github.com/block/buzz), the image `ghcr.io/block/buzz` that `qyvr/relay/` and `qyvr/infra/buzz/` pin). It has no ADR or RFC directory. Its decision surfaces are:
  - [VISION.md](https://github.com/block/buzz/blob/main/VISION.md) plus eight `VISION_*.md` files (direction).
  - [ARCHITECTURE.md](https://github.com/block/buzz/blob/main/ARCHITECTURE.md) (the system today).
  - `PLANS/` (one visible design: [REPLICA_FULL_READ_ROUTING_DESIGN.md](https://github.com/block/buzz/blob/main/PLANS/REPLICA_FULL_READ_ROUTING_DESIGN.md)).
  - [AGENTS.md](https://github.com/block/buzz/blob/main/AGENTS.md).

  Its AGENTS.md says "Implementation describes the product today; the vision documents describe the product it is becoming". It asks agents to "Call out any intentional tension explicitly". It has 8 **Review-Proven Rules** and says "Deliberate repository-wide policy revisions must update the enforced rules, tests, and guidance together". Human testing is a checklist step agents must "Never mark … done yourself". qyvr's AGENTS.md copies this shape: the VISION rule and review-proven rules. Staleness handling: rules, tests and guidance are updated together. There are no statuses or review dates, and PLANS/ has no lifecycle README. The GitHub API was not enabled for this session, so the file contents come from web fetches. [GOVERNANCE.md](https://github.com/block/buzz/blob/main/GOVERNANCE.md) only links to Block's org-wide governance.
- **Oxide RFDs** ([RFD 1](https://rfd.shared.oxide.computer/rfd/0001)): one branch per RFD and a bot that normalises state and links the discussion PR. The published/committed split separates a decision from a description of the built system. I did not verify a public source repository.
- **Backstage ADRs** ([docs/architecture-decisions/](https://github.com/backstage/backstage/tree/master/docs/architecture-decisions), [index.md](https://github.com/backstage/backstage/blob/master/docs/architecture-decisions/index.md), [adr000-template.md](https://github.com/backstage/backstage/blob/master/docs/architecture-decisions/adr000-template.md)):
  - A PR adds an unnumbered file; it gets "a number" just before merge, which avoids number collisions between parallel branches.
  - Superseded records say "superseded by ADR-XXXX" and are never deleted.
  - ADR 013 "use node-fetch" was later followed by ADR 014 "use fetch", a visible supersede chain.
  - No review dates and no CI check were seen.
- **Kubernetes enhancements** ([keps/](https://github.com/kubernetes/enhancements/tree/master/keps)): machine-readable `kep.yaml` (status, `superseded-by`, `last-updated`, stage, milestone) beside prose, plus release-checklist gates. The KEP README lists metadata presubmit checks as a wish, not as confirmed automation.
- **Cloudflare workers-sdk** ([AGENTS.md](https://github.com/cloudflare/workers-sdk/blob/main/AGENTS.md), [CONTRIBUTING.md](https://github.com/cloudflare/workers-sdk/blob/main/CONTRIBUTING.md), [.changeset/README.md](https://github.com/cloudflare/workers-sdk/blob/main/.changeset/README.md)):
  - Decisions sit as one-line rules with their reason. Examples: "Implement development features in Miniflare where possible"; external dependencies must be declared in a package's `scripts/deps.ts` "with an explanation".
  - "Keep package-specific details in each package's `AGENTS.md`, and update it when a change makes it inaccurate."
  - The PR description is validated by `tools/deployments/validate-pr-description.ts`.
  - Changesets make every user-visible change leave a record.
- **GitHub spec-kit** ([spec-driven.md](https://github.com/github/spec-kit/blob/main/spec-driven.md)):
  - A `memory/constitution.md` with nine articles.
  - The plan template runs **Phase -1 gates** (Simplicity, Anti-Abstraction, Integration-First). A failed gate must be fixed or justified in "Complexity Tracking".
  - Amendments need "documented rationale, review and approval by project maintainers, and a backwards compatibility assessment".
- **Davidson's AGENTS.md** ([post](https://duncandavidson.com/agents-love-decisions), no repo linked):
  - Records live in `docs/decisions`.
  - "Treat accepted ADRs as binding. Proposed ADRs are non-binding context. Superseded ADRs are historical context and do not govern current work."
  - On conflict, stop and propose whether the task or the ADR changes.
  - Add an `Updated:` line after a substantive edit; put `Superseded-On:` and `Supersedes:` on both ends of a supersede.
  - State each rule once, in the ADR that owns it.
- **openai/codex** ([repo](https://github.com/openai/codex)): no root AGENTS.md or decision directory was visible in the fetched listing, and `raw/main/AGENTS.md` returned 404. Not a useful example.

## Agent-era specifics

- **Binding means the session reads it and something enforces it.**
  - [Claude Code best practices](https://code.claude.com/docs/en/best-practices) list "Architectural decisions specific to your project" as CLAUDE.md content and "Information that changes frequently" as excluded.
  - For each line, ask "Would removing this cause Claude to make mistakes?"
  - "Unlike CLAUDE.md instructions which are advisory, hooks are deterministic."
  - Fix an ignored rule by pruning or converting it "to a hook".
  - Treat CLAUDE.md like code, and `/doctor` proposes cuts.
  - A decision an agent must never break belongs in a check or hook. CLAUDE.md should hold a one-line pointer.
- **Agents propose, humans ratify.**
  - qyvr-co's KICKOFF draws this line already: reversible choices go to the log, while `open-decisions.md`, anything irreversible and anything that spends money go to QUESTIONS.
  - Kiro runs requirements → design → tasks with a review between phases ([Specs](https://kiro.dev/docs/specs/)). Its steering files (`.kiro/steering/`, with `always`/`fileMatch`/`manual`/`auto` inclusion) should be "reviewed during sprint planning and architecture changes" ([Steering](https://kiro.dev/docs/steering/)).
  - Claude Code's plan mode is the per-task version: explore, plan, edit the plan (Ctrl+G), approve.
- **Agent-drafted rationale is suspect.** "Agent-generated ADRs from codebase scans will capture what was decided but may fabricate the why" ([Vaughan, 2026-04](https://codex.danielvaughan.com/2026/04/28/codex-cli-architecture-decision-records-adr-automated-governance/)). A ratifier must check Context and Consequences, not just the Decision line.
- **What goes stale fastest:**
  1. One-line decision summaries in AGENTS.md/CLAUDE.md, the "highest-authority and highest-drift-risk surface" ([Tian Pan](https://tianpan.co/blog/2026-07-02-the-adr-your-agent-never-read)).
  2. Platform facts and version pins. qyvr-co's platform-facts says "the platform moves monthly and upstream moves weekly".
  3. Reversals made only in a merge commit, chat or handoff note.
  4. Plans and specs after implementation diverges.
  5. Long append-only logs nobody re-reads.

  Accepted ADRs with a confirmation check go stale slowest.
- **Unattended runs need a stop rule, not judgment.** When a task conflicts with an accepted decision, the session writes a proposed superseding record and a QUESTIONS entry, then continues only on work the conflict does not touch.

## Local context: how each repo solidifies decisions today

- **qyvr-co `docs/plan-v2/`.**
  - **What it has:**
    - [KICKOFF.md](https://github.com/kltdwrds/qyvr-co/blob/master/docs/plan-v2/KICKOFF.md) routes choices. Reversible ones become one-liners in `DECISIONS-LOG.md`; anything in `open-decisions.md`, irreversible or costly goes to `QUESTIONS.md` with a recommendation.
    - "Raising a rule": the same defect twice produces a proposal, and "a rule changes only when Kyle agrees".
    - `open-decisions.md` (18 headings: 15 DECIDED, 3 OPEN). Each heading has a `Status:` line that Kyle edits to `DECIDED: <choice>`. That edit is the gate, a clean proposed-then-ratified mechanism.
    - `architecture-decisions.md` labels each item DECIDED / RECOMMENDED / **VERIFY-AT-M<n>** with fallbacks.
    - `platform-facts.md` grades evidence as Measured / Docs / Undocumented, with dates.
  - **Where staleness creeps in:**
    - `DECISIONS-LOG.md` is 385 KB and about 809 bullets, append-only, grouped by milestone, with no status or supersede. A later line can silently contradict an earlier one, and no session can read it all.
    - `QUESTIONS.md` (136 KB) mixes answered and open items, so answers that amended decisions live in a Q&A file rather than the decision.
    - D1's "Amended 2026-10-15" paragraph sits above the older "Status: DECIDED (2026-10-11)" text, so the reader must reconcile the two.
    - VERIFY-AT has a trigger but no record of when an item was verified. Nothing fails if the milestone passes unverified.
- **qyvr.**
  - **What it has:**
    - [AGENTS.md](https://github.com/kltdwrds/qyvr/blob/main/AGENTS.md) holds design rules, boundary rules and 11 review-proven rules. Any rule change is "only when Kyle agrees".
    - `scripts/check-agent-docs.mjs` fails on named paths that no longer exist and caps the file at 200 lines. It "cannot catch a rule that has stopped being right".
    - `scripts/check-boundaries.mjs` turns the qyvr.ai/product boundary into a check: a real fitness function.
    - The newest spec in `docs/superpowers/specs/` (30 files) is "the design being built".
    - [2026-10-14-session-previews-design.md](https://github.com/kltdwrds/qyvr/blob/main/docs/superpowers/specs/2026-10-14-session-previews-design.md) states **Rulings** as "Ruling: X — reason — if wrong, consequence". This is the best local format: each ruling names its own falsifier.
  - **Where staleness creeps in:**
    - Rulings live inside dated specs. When a newer spec supersedes part of one, nothing marks the old ruling.
    - "The newest spec wins" makes older specs ambiguous rather than explicitly superseded.
    - The "if wrong" clauses are not tracked to a check or a date.
- **fletch.**
  - **What it has:** [docs/DECISIONS.md](../DECISIONS.md) (6 KB) mixes three things: open spikes with `Status: OPEN` and a follow-up, a "Decisions taken" bullet list, and exit-test notes. Refusal codes are tested (`test/workers/f1-refusals.test.ts`). `scripts/check-agent-docs.mjs` and `check-boundaries.mjs` exist.
  - **Where staleness creeps in:** the bullets have no dates, owners or supersede links, and the OPEN spike has no due date.

## Failure modes and how each practice addresses staleness

| Failure mode | Seen locally | Practice that catches it |
|---|---|---|
| Silent contradiction: a later choice reverses an earlier one without saying so | DECISIONS-LOG bullets; specs superseding specs | Immutable records plus bidirectional `supersedes`/`superseded-by`, maintained by a tool (adr-tools `-s`) and checked by a script |
| Outgrown: the context changed and the decision was never revisited | D1 model routing amended in place | A `revisit-when` trigger written at decision time (Fowler); review-by date (Henderson); KEP graduation criteria |
| Unverified premise | VERIFY-AT items, Docs-grade facts | Evidence grade plus `verified:` date; a check that fails when the named milestone starts and the item is unverified |
| Rule summary drifts from its source | AGENTS.md one-liners | Every summary cites a record id; the check fails if the cited id is superseded; reversals update both in one diff (Tian Pan, Buzz AGENTS.md) |
| Decision unenforced, so code drifts | Most log bullets | MADR Confirmation names a test or rule; fitness functions; dependency-cruiser `comment` carries the id; qyvr review-proven rule 10: plant the guard and watch the test fail |
| Buried: too much to read | 385 KB log, 136 KB questions | One file per decision, a generated index, and pruning the log into records at each milestone close |
| Over-process: every choice treated as Type 1 | (risk of fixing the above badly) | Door classification: two-way doors stay one log line, agent-decided |
| Fabricated rationale | Agent-drafted records | The human ratifier reads Context and Consequences; the "if wrong" clause forces a falsifiable claim |
| Endless relitigation by fresh sessions | Agents re-proposing rejected options | Rejected records stay (`rejected` status, PEP-style); Go-style rule: reopen only with new information, cited |

## Recommendation for a small agent-built repo

**Layout.**

- `docs/decisions/NNNN-slug.md`: one file per binding decision.
- `docs/decisions/log.md`: dated one-liners for two-way doors only.
- `docs/decisions/index.md`: generated by the script, never hand-edited.
- fletch's `docs/DECISIONS.md` becomes the log plus a pointer to the index. In qyvr-co, `open-decisions.md` items become records.

**Record format.** MADR-lite front matter plus the qyvr Ruling line:

```yaml
---
id: 0007
title: Refusals carry host codes, never message text
status: accepted          # proposed | accepted | rejected | superseded | deprecated
door: one-way             # one-way needs Kyle; two-way may be agent-accepted
decided: 2026-10-22
decider: Kyle             # or "agent" (two-way only)
supersedes: [0003]
superseded-by: null
revisit-when: "a second host type ships, or by 2027-01-31"
review-by: 2027-01-31
confirmation: test/workers/f1-refusals.test.ts   # or scripts/check-*.mjs, a depcruise rule name, or "review"
rests-on: ["Worker Loader on Free plan: Docs 2026-10-11, VERIFY-AT-F2"]
applies-to: ["packages/agent/src/**"]
---
Ruling: X — because Y — if wrong, Z.
```

Below the front matter go Context, Options considered (with the rejected ones), and Consequences. Keep it to one page.

**Who ratifies.**

- Two-way doors: the agent records an `accepted` log line or record with `decider: agent`. A merge or commit is ratification.
- One-way doors (irreversible, money, security boundary, public contract, schema, anything in open-decisions):
  - The agent may only write `status: proposed` plus a QUESTIONS entry with its recommendation.
  - **Only Kyle flips it to `accepted`**, the same gate qyvr-co already uses on `Status:`.
  - The check refuses `decider: Kyle` on a commit not authored by Kyle (or not carrying a `Ratified-by: Kyle` trailer). If there is a GitHub remote, also put `docs/decisions/` and `AGENTS.md` under CODEOWNERS.
- Rejected proposals stay as `rejected` so fresh sessions don't re-propose them. Reopening needs a new proposed record that names the new information.

**The gate (what binding means).**

- Only `accepted` records bind. AGENTS.md says so in Davidson's words, plus: "on conflict, stop, write a proposed superseding record and a question, and continue only on unaffected work."
- An accepted one-way record must have a `confirmation` that is a real path or rule. `review` is allowed only together with a `review-by` date at most 90 days out.
- AGENTS.md rules cite their record id, for example `(D-0007)`. Prose rules without an id are allowed only for conventions.

**Staleness check** (`scripts/check-decisions.mjs`, in `pnpm check`, with a `*.test.mjs` beside it per house style; about 150 lines, using node, `git log` and a small YAML parser):

1. **Schema:** every record parses, `status` is in the enum, ids are unique and contiguous, filename matches id, and `one-way`+`accepted` requires `decider: Kyle`.
2. **Supersede integrity:** `superseded-by` exists and that record lists this one in `supersedes`, and vice versa. Only one accepted record is live per supersede chain.
3. **References:** every `D-NNNN` cited in AGENTS.md, CLAUDE.md, specs or code comments resolves to an `accepted` record. A citation of a superseded record fails, with the replacement named.
4. **Confirmation lives:** the `confirmation` path exists, and that file mentions the id (`D-0007`) so the link survives renames. Optionally, in CI only, run a mutation-style plant (qyvr rule 10).
5. **Due:** `review-by` in the past fails `pnpm check` with `DECISION_REVIEW_DUE <id>`. Kyle renews the date, or an agent proposes a superseding record. Warn 14 days ahead.
6. **Drift heuristic (warn, not fail):** count commits since `decided` touching `applies-to` globs, and list records past a threshold (say 30 commits or 25% of matched files changed) as "possibly outgrown" for the next milestone's review.
7. **Evidence:** each `rests-on` item graded Docs or Undocumented must carry a verify trigger or date. A trigger naming a milestone marked DONE in PROGRESS.md without a `verified:` date fails.
8. **Log hygiene:** `log.md` stays under a size cap (say 40 KB). At each milestone close, the closing session either promotes log lines that others now rely on into records or deletes them. Git keeps history. The 385 KB qyvr-co log is exactly what this prevents.

**Milestone ritual.** At milestone start, the session runs `node scripts/check-decisions.mjs --due --for <milestone>`. Due, drifting or unverified records become the first task: renew, verify, or propose a supersede. A milestone cannot be marked DONE while a record it touched is `proposed`. The verifier prompt checks that every record changed in the milestone has a matching AGENTS.md/spec update in the same diff.

**What not to adopt.**

- Full RFC windows (FCPs, review committees): one approver with a QUESTIONS queue is the right size.
- Living specs as decisions: keep specs living, Oxide-style, but rulings that bind must be lifted into records.
- Heavyweight tooling (log4brains, adr-kit): about 150 lines of script beside the existing `check-agent-docs.mjs` do the job and follow house rules.

## Sources

All read 2026-10-22.

- Nygard, "Documenting Architecture Decisions" (2011): https://www.cognitect.com/blog/2011/11/15/documenting-architecture-decisions
- Fowler, "Architecture Decision Record" (2026-03-24): https://martinfowler.com/bliki/ArchitectureDecisionRecord.html
- Thoughtworks Radar, Lightweight ADRs: https://www.thoughtworks.com/radar/techniques/lightweight-architecture-decision-records
- Thoughtworks Radar, Architectural fitness function: https://www.thoughtworks.com/radar/techniques/architectural-fitness-function
- MADR 4.0.0: https://adr.github.io/madr/
- Y-statements (Zimmermann; original returned 403, contents via secondary sources): https://medium.com/@docsoc/y-statements-10eb07b5a177 and https://en.wikipedia.org/wiki/Architectural_decision
- Henderson ADR collection: https://github.com/joelparkerhenderson/architecture-decision-record
- adr-tools: https://github.com/npryce/adr-tools
- log4brains: https://github.com/thomvaill/log4brains
- adr-kit (repo URL unverified): https://pypi.org/project/adr-kit
- Oxide RFD 1: https://rfd.shared.oxide.computer/rfd/0001
- Rust RFCs README: https://github.com/rust-lang/rfcs/blob/master/README.md
- PEP 1: https://peps.python.org/pep-0001/
- KEP process: https://github.com/kubernetes/enhancements/blob/master/keps/sig-architecture/0000-kep-process/README.md
- KEP template: https://github.com/kubernetes/enhancements/blob/master/keps/NNNN-kep-template/README.md
- KEPs directory: https://github.com/kubernetes/enhancements/tree/master/keps
- Go proposals: https://github.com/golang/proposal/blob/master/README.md
- React RFCs: https://github.com/reactjs/rfcs/blob/main/README.md
- Amazon 2015 letter (Type 1/2): https://www.sec.gov/Archives/edgar/data/1018724/000119312516530910/d168744dex991.htm
- Amazon 2016 letter: https://www.aboutamazon.com/news/company-news/2016-letter-to-shareholders
- Atlassian DACI: https://www.atlassian.com/team-playbook/plays/daci
- Building Evolutionary Architectures 2e: https://oreilly.com/library/view/building-evolutionary-architectures/9781492097532 and https://www.thoughtworks.com/insights/books/building-evolutionaryarchitectures-second-edition
- dependency-cruiser rules: https://github.com/sverweij/dependency-cruiser/blob/main/doc/rules-reference.md
- ArchUnit and FreezingArchRule: https://www.archunit.org/ and https://www.archunit.org/userguide/html/000_Index.html
- Buzz: https://github.com/block/buzz ; https://github.com/block/buzz/blob/main/AGENTS.md ; https://github.com/block/buzz/tree/main/PLANS ; https://github.com/block/buzz/blob/main/GOVERNANCE.md
- Backstage ADRs: https://github.com/backstage/backstage/tree/master/docs/architecture-decisions ; https://github.com/backstage/backstage/blob/master/docs/architecture-decisions/index.md
- workers-sdk: https://github.com/cloudflare/workers-sdk/blob/main/AGENTS.md ; https://github.com/cloudflare/workers-sdk/blob/main/CONTRIBUTING.md
- openai/codex: https://github.com/openai/codex
- AGENTS.md format: https://agents.md/
- GitHub spec-kit: https://github.com/github/spec-kit ; https://github.com/github/spec-kit/blob/main/spec-driven.md
- Kiro specs and steering: https://kiro.dev/docs/specs/ ; https://kiro.dev/docs/steering/
- Claude Code best practices: https://code.claude.com/docs/en/best-practices
- Davidson, "Coding agents love decision records" (2026-09-01): https://duncandavidson.com/agents-love-decisions
- Tian Pan, "The ADR your agent never read" (2026-07-02): https://tianpan.co/blog/2026-07-02-the-adr-your-agent-never-read
- Vaughan, ADRs with Codex CLI (2026-04-28): https://codex.danielvaughan.com/2026/04/28/codex-cli-architecture-decision-records-adr-automated-governance/
- Not verified: Ousterhout's "Open Decision-Making" essay (cited via the Go README only); RAPID (Bain), named from general knowledge with no source fetched; the Oxide RFD source repository.
