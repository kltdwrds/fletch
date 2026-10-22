# Free-plan spike: Code Mode and Images

Decides whether `create-fletch` adds the Worker Loader (`LOADER`) and Images (`IMAGES`) bindings by default or only
with `--paid` (D-0004 holds the current answer, `--paid` only; the question is Q2 in `docs/plan/QUESTIONS.md`). Whatever
the result, the agent already behaves correctly: `LOADER?` and `IMAGES?` are optional in `packages/agent/src/env.d.ts`,
and without them Code Mode refuses with `HOST_CODE_UNAVAILABLE` and a HEIC upload with `HOST_IMAGES_UNAVAILABLE`.

## Results

Not run yet.

| Binding | Wrangler binding | `wrangler deploy` accepts it on the free plan | A call succeeds | Error text if refused |
| --- | --- | --- | --- | --- |
| Worker Loader (Code Mode) | `worker_loaders` (`LOADER`) | OPEN | OPEN | OPEN |
| Images (HEIC to JPEG) | `images` (`IMAGES`) | OPEN | OPEN | OPEN |

## When

Once, on a throwaway free-plan account, and again if Cloudflare changes the free plan's bindings.

## Steps

1. With the account's `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` in your environment, run the spike; it
   deploys small Workers named `fletch-spike-<8 hex>` and deletes them in a `finally`:

   ```
   node scripts/spike-bindings.ts
   ```

2. Paste the table it prints over the one under Results, with the date, and answer Q2 with it.
3. If the free plan accepts a binding, propose a record that supersedes D-0004 (`docs/decisions/README.md`); the
   change to `create-fletch`'s default is a PR of its own.
