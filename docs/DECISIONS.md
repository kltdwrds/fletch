# Decisions

## Spike: Code Mode and Images on the free plan

Status: OPEN. Nobody has run it yet; Cloudflare was not touched while this was written.
Follow-up: verify on a Free-plan account.

Run it on a throwaway free-plan account (it deploys small Workers named `fletch-spike-<8 hex>` and deletes them in a `finally`):

```
CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... node scripts/spike-bindings.ts
```

Paste the table it prints below and change the status to CLOSED.

| Binding | Wrangler binding | `wrangler deploy` accepts it on the free plan | A call succeeds | Error text if refused |
| --- | --- | --- | --- | --- |
| Worker Loader (Code Mode) | `worker_loaders` (`LOADER`) | OPEN | OPEN | OPEN |
| Images (HEIC to JPEG) | `images` (`IMAGES`) | OPEN | OPEN | OPEN |

Whatever the result, the agent already behaves correctly: `LOADER?` and `IMAGES?` are optional in `packages/agent/src/env.d.ts`, Code Mode refuses with `HOST_CODE_UNAVAILABLE` and a HEIC upload with `HOST_IMAGES_UNAVAILABLE`, both with a reason in words (`test/workers/f1-refusals.test.ts`). The spike only decides whether `create-fletch init` adds the bindings by default or only with `--paid`.

## Decisions taken

- **Code Mode and Images are not in the base `wrangler.jsonc`.** Task 5 removed `worker_loaders` and `images` from `packages/agent/wrangler.jsonc`, because `wrangler types` would otherwise generate them as required members of `Env`. `create-fletch init --paid` adds them back (Task 11).
- **Refusals carry the host code.** A missing Worker Loader refuses with `HOST_CODE_UNAVAILABLE`; a HEIC without the Images binding, and any AVIF (Enterprise-only), refuses with `HOST_IMAGES_UNAVAILABLE` (renamed from `IMAGE_CONVERT_UNAVAILABLE`), each with its own reason in words.
- **WebAuthn uses `@simplewebauthn/server` 14.0.3.** It bundles under `nodejs_compat`, so there is no hand-rolled fallback.
- **First registration requires a one-time `SETUP_TOKEN` minted by `init`.** A public `workers.dev` URL would otherwise hand ownership to the first visitor.
- **`@noble/hashes` 2.4.0 provides synchronous SHA-256 in the stores.**
