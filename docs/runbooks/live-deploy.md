# Live deploy: the F1 exit test

A real deploy into a throwaway Cloudflare account: health, a passkey with the setup token, the recovery code, a
memory round trip and the last-passkey rule, timed, then deleted. `test/live/f1-deploy.live.test.ts` is the test;
`.github/workflows/live-deploy.yml` runs it by hand or when a release is published.

## When

- Before tagging a release of the self-host path (the tag `v0.1.0` follows the first passing run).
- After a change to `packages/create-fletch/`, the provisioning library or the agent's config.

## Steps

1. Make sure the throwaway account is empty of last run's bucket: R2 cannot empty a bucket through its API, so a
   run leaves `fletch-ci-<run id>-agent` behind with a warning. In the dashboard: R2, the bucket, delete its
   objects, then delete the bucket.
2. Run it from GitHub (Actions, live-deploy, Run workflow; it needs the repository secrets `CF_LIVE_ACCOUNT_ID` and
   `CF_LIVE_TOKEN`), or locally with the account's id and token in your environment:

   ```
   QYVR_LIVE=1 pnpm exec vitest run test/live/f1-deploy.live.test.ts
   ```

   or as the last step of a part's acceptance: `pnpm accept F1` runs it when `QYVR_LIVE=1`, `CF_LIVE_ACCOUNT_ID` and
   `CF_LIVE_TOKEN` are all set, and prints `live: skipped (no account)` otherwise.
3. Read the wall-clock time it prints, and record a pass in `docs/plan/PROGRESS.md` (F1's row) with that time.
4. Sweep anything a cancelled or crashed run left (it touches only `fletch-ci-` names):

   ```
   pnpm live-sweep
   ```

   A bucket that still holds objects is reported by name; delete it by hand as in step 1.

## What it checks, and what it leaves

`/health` lists seven objects; `/app/chats` is `401 SESSION_MISSING`; `/login?setup=` is the register page; a software
ES256 passkey registers with the setup token and yields a recovery code; a chat remembers "my favourite colour is
teal" and answers it in a new chat; deleting the only passkey is refused with `LOGIN_LAST_PASSKEY`; a second passkey is
added and one deleted; the recovery code signs in once and then fails with `RECOVERY_CODE_SPENT`. The time is printed,
not asserted, and the free plan counts as verified only once a run passes on a free-plan account.

The teal round trip writes the home store into `<name>-agent`, and R2's REST API cannot list or empty a bucket without
S3 credentials, so the run's own non-empty bucket is a warned manual cleanup and the run passes; any other leftover
fails it (`triageLeaks` in `test/live/lib.ts`). The cleanup and the sweep delete only `fletch-ci-` names, checked again
before each DELETE, and never print the setup token or a recovery code. The sweep reads the first page of buckets
only (20): keep the throwaway account small, or run it again after deleting some.

