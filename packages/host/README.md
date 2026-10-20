# @qyvr/host

The host contracts of a personal agent, and the logic that has no platform in it. An agent is written against
`Host`; a platform supplies one. No import from Cloudflare, and none from any app.

```ts
import { unavailable, type Host } from "@qyvr/host";
```

- `Host`: the tenant, `keys` (wrap and unwrap a data key), `budget` (or `null` for no cap), `identity`, `reporter`,
  and the services a host may lack: `mail`, `workspace`, `provisioning`, `members`, `render`.
- `unavailable(feature, reason)`: the refusal for a service the host lacks, `{ ok: false, code:
  "HOST_<FEATURE>_UNAVAILABLE", reason }`. Callers show the reason; they never treat a refusal as success or as empty.
- Types for `Identity`, `KeyService`, `BudgetService`, `MailService`, `WorkspaceService` and `Reporter`.

`@qyvr/host-cloudflare` is the implementation for one Cloudflare account.

The types use the web-standard `Request`, `Response` and `URL`. Install `@cloudflare/workers-types` (or have the
DOM or Node types) in your project so they resolve.

Apache-2.0. Source and issues: <https://github.com/qyvr-ai/fletch/tree/main/packages/host>.
