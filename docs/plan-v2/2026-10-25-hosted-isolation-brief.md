# Hosted fletch with Muse-grade isolation — design brief

Written 2026-10-25 from a read of `muse/` (the harness spec and v1 plan), `fletch/` (the code), `qyvr-co/`
(the Workers for Platforms prototype) and the qyvr v1 spec on kltdwrds/qyvr#202. Status: proposal for Kyle.
Nothing here is decided.

## The question

qyvr.ai hosts fletch. Anyone signs in, gets their own instance, plays with the qyvr primitives through it, and
deploys their own artifacts that use the same primitives. The promise to that person: no app-level bug in
fletch, whether an accident or an exploit, can expose them to another instance or another instance to them.
How do we get what Muse's per-user VM gives, on Cloudflare, without changing fletch's shape?

## What Muse's boundary actually is

One user, one persistent Linux VM, one agent (`muse/plan/muse-reference.md` §1, harness spec §2). Everything
the agent can touch is inside that VM: filesystem, browser, memory index, surrogate tokens. Credentials are
references; an egress proxy swaps the real value in for approved hosts. The control plane is reached over Unix
sockets. The guarantee is that the OS, not the harness, holds the line: a bug in the harness exposes that
user's VM to that user's attacker and nobody else.

The property to copy is not "a VM". It is **the unit of compute is the unit of ownership, and every resource
the unit can reach is attached to it by the platform, not looked up by code.**

## Where fletch stands today (from the code)

fletch was cut out of qyvr-co's multi-tenant deploy and still carries that shape inside one script. One deploy
is one tenant (`packages/agent/src/index.ts:1-4`), and inside the deploy:

- Company, Ledger and Vault are singletons named by `TENANT_ID`; Person is named by the raw email, Chat by a
  UUID, Job by `owner/id`. Nothing but the three singletons carries the tenant in its name.
- Identity crosses into objects as a plain argument (`by`, `requester`, `ctx.person`) or the `x-qyvr-person`
  header the WebSocket forward overwrites. No object authenticates its caller; any code in the script can name
  anyone (`chat/engine.ts:121-126`, `grants/authority.ts:61`).
- One R2 bucket with `person/<email>/…` prefixes built by `homeKey`; one Vectorize index with a namespace per
  store; one Vault data key for every person, rows separated by an `owner` column. `Job.register(path)` reads
  the bucket with no prefix check (`jobs/engine.ts:141-149`).
- Egress is one module (`egress/outbound.ts`), enforced by a lint rule. `global_fetch_strictly_public` is set.
  The Browser binding and the AI binding are network paths outside it.
- Code Mode runs a Dynamic Worker from the Chat object with no `env`, `globalOutbound` set to the script's own
  `Egress` entrypoint, 5 s CPU, 20 subrequests, 64 KB script; raw sockets refused.

Every per-person boundary inside a script is a string that code passes. The platform guarantees only: this
script reaches these bindings; this Dynamic Worker has no bindings and this outbound; these CPU and subrequest
caps. Decision D-0008 records the matching account-level gap: Cloudflare does not check a binding against the
deploying token, so any token that can deploy can bind any bucket on the account.

The qyvr v1 spec as it stands (PR #202) makes this worse, not better, for the hosted case. B9: "One
multi-tenant Worker, one DO per account. No WfP script per tenant." That puts every account's Person, Chat,
Vault rows and bucket prefixes inside one script, separated only by the strings above. The spec's own
isolation evidence is the planted impersonation test (B23), which proves the primitives refuse a wrong actor,
not that the fletch Worker cannot reach a wrong account.

## What qyvr-co already proved (measured on staging)

- One dispatch namespace, one user Worker per tenant, its own R2 bucket, Vectorize index and Durable Object
  namespaces; zero per-tenant account Workers; shared stateless platform Workers reached through service
  bindings with `props: { tenant }` written last by the dispatcher.
- Cloudflare enforces no tenancy inside an account: a probe read and wrote another tenant's KV. The tenant
  boundary is platform-generated config plus the binding audit (`scripts/platform/audit.ts`, AD-20): hash-gated
  upload, allowlisted binding types, no foreign DO `script_name`, only own bucket, no secrets in vars, no other
  tenant's identifiers anywhere in the config, live read-back.
- Script-level `limits` are always enforced, Durable Objects included. The outbound Worker does not see DO
  fetches or loader code, so egress is defence in depth, never the boundary.
- Worker Loader works from a DO with `globalOutbound = ctx.exports.Egress({props})`. Facets, alarms, Vectorize,
  Browser Run, Containers and tail consumers work in a user Worker. Crons, Queue consumers and Workflows do not.
- Scale exercised: three tenants. Capacity was bounded by Access apps (500) and seats (50), not by scripts.

## The design: one script per account, fletch is the first artifact

Collapse tenant and person. Each qyvr account gets its own user Worker, `fletch-<account>`, in one untrusted
dispatch namespace, with resources that exist for that script alone. Inside the script fletch is unchanged:
seven Durable Object classes, `TENANT_SHAPE = standalone`, a Company of one. Every code-enforced per-person
boundary listed above becomes vacuous because the script has one person, and the platform enforces the
per-script boundary.

### Per account (attached by the provisioner, checked by the audit)

| Resource | Name | Enforced by |
|---|---|---|
| User Worker | `fletch-<account>` in namespace `qyvr-users` (untrusted mode) | runtime: isolate per script, isolated cache, no `request.cf` |
| DO namespaces | Person, Company, Chat, Job, Ingress, Ledger, Vault, owned by the script | runtime: a DO namespace belongs to its script; no cross-script binding ever generated |
| R2 | bucket `qyvr-u-<account>` | binding: only this script binds it, this script binds only it |
| Vectorize | index `qyvr-u-<account>-memory` | binding, same rule |
| Secrets | `MASTER_KEY` (random per account), `QYVR_DELEGATE` (the owner's delegate credential, minted by identity for this instance) | per-script secret; never a shared master key with tenant AAD |
| Vars | `OWNER_ACCOUNT`, `TENANT_ID = <account>`, `QYVR_ENV = hosted` | audit |
| Limits | script-level `cpu_ms`, `subrequests` | runtime, always enforced |
| Service bindings | `IDENTITY`, `FEED`, `INDEX`, `PLATFORM` (budget, mail seal, provisioning) with `props: { owner: <account> }` | audit; the callee derives the actor from `ctx.props`, never from the request |
| Code Mode | Worker Loader from the Chat DO, as today | runtime: no `env`, `globalOutbound` pinned, caps |

Capacity on one account: scripts unlimited, DO namespaces unlimited, R2 buckets 1,000,000, Vectorize indexes
50,000 on Workers Paid. Vectorize is the first ceiling. No Access apps, so qyvr-co's 500-tenant cap is gone.

### The shared layer (the only code-enforced boundary left)

1. **Dispatcher.** `<handle>.qyvr.dev` → KV `host:` → `fletch-<account>`. Strips `x-qyvr-*`, writes
   `props.owner` last, applies limits. qyvr-co's `packages/platform/dispatcher` with Access removed.
2. **Provisioner.** Generates the config above, runs the offline audit, uploads with the hash gate, tags
   `owner:<account>` and `release:<r>`, writes the KV record last. qyvr-co's `scripts/platform/{config,
   generate,audit,cli}.ts` ported to a platform Worker (a Workflow on an account Worker is fine; Workflows run
   there). It is the only holder of a deploying token.
3. **Primitives.** identity, feed, index as in the v1 spec. Each call carries the actor's credential and the
   primitive resolves it (B3) **and** receives `props.owner` from the binding; a mismatch is refused. Two
   independent facts must agree, and the planted impersonation test (B23) covers both.

Three checks that must all fail for a cross-account read: the dispatcher routes to the wrong script, the
script's own `props.owner === OWNER_ACCOUNT` check (fletch's existing `TENANT_MISMATCH`, `http/serve.ts:29`)
passes anyway, and the session subject equals the owner. The first is the only one with any reach, and a
wrong route lands on a script that holds the wrong owner's secrets and refuses the session.

### Identity and the front door

Sign in at `qyvr.ai` (OAuth with PKCE, B5 and B25). Each instance is a registered client with redirect
`https://<handle>.qyvr.dev/callback`. The instance verifies the credential through `IDENTITY.resolve`,
refuses any subject other than `OWNER_ACCOUNT`, and sets a `__Host-` cookie, host-only. Never a `.qyvr.dev`
cookie (fletch's log already refuses that for preview slots). Passkeys stay behind the host seam for
self-host; hosted fletch does not run its own login.

Artifacts a person deploys are user Workers in the same namespace, `art-<account>-<slug>`, served at
`<slug>-<handle>.qyvr.page`, with the same owner-scoped primitive bindings (B21) and their own storage.
fletch deploys them through the `PLATFORM` binding's provisioning entrypoint, scoped by props; fletch never
holds a Cloudflare API token. So the user's fletch and the user's artifacts are the same kind of thing, and
"fletch is the first artifact in your namespace" is both the mental model and the implementation.

Submit `qyvr.page` and the tenant subdomain of `qyvr.dev` to the Public Suffix List so one artifact cannot
set a cookie another reads.

### fletch changes (small, and all behind the seam fletch already has)

- A `platformHost` implementation of `Host` (`packages/host/src/host.ts:24-40`): `identity` from the
  `IDENTITY` binding; `keys` from the per-script `MASTER_KEY`; `budget`, `mail`, `provisioning` and `render`
  from the `PLATFORM` binding; `members` refused with `HOST_MEMBERS_UNAVAILABLE`; `tenant.shape = standalone`,
  `env = hosted`. Installed by a second entry module; `singleAccountHost` is untouched.
- `apps/qyvr-ai` "Get fletch" button → provisioner → instance ready, roughly ten seconds. Delete keeps the
  bucket and index 30 days for export, then purges.
- Fix the latent prefix hole in `Job.register` regardless; it is a bug in any shape.

### What this overturns in the v1 spec

- **B9** → "One user Worker per account in the dispatch namespace, provisioned by the platform; fletch is the
  first artifact." The Agents SDK's per-DO isolation is not a tenancy boundary.
- **B21**, last clause → fletch is not multi-tenant, so it gets owner scoping from the dispatcher like any
  artifact, in addition to carrying a credential (B3). Both are checked.
- **B6** stands and now covers fletch: the config generator and binding audit are the tenant boundary.
- **B10** stands. The same agent code runs under `singleAccountHost` on the person's own account through
  `pnpm self-host`; hosted and self-host differ only in which `Host` is installed (D-0003 already requires this).
- M1's "one DO per account" line becomes "one script per account", and M0 gains the provisioner port.

### Honest residue

- **Not sovereign.** qyvr holds the account. An operator can deploy code to any script and read its secrets.
  The claim is isolation from other users and from app bugs, not from the operator. The exit is
  `pnpm self-host` on the person's own account plus an export (bucket, DO dumps, vault re-sealed to a key the
  person supplies). State this on the sign-up page.
- **The network plane is code-isolated by nature.** identity, feed and index are multi-tenant services. A bug
  there leaks network data (claims, feed events, handles), which is public-ish by design, never the instance's
  memory, files or vault.
- **Operator-visible telemetry.** AI Gateway payload logging off, metadata only; tail logs redacted. One shared
  gateway is fine; one shared log store with payloads is not.
- **Egress is per-instance, not platform.** DO fetches bypass the outbound Worker, so the allowlist, credential
  placement and surrogate swap live in the instance's own Vault code. A bug there exposes that instance's own
  credentials to that instance's own model-written code. The Browser binding has no host allowlist today.
- **Releases.** No gradual deploys for user Workers. Canary first, then tenant by tenant behind a health gate
  (qyvr-co's `rollout.ts`), migrations forward-only. At ten thousand instances a release is roughly an hour of
  API calls at the 1,200 per five minutes limit.
- **The audit cannot see props live.** Service-binding props are verified in generated config, not read back.
  The callee-side `props.owner` check and the script's own `OWNER_ACCOUNT` var are the compensations.
- **Unmeasured.** Per-script secret upload in the namespace at this scale, provisioning latency, Worker Loader
  cost. Spike before M0 commits.

## Alternatives considered

- **A. Keep B9: one shared fletch Worker, one DO per account.** Cheapest to build. Every boundary is a string
  in code; one IDOR or one injection-to-Code-Mode in fletch is a cross-account read. Fails the stated promise.
- **B. One user Worker per account in a dispatch namespace (this brief).** Platform-enforced resource
  isolation; the code-enforced surface shrinks to the dispatcher and the provisioner audit, both already
  written in qyvr-co. Costs Workers Paid plus Workers for Platforms.
- **C. One Cloudflare account per person.** The strongest boundary and the only sovereign one. Cloudflare's
  tenant and sub-account APIs are partner-gated, so it is not self-serve for qyvr to run; bring-your-own-account
  is fletch's existing self-host path. Keep it as the graduation, not the hosted design.

Recommendation: B, with C as the exit everyone is told about on day one.

## Spikes before committing (each a day or less, on the existing staging namespace)

1. Upload a fletch script with per-script secrets and seven DO classes into the namespace through the API;
   confirm `MASTER_KEY` is script-scoped and the DO namespaces are not reachable from a sibling.
2. Two instances, two accounts: run the impersonation case end to end through the dispatcher and the
   primitives; confirm a forged `props.owner` from a sibling is refused (error 10143 on the binding, then the
   callee check).
3. Provision a hundred instances in a loop; measure wall time and API rate-limit behaviour.

## Addendum: keeping fletch separate from its deployment (the qyvr canon)

Two axes, never mixed. **Who runs you** is a `Host`. **Who you talk to** is the network, reached through
`@qyvr/sdk`. fletch is a client of both and owns neither.

| | self-hosted, own account | qyvr.ai hosted |
|---|---|---|
| Host | `@qyvr/host-cloudflare` (`singleAccountHost`): passkeys, own `MASTER_KEY`, wrangler provisioning | `@qyvr/host-platform` (`platformHost`): identity binding, per-script secret, `PLATFORM` service binding |
| Network | `sdk.fromHttp({baseUrl, credential})`: the wire path, OAuth delegate credential | `sdk.fromBindings(env)`: owner-scoped RPC bindings, props set by the audit |
| fletch | identical | identical |

Layers, bottom up, each a published package with a boundary check:

1. **`@qyvr/protocol`** — the wire canon: event kinds, signed-claim and feedback shapes, the credential format,
   the HTTP and MCP surfaces of identity, feed, index and forge. No code that runs a service. This is what the
   community implements against; a self-hoster, a CLI, a competitor's agent all speak it.
2. **`@qyvr/sdk`** — one interface to the primitives, two transports, one conformance suite run over both
   (the impersonation case included). `fromBindings` may be faster and token-free; it may never be *able to do
   more* than `fromHttp`. A hosted-only capability is a bug in the canon, not a feature.
3. **`@qyvr/host`** — what a deployment supplies to an agent: identity verification, keys, budget, mail,
   provisioning (deploy an artifact), render, reporter, members. Platform-free; every missing capability is a
   `HOST_<FEATURE>_UNAVAILABLE` refusal (D-0001). A **Host conformance suite** (the adapter contract suite F0
   left in qyvr-co, revived) runs over every implementation.
4. **Host implementations** — `host-cloudflare` (self-host, today), `host-platform` (hosted, new),
   `host-local` later (wrangler dev / workerd). None imports the app (D-0003).
5. **fletch** — imports `@qyvr/sdk` and `@qyvr/host` only. The boundary check already in the v1 spec
   ("fletch imports `@qyvr/sdk` only") widens to those two.

Rules to adopt now, each held by a check:

- **No deployment branch in the app.** fletch reads `host.tenant.shape`, never `QYVR_ENV`, `TENANT_SHAPE` or
  a binding name. Today the app is already clean except `env.TENANT_ID` in DO names and `/whoami`; move the
  tenant id behind `host.tenant.id`.
- **Identity is a protocol, not a service.** The root is the person's own key (B5); qyvr.ai is custody, a
  handle and OAuth convenience. A self-hoster may hold their own key and their own NIP-05 domain and still be
  a first-class actor on the network.
- **Hosted convenience, never hosted capability.** Bindings, one-click artifact deploy and the namespace are
  faster paths to things the wire path and `pnpm self-host` also reach. Each hosted-only shortcut names its
  self-host equivalent in the docs.
- **One instance bundle.** Define the export format now (R2 tree, DO SQLite dumps, vault re-sealed to a key the
  person supplies, the delegate credential revoked) even if the tool ships later. It is the same bundle in both
  directions: hosted → own account, own account → hosted.
- **The provisioner is a Host service.** The dispatcher's keys, budget, mail seal, provisioning and members
  entrypoints from qyvr-co are `Host` concerns; identity, feed, index and forge are network concerns. The two
  lists never share a package.

What this costs in v1: keep `packages/host` and `packages/host-cloudflare` alive in the monorepo (REPO-MIGRATION
currently drops `packages/host`), add `host-platform`, add the Host conformance suite beside the sdk one. Self-host
tooling can stay out of v1 (B10); the seams cannot.
