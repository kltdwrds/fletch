# packages/host

`@qyvr/host`, published: the contracts a personal agent is written against (`Host`: keys, budget, identity, mail,
workspace, provisioning, members, reporter, render) and the platform-free logic beside them. A platform supplies the
implementation; `packages/host-cloudflare/` is the first.

## The one rule

No platform and no app. Nothing here imports a `cloudflare:` specifier or the agent, so a stranger can build another
agent on it (`no-cloudflare-workers` and `no-fletch` in `scripts/check-boundaries.mjs`).

## Rules

- A missing capability is refused, never empty: `unavailable()` returns `{ ok: false, code, reason }` with the code
  `HOST_<FEATURE>_UNAVAILABLE`, and `HostFailureCode` rejects any other shape (`packages/host/test/host.test.ts`).
- Adding a `HostFeature` adds its refusal code; the agent shows it to the owner by name.
- Refusal codes are a published contract (`KeyFailureCode`, `IdentityRefusal`, `SealCode`, `WorkspaceRefusalCode`):
  renaming one is a breaking change and a one-way door (AGENTS.md, Decisions).
- `src/` is flat: one module per contract, re-exported from `packages/host/src/index.ts`.

## Building and releasing

Inside the workspace it runs from source under the `development` condition; `pnpm build` here writes the dist
folder with `tsconfig.build.json` and rewrites the `.ts` imports in the declarations (`scripts/rewrite-dts.mjs`).
`scripts/publish-manifests.test.mjs` holds the published exports to the built files. A change to the public surface
carries a changeset (`docs/runbooks/release.md`).

## Tests

`packages/host/test/`, run by the root vitest config under the hermetic setup (`pnpm test`).

## Keep this file true

Update it in the same PR as a change that makes a line untrue.
