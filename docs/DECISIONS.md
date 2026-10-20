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
- **`create-fletch` deploys from a fletch checkout.** The `wrangler.jsonc` it writes sets `main` to the checkout's `packages/agent/src/index.ts` (a path relative to the written file), and `wrangler deploy` runs as a child process with the wrangler `create-fletch` depends on. Publishing the agent as a package for `npm create fletch` is Task 12.
- **`init` sets two Worker secrets, each only when missing:** `MASTER_KEY` and `SETUP_TOKEN` (both 32 random bytes, base64url). A fresh account gets two secret puts, a second run none. The setup link is printed only by the run that minted `SETUP_TOKEN`.
- **`tokenScopes(cf, accountId)` takes the account id**, which the per-scope probes and the account-token verify endpoint need.

## F1 exit test: written, not yet run

Status: OPEN. The test is written and its pure helpers are tested hermetically; nobody has run it against Cloudflare, and the tag `v0.1.0` waits for a passing run.

`test/live/f1-deploy.live.test.ts` calls `init()` against a throwaway account (Worker `fletch-ci-<run id>`, `paid: false`, owner `sam@solo-sam.example`, a temp `--dir`), then walks the ten-minute path: `/health` lists seven objects, `/app/chats` is `401 SESSION_MISSING`, `/login?setup=` is the register page, a software ES256 passkey registers with the setup token and yields a recovery code, a chat remembers "my favourite colour is teal" and answers it in a new chat, deleting the only passkey is refused with `LOGIN_LAST_PASSKEY`, a second passkey is added and one deleted, and the recovery code signs in once and then fails with `RECOVERY_CODE_SPENT`. It prints the wall-clock time (measured, not asserted). `afterAll` always deletes the Worker, the bucket `<name>-agent` and the index `<name>-memory`, and only names that start with `fletch-ci-`.

Run it (the command Kyle runs):

```
QYVR_LIVE=1 CF_LIVE_ACCOUNT_ID=... CF_LIVE_TOKEN=... pnpm vitest run test/live/f1-deploy.live.test.ts
```

`pnpm accept F1` runs the same file as its `live` step under those variables, and otherwise prints `live: skipped (no account)` and passes. `.github/workflows/live-deploy.yml` runs it on manual dispatch and when a release is published, from the secrets `CF_LIVE_ACCOUNT_ID` and `CF_LIVE_TOKEN`, and fails with the missing names if either is absent. The tag `v0.1.0` follows a passing run.
