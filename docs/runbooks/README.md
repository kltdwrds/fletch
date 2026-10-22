# Runbooks

One procedure per file, each with a `## When` and a `## Steps` section and exact commands
(`scripts/check-agent-docs.mjs` holds the shape and that every `pnpm` script named exists). A credential is never
typed into a command line that is kept; it comes from the environment or a repository secret.

- [live-deploy.md](live-deploy.md): the F1 exit test against a throwaway account, and its cleanup.
- [release.md](release.md): publishing `@qyvr/host` and `@qyvr/host-cloudflare`.
- [free-plan-spike.md](free-plan-spike.md): whether the free plan accepts the Worker Loader and Images bindings.
- [muse-execution.md](muse-execution.md): how Muse drives Claude Code sessions on the roadmap, reviews and publishes them.
