# fletch

A self-hostable personal agent on Cloudflare, and the plain TypeScript primitives it runs on.

- `packages/agent` (`fletch-agent`, private): the agent Worker and its Durable Objects.
- `packages/host` (`@qyvr/host`): host contracts and logic with no platform imports.
- `packages/host-cloudflare` (`@qyvr/host-cloudflare`): the Cloudflare Durable Object implementation.

Apache-2.0. Contributions need a DCO sign-off (`git commit -s`).

```
pnpm install
pnpm check
pnpm accept F0
```

`pnpm accept <F<n>|F<n>.<p>>` runs lint, the hermetic tests, the agent's dry-run bundle, the secret and privacy
scans, the harness checks and typecheck, in that order, and ends with one `ACCEPT <id>: PASS` or
`ACCEPT <id>: FAIL (<step>)` line.

## Origin

The agent, its tests and the acceptance harness were copied from qyvr-co at commit `81f55d0` (qyvr-co 81f55d0),
with the platform's code (dispatcher, tail, mail and provisioning Workers, the upstream workspace adapter, the
staging probes and the render sidecar) left behind.
