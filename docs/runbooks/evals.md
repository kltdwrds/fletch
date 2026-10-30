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
the slot's owner, an event other than `decide`, `tick` or `reload`, or a schedule turn) stops the run by name before any
trial; tier-1 matches are skipped and named, since they run under vitest.

A P7 task (F30, `scripts/evals/p7-slot.ts`) starts each trial with Sam's jobs removed and her home zone Europe/London,
then makes the task's jobs through the slot's test host (`scripts/preview-slot/test-host-p7.mjs`). A `tick` fires the
job's next alarm at once (the test host moves that job's clock to it) and waits for the run, its notice and the turn the
notice wakes; the job's page reads come from a fixture, never the network. The Upcoming tab and the job dialog are read
in headless Chromium (`scripts/evals/p7-page.ts`), so playwright-core's Chromium must be installed (AGENTS.md, gotcha 5).
