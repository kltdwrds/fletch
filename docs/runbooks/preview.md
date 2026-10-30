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
| `pnpm preview up` | Leases a free slot (or renews this worktree's lease) and deploys the working tree to it. A new lease starts empty, with new `MASTER_KEY` and `SETUP_TOKEN`, and prints the setup link for the first passkey. `--slot n` asks for one, `--ttl hours` sets the lease (24 by default; every `up` renews it), `--paid` adds the Worker Loader and Images bindings as `create-fletch --paid` does, `--var K=V` (repeatable) sets one of the model vars `AI_GATEWAY_ID`, `CHAT_PROVIDER` on the slot (`packages/agent/src/model/routes.ts`), so its chat runs on Muse Spark rather than the self-host default; any other key is refused; the slot keeps them until the next `up` without them. |
| `pnpm preview status` | This worktree's lease, what the slot serves, its `/health`, and the setup link again. |
| `pnpm preview tail` | `wrangler tail` on the slot's Worker. |
| `pnpm preview down` | Releases the slot: the placeholder deployed (which deletes every agent Durable Object and its storage), new secrets, the bucket and the index emptied, every session key deleted, the lease ended. |
| `pnpm preview gc` | Releases every slot whose lease expired or whose branch's PR merged (`--dry-run` says which). On Kyle's login, `--slot n --force` releases one live lease: a slot whose holder lost its key. |
| `pnpm preview list` | Every slot and its lease. |
| `pnpm preview doctor` | Which credential is in use, whether the network accepts it, whether each slot answers, and the hosts to allow. |

Slot `n` answers at `https://fletch-pv-<n>.<subdomain>.workers.dev`. Its tenant is `fletch-pv-<n>` and its owner the
fixture person, `sam@solo-sam.example`. Open the setup link `up` printed to register a passkey; a released slot
answers 503.

`pnpm preview down` before your branch's PR merges. `gc` is the backstop, and an unrenewed lease expires after a day.

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
