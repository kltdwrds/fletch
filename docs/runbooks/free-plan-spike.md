# Free-plan spike: Code Mode and Images

Decides whether `create-fletch` adds the Worker Loader (`LOADER`) and Images (`IMAGES`) bindings by default or only
with `--paid`. The open question and its result table live in `docs/DECISIONS.md`.

## When

Once, on a throwaway free-plan account, and again if Cloudflare changes the free plan's bindings.

## Steps

1. With the account's `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` in your environment, run the spike; it
   deploys small Workers named `fletch-spike-<8 hex>` and deletes them in a `finally`:

   ```
   node scripts/spike-bindings.ts
   ```

2. Paste the table it prints into `docs/DECISIONS.md` and change the spike's status to CLOSED.
3. If the free plan accepts a binding, the change to `create-fletch`'s default is a PR of its own.
