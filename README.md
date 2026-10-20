# fletch

A self-hostable personal agent on Cloudflare, and the plain TypeScript primitives it runs on.

- `packages/agent` (`fletch-agent`, private): the agent Worker and its Durable Objects.
- `packages/host` (`@qyvr/host`): host contracts and logic with no platform imports.
- `packages/host-cloudflare` (`@qyvr/host-cloudflare`): the Cloudflare Durable Object implementation, and the
  provisioning library for one account (token scopes, bucket, memory index, Worker secrets).
- `packages/create-fletch` (`create-fletch`, private): the one command that sets fletch up on your account.

Apache-2.0. Contributions need a DCO sign-off (`git commit -s`).

```
pnpm install
pnpm check
pnpm accept F0
```

`pnpm accept <F<n>|F<n>.<p>>` runs lint, the hermetic tests, the agent's dry-run bundle, the secret and privacy
scans, the harness checks and typecheck, in that order, and ends with one `ACCEPT <id>: PASS` or
`ACCEPT <id>: FAIL (<step>)` line.

## Set up your own fletch

`create-fletch` runs from a checkout of this repository: the `wrangler.jsonc` it writes points `main` at this
checkout's `packages/agent/src/index.ts`, and `wrangler deploy` bundles the agent from there. It is not yet
published to npm, so `npm create fletch` arrives with Task 12.

```
pnpm install
mkdir ~/my-fletch && cd ~/my-fletch
CLOUDFLARE_API_TOKEN=... node ~/path/to/fletch/packages/create-fletch/src/index.ts \
  --name sam --owner-email sam@solo-sam.example --account-id <32-hex account id> [--paid]
```

(`pnpm create-fletch ...` at the checkout's root does the same, writing into the directory you ran pnpm from.)
It asks for anything not given. The token needs Workers Scripts (edit), R2 (edit), Vectorize (edit) and Workers AI
(read) on the account; a token lacking one is refused with `TOKEN_SCOPE_MISSING` naming it, before anything is
created. It then writes `wrangler.jsonc` into the directory (`--dir` to choose another), ensures the R2 bucket
`<name>-agent` and the Vectorize index `<name>-memory`, runs `wrangler deploy`, sets the `MASTER_KEY` and
`SETUP_TOKEN` Worker secrets when the Worker lacks them, and prints the `workers.dev` URL. The first run also
prints `<url>/login?setup=<token>`, the one link that registers the owner's passkey; it is shown only then. Run it
again at any time: a second run creates nothing, rotates no secret and prints the same URL. `--paid` adds the
Worker Loader (Code Mode) and Images bindings, which need the Workers Paid plan (see docs/DECISIONS.md).

## Origin

The agent, its tests and the acceptance harness were copied from qyvr-co at commit `81f55d0` (qyvr-co 81f55d0),
with the platform's code (dispatcher, tail, mail and provisioning Workers, the upstream workspace adapter, the
staging probes and the render sidecar) left behind.
