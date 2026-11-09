# Previews: a slot of fletch on Cloudflare

A preview slot is the agent from a worktree, uncommitted changes included, deployed to its own Worker, bucket, memory
index and `workers.dev` host. A session leases one, deploys to it, tries things against real Cloudflare (Workers AI,
Vectorize, Durable Objects, a real passkey sign-in), and releases it, with no PR and no CI, from Kyle's Mac or a
Claude Code cloud session. Nothing a session holds can redeploy or delete production (D-0008, which also names what it
can still reach). The code is `scripts/preview.mjs` (leases), `scripts/preview-pool.mjs` (provisioning),
`scripts/preview-plan.mjs` (names, configs, the deletion guard) and `scripts/preview-slot/` (what a slot's Worker
runs); it is qyvr's `pnpm preview` ported, with qyvr's traps already handled.

## When

- You need fletch on real Cloudflare: a binding the hermetic suite fakes, a model call, a passkey in a real browser.
- Kyle sets up or grows the pool, or rotates its token (`## Steps: the pool`).

## Steps: using a slot

Run `pnpm install` first, then `pnpm preview doctor` once in a new environment.

| Command | Does |
|---|---|
| `pnpm preview up` | Leases a free slot (or renews this worktree's lease) and deploys the working tree to it. A new lease starts empty, with new `MASTER_KEY` and `SETUP_TOKEN`, and prints the setup link for the first passkey. `--slot n` asks for one, `--ttl hours` sets the lease (24 by default; every `up` renews it), `--paid` adds the Worker Loader and Images bindings as `pnpm self-host --paid` does, `--render` adds the Renderer (the pandoc container behind "Make me an artifact", one `lite` instance, Workers Paid; the credential needs Account > Workers Containers > Write, else `PREVIEW_RENDER_TOKEN` before anything is deployed; D-0031), `--var K=V` (repeatable) overrides one of the model vars `AI_GATEWAY_ID`, `CHAT_PROVIDER` that the base config sets (`packages/agent/wrangler.jsonc`, read by `packages/agent/src/model/routes.ts`): without one the slot's chat runs on Muse Spark through the gateway `qyvr`, and `--var CHAT_PROVIDER=workers-ai` puts it on GLM 5.3 Flash, still through that gateway; any other key is refused; an override lasts until the next `up` without it. |
| `pnpm preview status` | This worktree's lease, what the slot serves, its `/health` (whose `deploy` is the commit the slot was deployed from), and the setup link again. |
| `pnpm preview tail` | `wrangler tail` on the slot's Worker. |
| `pnpm preview down` | Releases the slot: the placeholder deployed (which deletes every agent Durable Object and its storage), new secrets, the bucket and the index emptied, every session key deleted, the lease ended. |
| `pnpm preview gc` | Releases every slot whose lease expired or whose branch's PR merged (`--dry-run` says which), never the staging slot. On Kyle's login, `--slot n --force` releases one live lease: a slot whose holder lost its key. |
| `pnpm preview list` | Every slot and its lease; the staging slot says `staging`. |
| `pnpm preview doctor` | Which credential is in use, whether the network accepts it, whether each slot answers, and the hosts to allow. |

Slot `n` answers at `https://fletch-pv-<n>.<subdomain>.workers.dev`. Its tenant is `fletch-pv-<n>` and its owner the
fixture person, `sam@solo-sam.example`. Open the setup link `up` printed to register a passkey; a released slot
answers 503.

`pnpm preview down` before your branch's PR merges. `gc` is the backstop, and an unrenewed lease expires after a day.

Slot 1 is the staging slot (next section): `up` never takes it and a branch gets slot 2 or 3.

## Staging: slot 1, main on every merge

Slot 1 (`fletch-pv-1`) is staging: main, deployed on every push to main, holding Kyle's passkey and workspace for UAT
(his and Muse's). The inventory marks it (`"staging": true` in `scripts/preview-pool.json`), and once converted its
lease row says `staging` and never expires. The code is `scripts/preview-staging.mjs`.

| What | Does to slot 1 |
|---|---|
| `pnpm preview up` | Never takes it: `--slot 1` is refused with `PREVIEW_SLOT_STAGING`; without `--slot` it takes slot 2 or 3. A worktree whose lease file still names slot 1 lets that file go and takes another. |
| `pnpm preview gc` | Never releases it, whatever its lease says: no expiry, no merged-branch check. `gc --slot 1 --force` is refused with `PREVIEW_SLOT_STAGING`. |
| `pnpm preview down` | From a worktree whose lease file names slot 1: refused with `PREVIEW_SLOT_STAGING`, the stale file dropped, the slot untouched. `down --slot 1` is refused unless `--force` on Kyle's login (next row). |
| `pnpm preview down --slot 1 --force` | (Kyle's login) Unstages and releases it as `down` releases a lease: placeholder, new secrets, bucket and index emptied. Its data is gone. The inventory mark stays, so no branch takes it until a PR removes the mark. |
| `pnpm preview list` | `staging (main, deployed on merge; serving …)`, or `staging, not converted yet: …` before the conversion. |
| `pnpm preview staging status` | Its lease, what it serves and its `/health`. |
| `pnpm preview staging deploy` | Redeploys main: refused unless the checkout is the `main` branch or detached at `origin/main`, with no change to a tracked file and the lease says staging (`PREVIEW_STAGING_NOT_CONVERTED`). It is one `wrangler deploy` of the agent: every secret, Durable Object, the bucket and the index stay. `--render` (the workflow's) adds the Renderer's container (D-0031), after checking that the credential reaches the account's containers: without Account > Workers Containers > Write it refuses with `PREVIEW_RENDER_TOKEN` before any upload. |
| `pnpm preview staging secrets` | Kyle's Mac, on his `op` and `gh` logins: mints or rolls `fletch-staging-deploy` (Editor on slot 1's Worker alone), stores it in 1Password, sets the workflow's three secrets and dispatches it (below). |

The lease protects the slot from code that predates staging too: no claim takes a staging lease, its expiry (2100) is
past any `gc`, and the slot's ops reset it only for `down --slot 1 --force`, which says `unstage`.

### The one-time conversion (Kyle's Mac, a clean main checkout)

```bash
git switch main && git pull --ff-only && pnpm install
env -u CLOUDFLARE_API_TOKEN pnpm preview staging convert
```

`convert` and `deploy` run from the `main` branch, or from a detached HEAD at the commit of `origin/main` (a worktree or
cloud session, after `git fetch origin +refs/heads/main:refs/remotes/origin/main`); `convert` also needs Kyle's login.
Another branch, a detached HEAD at any other commit, or a changed tracked file is refused (`PREVIEW_STAGING_NOT_MAIN`,
`PREVIEW_STAGING_DIRTY`), and `convert` on a token too. It deploys main's agent to slot 1 over what is there
(the Worker running there predates the staging op), waits until the slot serves it, sets a key of its own in a secrets
write holding that key alone, marks the lease staging over the tag it read (taking over a branch's lease, merged or
not), and deletes every `PREVIEW_KEY_*`. It never deploys the placeholder, never resets the bucket or the index, and
never writes `MASTER_KEY` or `SETUP_TOKEN`: the Durable Objects, R2, Vectorize, the passkey and the workspace stay.
Only a slot that was free (its secrets rotated by a release, so its setup token is unknown) gets a new `SETUP_TOKEN`,
printed as a setup link. A second run says it is staging already and changes nothing.

After the deploy, `convert` also waits until slot 1's lease Durable Object runs the new deploy's code (the lease read's
`leaseDeploy` names the deploy id wrangler made), reading every 5 s up to 24 times, before it sets a key or marks the
lease: an object still on the old code answers the staging op with Cloudflare's 500. If it never does, `convert` is
refused with `PREVIEW_DEPLOY_NOT_SERVING`, naming the deploy id and the last answer, with no key set and the lease
unmarked; run it again. `staging deploy` makes no lease op after its deploy, so it does not wait.

### The workflow's secrets (Kyle's Mac, once after the conversion, and to rotate)

```bash
pnpm preview staging secrets
```

It needs 1Password's CLI signed in (`op whoami`) and gh logged in (`gh auth status`); the code is
`scripts/preview-staging-secrets.mjs`. Run it once after the conversion, and again to rotate the token. In order:

1. Refuses unless `op` and `gh` are logged in (`PREVIEW_SECRETS_OP_LOGIN`, `PREVIEW_SECRETS_GH_LOGIN`) and slot 1's
   lease says staging (`PREVIEW_STAGING_NOT_CONVERTED`): convert first.
2. Reads the admin token from `op://qyvr-prod/Cloudflare admin/credential` (`PREVIEW_SECRETS_OP_READ`).
3. Mints `fletch-staging-deploy`, an account-owned token with Workers Editor on `fletch-pv-1` alone, or, if it exists,
   narrows its policy to that and rolls its value. It reads the policy back and tries the token: it must read
   `fletch-pv-1` and neither slot 2 or 3, production's Workers, R2, Vectorize nor D1, or it is refused
   (`PREVIEW_SECRETS_POLICY_WIDE`) and a token this run made is deleted.
4. Stores the value as the `credential` of `Cloudflare fletch-staging-deploy` in the `qyvr-staging` vault
   (`op://qyvr-staging/Cloudflare fletch-staging-deploy/credential`), creating or editing the item
   (`PREVIEW_SECRETS_OP_WRITE`).
5. Sets the repository's Actions secrets `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` and
   `FLETCH_PREVIEW_SUBDOMAIN` with `gh secret set`, each value on stdin (`PREVIEW_SECRETS_GH_WRITE`).
6. Dispatches `deploy-staging.yml` on main (`PREVIEW_SECRETS_GH_DISPATCH`) and prints its run.

It prints names, ids and codes only: the token's id, the op reference, the secrets' names and the run. No value is
printed, written to disk or passed as an argument. A failure after step 3 leaves a token whose value nobody holds:
run it again, which rolls it.

### The workflow

`.github/workflows/deploy-staging.yml` runs on every push to main, and by hand:
`gh workflow run deploy-staging.yml --ref main`. It installs, runs `pnpm check`, then `pnpm preview staging deploy --render`
on the scoped token (`FLETCH_PREVIEW_AUTH=token`). Two merges queue and the newest waiting one wins; a deploy running
is never cancelled. A failure fails the job; it never deploys another slot. It reads three repository secrets:
`CLOUDFLARE_API_TOKEN` (the `fletch-staging-deploy` token, set by `pnpm preview staging secrets`), `CLOUDFLARE_ACCOUNT_ID` and `FLETCH_PREVIEW_SUBDOMAIN`.
No lease key: the token already deploys every slot Worker, so a key would prove nothing more, and the deploy does no
keyed op. Until the conversion has run, each run fails with `PREVIEW_STAGING_NOT_CONVERTED`.
`--render` deploys the Renderer's pandoc container (D-0031), so `fletch-staging-deploy` needs Account > Workers
Containers > Write beside its Workers Editor on `fletch-pv-1`: `wrangler deploy` activates the Worker before it creates
the container application, so the command checks first (`wrangler containers list`). Until Kyle adds that permission,
each run fails with `PREVIEW_RENDER_TOKEN` before any upload and the slot keeps serving the previous main.

## Credentials

- **Kyle's Mac:** wrangler's own login (`wrangler whoami`). The scripts unset `CLOUDFLARE_API_TOKEN` and
  `CLAUDE_CODE_OAUTH_TOKEN` for wrangler.
- **A cloud session** (`CLAUDE_CODE_REMOTE=true`), or anywhere with `FLETCH_PREVIEW_AUTH=token`:
  `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` from the environment. The real token is the environment's network
  secret for `api.cloudflare.com`; the session sees only a placeholder.
- **The `workers.dev` subdomain** names the account's owner, so it is never committed. `provision` keeps it in
  `<git common dir>/fletch-previews/subdomain` on Kyle's Mac; anywhere else set `FLETCH_PREVIEW_SUBDOMAIN` (doctor
  prints it on Kyle's Mac).

A lease's key is a secret on the slot's Worker named `PREVIEW_KEY_<tag>`, kept with the setup token in a git-ignored
lease file in `<git common dir>/fletch-previews/`. The slot's Worker answers `/__preview/` (`scripts/preview-slot/ops.mjs`)
only to a key it holds, and its lease (a Durable Object of its own, never wiped) decides who owns the slot.

## Steps: the pool (Kyle's Mac)

1. Make the slots on wrangler's login, with no token in the environment:

   ```bash
   env -u CLOUDFLARE_API_TOKEN pnpm preview provision --slots 3
   ```

   Per slot: an R2 bucket `fletch-pv-<n>-agent`, a Vectorize index `fletch-pv-<n>-memory` (768, cosine) and a
   placeholder Worker `fletch-pv-<n>` on `workers.dev`. It is idempotent, adopts what an earlier run made, never
   redeploys a slot that exists, and refuses a resource with a slot's name the inventory does not record. It writes
   the inventory, scripts/preview-pool.json (names and each Worker's tag; no secret, no subdomain): commit it. A new pool on another
   account takes `--account <id>`.
2. Make the token, from the admin token `CF_TOKENS_ADMIN` in `~/Development/qyvr/.env` (an account-owned token with
   only Account API Tokens: Edit):

   ```bash
   env -u CLOUDFLARE_API_TOKEN pnpm preview token
   ```

   It makes `fletch-preview-slots`, an account-owned token with Individual Workers Editor on every slot Worker and
   nothing else, writes its value to that `.env` as `FLETCH_PREVIEW_CLOUDFLARE_API_TOKEN`, and prints neither value.
   Before it reports success it reads the policy back, checks every slot Worker accepts the token, and that qyvr.dev's
   production Workers and the account's R2, Vectorize and D1 lists refuse it. It never touches qyvr's
   `qyvr-preview-slots`. After adding slots, run it again: it updates the same token and the value stays.
3. In the cloud environment: set the token as the network secret for `api.cloudflare.com` (Bearer, no custom header,
   no path prefix); set the variables `CLOUDFLARE_API_TOKEN=placeholder`, `CLOUDFLARE_ACCOUNT_ID=<the pool's account>`
   and `FLETCH_PREVIEW_SUBDOMAIN=<subdomain>`; allow the hosts below. Then run `pnpm preview doctor` there.

`pnpm preview deprovision [--slot n]` deletes what the inventory records for one slot or all: Worker (with its Durable
Object state), bucket (emptied first), index. Every name must carry `fletch-pv-` and its slot's name, or nothing is
deleted; a failed deletion keeps its entry for another run. `provision` and `deprovision` are the only commands that
make or delete a Cloudflare resource.

## Hosts a cloud session must reach

| Host | For |
|---|---|
| `api.cloudflare.com` | every wrangler call, and `doctor` |
| `tail.developers.workers.dev` | `pnpm preview tail`'s WebSocket |
| `fletch-pv-*.<subdomain>.workers.dev` | the slots: leases, ops, the app |
| `registry.npmjs.org` | `pnpm install` |
| `api.github.com` | `gh`, for which branches merged (`gc`) |

## Traps

- **A key takes seconds to arrive, unevenly.** `up` sets its key and waits until the slot accepts it before claiming,
  and a keyed call that still gets 401 tries again a few times. A secrets write builds on the Worker's latest version,
  which can lag a write made seconds before, so the key rides in the same write as each rotation. If `down` still gets
  401 while the slot is leased to this branch, it keeps the lease file (the only copy of the key): run it again, or
  `gc --slot n --force` on Kyle's login.
- **A deleted vector shows for seconds.** The reset empties the index by querying it and deleting what comes back, so
  `up` and `down` call it until a query returns nothing.
- **A new binding kind in `packages/agent/wrangler.jsonc`** (D1, KV, a queue, a service…) makes every slot config, and
  so `pnpm test`, refuse it (`KNOWN_CONFIG_KEYS` in `scripts/preview-plan.mjs`) until someone decides what a slot gets:
  copied as it is, it would point a slot at another deploy's resource.
- **A shell that forces colour** makes `gh`'s JSON unparseable; `gc` reads plain lines with colour off.
- **Deleting the Worker deletes its Durable Object state**: only `deprovision` does it.
- **A slot's container application outlives the slot.** A `--render` deploy creates `<worker>-renderer` (e.g.
  `fletch-pv-1-renderer`) on the account; `down` and `deprovision` leave it, so delete it by hand
  (`wrangler containers delete`) when the slot no longer renders.
