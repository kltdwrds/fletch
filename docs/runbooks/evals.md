# Tier-2 evals: tasks on a preview slot with the real model

`pnpm evals` runs a cluster's tier-2 tasks (`test/evals/<cluster>/<task>.task.ts`, `defineTask()` with `tier: 2`)
against this worktree's preview slot, three trials each, graded by the task's own code graders, and writes one
content-free results file per task definition to `docs/plan-v2/evidence/results/<versionHash>.json` (D-0014). It runs
from Kyle's Mac until the CI wiring is accepted (D-0015, proposed). The code: `scripts/evals.ts` (the command),
`scripts/evals/runner.ts` (trials, verdicts, baselines, the table) and `scripts/evals/slot.ts` (the slot, the session,
the chat socket).

## When

- A part's acceptance names a tier-2 task set, or a scorecard level needs a results file.
- A contract's task changed (its `versionHash` is new) and needs a first baseline.

## Steps

1. Lease a slot and deploy the working tree to it (`docs/runbooks/preview.md`):

   ```bash
   pnpm preview up
   ```

2. Run the cluster, or one task:

   ```bash
   pnpm evals P1
   pnpm evals T-P1-03
   ```

   The first run on a fresh lease registers a software passkey with the lease's setup token and keeps the session
   beside the lease file (`<git common dir>/fletch-previews/evals-<tag>.json`, mode 600, never printed); later runs
   sign in with it again. The run prints one line per trial and ends with the Markdown table: paste it into the PR body.

3. Read the verdicts. Per task: `pass` (all three trials), `fail` (the agent failed at least one), or `infra` (the slot
   failed: no lease, a lapsed lease, a 5xx before the first model call, no session). `infra` is never a fail; fix the
   slot and run again. A `regressed` or `improved` note compares with the last pass or fail for the same task hash.

4. Commit the results file(s) with the part. The exit code is 0 when every task passed, 1 otherwise.

`--results <dir>` writes the results elsewhere for a dry run. A task the runner cannot drive (a prompt by anyone but
the slot's owner, an event other than `decide`, `tick`, `reload`, `open` or `prompt` (and for P3 `midchild` and
`children`), or a schedule turn) stops the run by name before any trial; tier-1 matches are skipped and named, since they run under vitest.

A P7 task (F30, `scripts/evals/p7-slot.ts`) starts each trial with Sam's jobs removed and her home zone Europe/London,
then makes the task's jobs through the slot's test host (`scripts/preview-slot/test-host-p7.mjs`). A `tick` fires the
job's next alarm at once (the test host moves that job's clock to it) and waits for the run, its notice and the turn the
notice wakes; the job's page reads come from a fixture, never the network. The Upcoming tab and the job dialog are read
in headless Chromium (`scripts/evals/p7-page.ts`), so playwright-core's Chromium must be installed (AGENTS.md, gotcha 5).

A P5 task (F32, `scripts/evals/p5-slot.ts`) reads the trial's chat through the app's own routes: `/app/activity` (the
trial's chat only) and the task drawer's route. A prompt is over when its task is no longer running, so a request that
delegated waits for its sub-agents' handoff and the turn it wakes. The probe page `https://example.com/p5-probe` is
served by the slot's test-host browser from a fixture (`scripts/preview-slot/test-host-p5.mjs`) and
`example.invalid` is unreachable there; a sub-agent on the slot reads the probe page too. The system prompts are kept by
the test host's `Chat` and read with the `p5` op; the Activity rows and the task drawer, at desktop and phone width, are
read in headless Chromium (`scripts/evals/p5-page.ts`). An `open` event is a fresh read.

A P3 task (F34, `scripts/evals/p3-slot.ts`) reads the P5 world above and the chat's sub-agent rows, mailbox rows and
model requests (their messages, the system prompt aside) through the test host's `p3` op
(`scripts/preview-slot/test-host-p3.mjs`). The probe pages `https://example.com/p3-probe` (a title and three links) and
`https://example.com/p3-probe-2` are served by the test-host browser from fixtures, the second after 45 seconds, so a
steer or a Stop reaches a child mid-read. A request is over when the chat's newest task is not running, no sub-agent
row is out and every row's group has handed off.
`midchild` waits for a child seen mid-run (a running row with a step in its drawer), then sends the steer as a turn or
presses the drawer's Stop; `children` waits everything out; `reload` keeps the entries and rows, then reads them again.
The drawer's sections and the thread are read in headless Chromium (`scripts/evals/p3-page.ts`).

A P9 task (F37, `scripts/evals/p9-slot.ts`) starts each trial with Sam's credential rows deleted through the test host's
`p9` op (`scripts/preview-slot/test-host-p9.mjs`), so T-P9-13 begins with no credential; for T-P9-15 and T-P9-16 the
runner then captures her Example API key on the capture form as she would, and T-P9-17 is played after T-P9-13's ask
(its link submitted on the form) and T-P9-14's typed key. The Example API is the slot's own
`https://<slot>/fixtures/p9-probe`; a Worker cannot fetch its own `workers.dev` host, so the Vault's network answers
`api.example.com` from the same fixture in-process, answers every other host 404 with nothing sent, and keeps every
request, which a grader reads with the Vault's rows and the chat's cards and messages. The slot's chats offer the tier-1
world's fixture connector. A `tabs` event sends from one of two Chromium tabs on the chat and reads both, the sending
tab reloaded and the chat opened at phone width; `reload` draws the chat at a width and reloads it, or after an `open`
reloads that settings page; every request those pages made is kept by origin (`scripts/evals/p9-page.ts`).
