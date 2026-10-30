# packages/agent

`fletch-agent`, private: the agent Worker and its Durable Objects. One deploy serves one owner on their own
account. Config: `packages/agent/wrangler.jsonc`; entry: `packages/agent/src/index.ts`.

## The one rule

Every platform service comes through the host seam: `setHost` installs `singleAccountHost` once in the entry module,
and code reaches it with `hostOf`. What the host cannot serve is refused with its `HOST_<FEATURE>_UNAVAILABLE` code
and shown to the owner by name, never as empty or success (`test/workers/f1-refusals.test.ts`,
`test/workers/f1-host.test.ts`).

## Rules a change most often meets

- **One network path.** A global `fetch` appears only in `packages/agent/src/egress/outbound.ts`; everything else
  goes through it or a named binding (`agent-fetch` in `scripts/check-boundaries.mjs`, `test/m25/`). Only the egress
  path resolves a `cred://` reference.
- **One file vocabulary.** File tools are defined only in `packages/agent/src/files/tools.ts`, and only
  `packages/agent/src/tree/` imports `@cloudflare/computer` (`file-vocabulary*`, `test/m24/`).
- **One model path.** The model is called only from `packages/agent/src/model/`: Workers AI over the `AI` binding,
  through a gateway only when `AI_GATEWAY_ID` is set, and Meta's Muse Spark for chat only when `CHAT_PROVIDER=meta`
  is set with it; no fallback model, and invalid vars fail every call by name (D-0020, `test/workers/f1-models.test.ts`).
- **Migrations are append-only**, one list per object in `packages/agent/src/migrations/`, run in the constructor.
- **Paid-plan bindings are optional.** `LOADER` and `IMAGES` are not in the base config, so `wrangler types` keeps
  them optional in `packages/agent/src/env.d.ts`; `create-fletch --paid` adds them.
- **Generated files.** `packages/agent/src/http/app/tokens.ts` and `icons.ts` come from `pnpm ds`; the pre-commit
  hook refuses a hand edit. The design sources are under `packages/agent/src/design/`.
- **Platform docs are for the model.** `packages/agent/docs/platform/` holds manuals the agent reads at run time
  (`skill_read docs/<slug>`, read-only: `DOCS_READ_ONLY`), each with `summary` and `read_when` frontmatter; the
  index in `packages/agent/src/skills/platform-docs.ts` must match the folder.
- Files stay under 600 lines: split, never allowlist.

## Layout

One folder per concern under `packages/agent/src/`; `src/objects/` holds the Durable Object classes (`PERSON`,
`COMPANY`, `CHAT`, `JOB`, `INGRESS`, `LEDGER`, `VAULT`), `src/chat/` the turn engine, `src/http/` the routes and pages,
`src/vault/` sealed secrets and the egress allowlist. Read the folder's own module comments before changing it.

## Tests and deploy

No tests in the package: they live in the root `test/workers/`, `test/scenarios/` and `test/m*/`, under the
hermetic setup with the test host from `test/support/host.ts`. There is no build; `pnpm accept` bundles the Worker
with `wrangler deploy --dry-run`, and `create-fletch` deploys it from the checkout.

## Keep this file true

Update it in the same PR as a change that makes a line untrue.
