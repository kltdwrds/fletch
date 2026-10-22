# Questions for Kyle

Each question: `### Q<n> (F<n>), <date>: <title>`, then **Blocks:**, **Recommended answer:**, and once given
**Answered (Kyle, <date>):**. An answer that settles a decision updates its record in `docs/decisions/` in the same commit.

## BLOCKED (open)

### Q1 (F1), 2026-10-22: A throwaway account for the live exit test

**Blocks:** F1's last acceptance claim, one passing run of `test/live/f1-deploy.live.test.ts`, and the tag `v0.1.0`.

**Recommended answer:** create a free-plan Cloudflare account used for nothing else, add its id and a token
(Workers Scripts, R2 and Vectorize: Edit; Workers AI: Read) as the repository secrets `CF_LIVE_ACCOUNT_ID` and
`CF_LIVE_TOKEN`, and run the live-deploy workflow once (`docs/runbooks/live-deploy.md`). The same account can close
the free-plan spike (Q2).

## Open, not blocking

### Q2 (F1), 2026-10-22: Run the free-plan spike for Code Mode and Images

**Blocks:** nothing yet; it decides whether `create-fletch` adds `LOADER` and `IMAGES` by default or only with
`--paid` (D-0004).

**Recommended answer:** run it on the Q1 account (`docs/runbooks/free-plan-spike.md`) and paste the table.

### Q3, 2026-10-22: Preview slots on the shared account reach production's data

**Blocks:** accepting D-0008. `pnpm preview` works today on the shared account (`docs/runbooks/preview.md`).

**Context:** the slot token cannot redeploy production, but a binding is not checked against the deploying token, so
anyone holding it can bind qyvr.dev production's buckets, databases or services into a slot Worker and read them
(measured with a stand-in bucket, D-0008).

**Recommended answer:** put the preview pool on a Cloudflare account used for nothing else: create it, run
`pnpm preview provision` and `pnpm preview token` there (the inventory and the token name its account), and set the
cloud environment's `CLOUDFLARE_ACCOUNT_ID` to it. The alternative is to accept the gap and D-0008 as it stands.

## Answered
