# Release the primitives

`@qyvr/host` and `@qyvr/host-cloudflare` are published to npm by changesets; the agent is private, and deployed
from a checkout by `pnpm self-host`. `.github/workflows/release.yml` runs on every push to `main`.

## When

A merged change alters what either primitive exports or does.

## Steps

1. In the PR that makes the change, add a changeset and commit the file it writes under `.changeset/`:

   ```
   pnpm exec changeset
   ```

   A renamed or removed export, or a renamed refusal code, is a major bump and a one-way door: ask in
   `docs/plan-v2/QUESTIONS.md` first (AGENTS.md, Decisions).
2. Merge. The workflow runs `pnpm verify` without publish credentials, then the changesets action opens or updates
   a "Version Packages" PR.
3. Merge that PR. The workflow builds both primitives and publishes them (`pnpm release`).
4. Until the repository has an `NPM_TOKEN` secret, step 3 warns and publishes nothing; the run stays green.
