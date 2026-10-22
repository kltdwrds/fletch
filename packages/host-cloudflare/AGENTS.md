# packages/host-cloudflare

`@qyvr/host-cloudflare`, published: `@qyvr/host` on Cloudflare for one owner on one account. Secret-backed keys,
passkey login with sessions and recovery in the Company Durable Object's SQLite, and the provisioning library
(token scopes, the R2 bucket, the Vectorize index, Worker secrets) that `packages/create-fletch/` is built on.

## The one rule

Plain TypeScript over WebCrypto and `fetch`: no `cloudflare:workers` import and never the agent (`no-fletch` in
`scripts/check-boundaries.mjs`). The Durable Object is reached through a serialisable call, not imported.

## Layout

- `src/keys.ts`: `secretKeyService`; a blob wrapped for one tenant is refused for another, by the tenant field and
  then by the AEAD (`test/keys.test.ts`).
- `src/single-account.ts`: `singleAccountHost`; what one account cannot serve is refused with its
  `HOST_<FEATURE>_UNAVAILABLE` code (`test/single-account.test.ts`).
- `src/passkeys/`: the login routes, stores, page and WebAuthn verifier.
- `src/provision/`: `CloudflareApi` (the token is a constructor argument; `fetch` is injected) and the resources.

## Rules

- **Login** (`test/passkeys-routes.test.ts`): the first passkey needs the `SETUP_TOKEN` and fails closed without
  one; after it the token grants nothing; challenges are single use; state-changing routes need a same-origin
  `Origin`; the last passkey cannot be removed; a recovery session reaches only `/login` until a passkey is added.
  Every refusal is JSON with a `LOGIN_*`, `SESSION_*` or `RECOVERY_*` code.
- **Storage** (`test/passkeys-store.test.ts`): tokens and recovery codes are kept only as SHA-256 hashes; emails are
  normalised (`normalizeEmail`).
- **Provisioning** (`test/provision.test.ts`): every write is guarded by a read, so a second run changes nothing;
  an index of the wrong shape throws `MEMORY_INDEX_SHAPE`; an error message never carries the token.
- The login and provisioning codes are part of the published contract: renaming one is a one-way door.

## Tests, building and releasing

Tests in `packages/host-cloudflare/test/` with their fakes (`fake-cloudflare.ts`, `sql-adapter.ts`), run by the
root vitest config. Built and released exactly as `packages/host/AGENTS.md` describes.

## Keep this file true

Update it in the same PR as a change that makes a line untrue.
