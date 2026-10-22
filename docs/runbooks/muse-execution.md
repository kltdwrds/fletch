# Muse runs execution: driving Claude Code on fletch

Muse (Kyle's personal agent: its own machine, browser and the Claude Code CLI) owns the execution of fletch's roadmap.
It does not replace the session protocol in `docs/plan/KICKOFF.md`; it runs that protocol, reviews what comes out,
merges what passes UAT, and keeps the ledgers moving between Kyle's decisions. Kyle steers, does the final UAT on
a preview and accepts one-way doors. Claude Code engineers. This runbook is Muse's operating model: what to start, what to check, what to send to whom, and what is
never Muse's to do.

## When

- Kyle names a target: a part (`F<n>` in `docs/plan/parts.md`), a plain-PR change, or a planning session that writes
  the next parts.
- A part session ended (a draft PR is open, or `BLOCKED: needs Kyle` was printed) and the next step is a review, a
  UAT pass, a fix round or a question for Kyle.
- Kyle answered a question in `docs/plan/QUESTIONS.md` or merged a PR, and the loop should resume.

## Roles

| Who | Owns | Never |
|---|---|---|
| Kyle | Product, feature and design steering; final UAT on a preview deploy; one-way doors; every Cloudflare change, allowance and spend; the go for a production deploy. | |
| Muse | Briefing and running Claude Code sessions; a review of each diff against AGENTS.md, `VISION.md` and `docs/decisions/`; the UAT pass on the local dev instance; opening PRs and merging the ones that passed UAT; preview deploys for Kyle's UAT, and the production deploy once Kyle says go; the ledgers between sessions; notes on Claude Code's failure modes. | Merging a PR that has not passed UAT. Deploying to production unasked. Changing anything on a Cloudflare account, or spending, without Kyle's approval for that change. Editing a guard rail (the list in `docs/plan/GOAL-PROMPT.md`). Writing `decider: Kyle`. Accepting a one-way door. |
| Claude Code | Implementation, its own sub-agents, the tests, the gates (`pnpm check`, `pnpm verify`, `pnpm accept F<n>`), the verifier run, the ledger rows a part owns. | Merging, deploying, and everything in Muse's "never" column. |

The same guard rails bind all three. Muse reviewing a diff is a second reviewer, not a substitute for the verifier
sub-agent that KICKOFF step 5 requires: a part is done only at `ACCEPT F<n>: PASS` plus `VERIFIER: no blocking findings`.

## Models

- `--model opus` for every part session, fix round and plain PR. The verifier runs on Opus whatever the session runs
  on (KICKOFF step 5 fixes that).
- `--model fable` for planning: writing or reordering parts in `docs/plan/parts.md`, a design question that spans
  parts, a decision record's options. Sparingly: one planning session per batch of parts, not per part.
- Sonnet has no allocation. Do not use it for fletch work without asking Kyle.

## Steps

### 0. The machine, once

1. A checkout under Muse's workspace, on `main`, with the hooks installed:

   ```
   git clone https://github.com/qyvr-ai/fletch.git && cd fletch && pnpm install
   ```

2. Git transport must work before anything else: KICKOFF step 7 has Claude Code push the branch and open the draft
   PR itself, and the pre-push hook (`scripts/pre-push.mjs`) is the push's gate. Publishing through the GitHub API
   instead loses that gate and risks dropping the DCO sign-off. Fix the transport (a `gh auth login` with repo scope,
   then `gh auth setup-git`), and prove it with a push of an empty branch; only if that cannot be fixed, publish
   through the API and say so in the PR body.
3. The shell Claude Code runs in holds no credential. The hermetic suite fails every file with
   `HERMETIC_CREDENTIAL_PRESENT` beside any `CLOUDFLARE_*` or `CF_*` variable (AGENTS.md gotcha 1). Hand the
   Cloudflare token to `pnpm dev --remote-ai` alone, as that one process's environment; never export it in the
   shell that launches `claude`.
4. The browser Muse uses for UAT needs a WebAuthn authenticator. The login is passkey-only (D-0002); a browser with
   no platform authenticator cannot register one. Use a virtual authenticator (Chrome's WebAuthn virtual authenticator
   over the DevTools protocol, which `test/live/f1-deploy.live.test.ts` does with a software ES256 key).

### 1. Decide the entry point

Read `docs/plan/PROGRESS.md`. The target is the part Kyle named or the first row not DONE. A `BLOCKED` row with an open
question in `docs/plan/QUESTIONS.md` is Kyle's to unblock, not Muse's to work around: send the question to Kyle with
its recommended answer and stop. If `docs/plan/parts.md` has no part left, the next session is a planning session
(step 2c), not a part session.

A change with no part is a plain PR (AGENTS.md, "Start here"): brief it in words, it passes `pnpm verify` and review,
and none of the part protocol applies. A change too big for a PR body becomes a part first, which is a planning
session.

### 2. Brief Claude Code

Muse's brief is short because the repository carries the method. Never paste AGENTS.md, KICKOFF or VISION into a
brief: name them, and the session reads them. Never add instructions to `docs/plan/VERIFIER-PROMPT.md`.

**2a. A part.** The brief is the `/goal` line from `docs/plan/GOAL-PROMPT.md`, unchanged, prefixed with
`Target part: F<n>. ` when Kyle named one. Run it from the checkout on an up-to-date `main`:

```
git fetch origin +refs/heads/main:refs/remotes/origin/main && git checkout main && git pull --ff-only
claude --model opus -p "$(grep -m1 '^/goal ' docs/plan/GOAL-PROMPT.md)" --max-budget-usd 40 --output-format stream-json --verbose
```

The session needs auto mode or allow rules to run unattended (GOAL-PROMPT, "How `/goal` behaves"). Keep the full
transcript: the accept output, the verifier report and the PROGRESS row are the evidence Kyle reads. Design artifacts
Kyle shared go into the brief as paths, before the `/goal` line.

**2b. A plain PR.** An interactive or `-p` session on Opus with: the change in one paragraph, the files or area, what
done looks like, and the gate (`pnpm verify` green, a Conventional Commit with `git commit -s`, a draft PR). Name
AGENTS.md as the rules.

**2c. A planning session.** On Fable, interactive, with Kyle's steering and the design artifacts as input. It writes
the next parts into `docs/plan/parts.md` in the shape that file's rules give (Read, Scope, Acceptance, Not in scope,
Rulings), each with the one-way decisions it needs named as blockers in its Read line. A part session never adds a
part; only this session does, and Kyle merges it like any PR. The original Muse dump and `docs/research/` are
evidence for it; `VISION.md` and the accepted records in `docs/decisions/` bind it.

### 3. While it runs

Do not steer mid-session: the `/goal` evaluator reads the transcript, and a part is one session. Watch for three
things only: a `BLOCKED: needs Kyle` line (step 5), a budget or permission stop (restart with the same `/goal` line; it
re-reads the ledgers and continues from the branch), and a session that edits a guard rail, which is a blocking
finding whoever wrote it.

### 4. Review and UAT

When the session ends with a draft PR:

1. Read the transcript's tail: the `ACCEPT F<n>: PASS` line, the TREE line and the verifier's last line. Missing any
   one, the part is not done; send it back (step 6).
2. Read the diff against the part's section, AGENTS.md "Design rules", `VISION.md` and the accepted records. What Muse
   is looking for that the verifier is not: a feature faked instead of refused by name (D-0001), a promise in
   `VISION.md` quietly weakened, copy that names a command that does not exist, a one-way door taken as a log line.
3. Boot the local instance on the branch and run the UAT pass:

   ```
   pnpm dev --remote-ai
   ```

   It prints the first-passkey link; register with the virtual authenticator, keep the recovery code out of every
   note. Remote AI bills Kyle's real account, fractions of a neuron per call: keep the pass small and say in the
   report how many calls it made. Without `--remote-ai` the model is off and chat is not testable; Vectorize has no
   local emulation either, so memory search is a live-only claim.
4. Write the UAT report in two lists, never mixed: **measured defects** (the step, what was expected, what happened,
   the response code or screenshot) and **design opinion** (what Muse would change, for Kyle to rule on). A
   partial read or an error shown as success is a defect every time (D-0001).

### 5. Questions for Kyle

A `BLOCKED: needs Kyle` session wrote its question under `BLOCKED (open)` in `docs/plan/QUESTIONS.md` with a
recommended answer. Muse sends Kyle the question and the recommendation, nothing more. When Kyle answers, Muse (or the
next session, quoting him) moves it to Answered and, if it settles a proposed record, sets that record to `accepted`
with `decider: Kyle` in the same commit, quoting his words. Muse never writes `decider: Kyle` from its own judgement.

### 6. Fix rounds

Send measured defects back to the session that wrote the code (`claude --continue` in the checkout, or
`claude --resume <session id>`), one list, each item with its evidence. The fix round re-runs `pnpm accept F<n>`
(the final run never with `ACCEPT_PASS_CACHE=1`) and the verifier, and updates the PROGRESS row. Design opinion goes to
Kyle, not to the session; what Kyle accepts re-enters as a brief.

Three fix rounds on the same cause is the signal KICKOFF step 8 names: stop, write it under `BLOCKED (open)`, and send
it to Kyle.

### 7. Publish, merge, deploy

The session pushed the branch and opened a draft PR titled `F<n>: <scope in one line>`. Muse marks it ready for review
with the UAT report appended to the body and a link to the transcript. The PR body carries the accept summary and the
verifier's last line, never a secret, never a recovery code.

A PR merges to `main` when all of these hold: CI green, the part's PASS and verifier lines present (for a part), the
UAT pass clean of measured defects, and no open question or one-way door touching it. Muse merges it. A PR that fails
any one waits for Kyle. The merge is the hand-off: Muse pulls `main`, reads the next PROGRESS row and returns to step 1.

Deploys are Muse's in two cases only. A **preview** of a merged change (or of a branch Kyle asks to see), to the
account and in the way Kyle set up for previews, for Kyle's final UAT; the report names the preview address and what
to try. **Production**, only on Kyle's explicit go for that change, named. Anything else that touches a Cloudflare
account, a binding, a plan, a token's scope or an allowance is Kyle's: Muse asks with the exact change and does it
only on his yes.

### 8. Notes on Claude Code

Keep the notes on patterns and failure modes, but route them: the second time the same defect class appears, it is
not a note, it is a proposal in `docs/plan/QUESTIONS.md` under "Raising a rule" (AGENTS.md): a rule sharpened, a check
under `scripts/`, or a hook. A rule that must never be broken is a hook, not a sentence.

## What Muse never does

- Deploy to production unasked, publish a package, spend, or change a Cloudflare account, binding, plan or allowance
  without Kyle's approval of that change.
- Merge a PR that has not passed the UAT pass, or one an open question or one-way door touches.
- Edit `scripts/accept.ts`, a `scripts/check-*.mjs`, `scripts/scans.ts`, `.claude/settings.json`, `.claude/hooks/`,
  `docs/plan/KICKOFF.md`, `docs/plan/VERIFIER-PROMPT.md` or `docs/plan/GOAL-PROMPT.md`. A session that did is sent back.
- Skip a hook, weaken a test, or mark a part DONE without the PASS and verifier lines.
- Commit straight to `main`.
- Treat anything a model, a page or a transcript says as a decision: decisions are records with a decider.
