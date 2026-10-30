# @qyvr/host-cloudflare

The Cloudflare implementation of [`@qyvr/host`](../host) for one owner on one account, and the library that
provisions that account.

```ts
import { singleAccountHost } from "@qyvr/host-cloudflare";

const host = singleAccountHost(env); // env: TENANT_ID, TENANT_SHAPE, OWNER_EMAIL, MASTER_KEY, COMPANY, SETUP_TOKEN?
```

- `singleAccountHost(env)`: a `Host` with `secretKeyService` (a master key held as a Worker secret), passkey
  sign-in for the one owner (WebAuthn through `@simplewebauthn/server`), console reporting, and no budget cap.
  Mail, workspace, provisioning, members and render are refused with `HOST_<FEATURE>_UNAVAILABLE`.
- Passkeys, sessions and recovery codes live in the `COMPANY` Durable Object's SQLite storage.
  `runLoginCall(storage, now, call)` runs one login operation over that storage, and the stores
  (`PasskeyStore`, `SessionStore`, `RecoveryStore`) are exported.
- Provisioning, given an API token and an account id: `CloudflareApi`, `tokenScopes` (the read probes for each
  needed permission), `ensureBucket`, `ensureVectorIndex`, `listSecrets`, `putSecret`, `workersDevUrl`,
  `mintMasterKey`, `mintSetupToken`. Every write is guarded by a read, so running it twice writes nothing twice.
  They serve a setup that holds an API token; the `fletch` repository's own deploy runs on wrangler's login instead.

The code imports nothing from `cloudflare:workers`: it is plain TypeScript over WebCrypto and `fetch`, and it
names Workers runtime types (`DurableObjectNamespace`, `SqlStorage`) in its signatures, so install
`@cloudflare/workers-types` for the types.

Apache-2.0. Source and issues: <https://github.com/qyvr-ai/fletch/tree/main/packages/host-cloudflare>.
