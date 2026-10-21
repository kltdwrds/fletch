# Working on fletch

Read [README.md](README.md) first: the packages, `pnpm accept`, create-fletch and what this build leaves out.
[docs/DECISIONS.md](docs/DECISIONS.md) holds the open questions and the rulings.

## Commands

```
pnpm check        # typecheck, lint, boundaries, then the hermetic tests
pnpm accept F1    # the acceptance contract: one ACCEPT F1: PASS or FAIL (<step>) line
pnpm dev          # the agent Worker under wrangler dev, on http://localhost:8787
```

`pnpm dev` prints the first-passkey link (`/login?setup=...`). Durable Objects and R2 run locally; Vectorize has no
local mode, and Workers AI is left out unless `pnpm dev --remote-ai`, which proxies the `AI` binding to the account
in `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` (Workers Scripts Edit and Workers AI Read). See `scripts/dev.ts`.

Commits need a DCO sign-off (`git commit -s`); CI refuses a commit without one.

## Claude Code on the web

`.claude/hooks/session-start.mjs` installs the `.tool-versions` Node through the image's nvm (the image ships Node 22),
pnpm for it, the dependencies and playwright-core's own Chromium, and puts that Node first on PATH.

- The hermetic tests refuse to start while a credential variable is set (`HERMETIC_CREDENTIAL_PRESENT`, from
  `test/support/env-guard.ts`), and a cloud session sets several. `pnpm accept F1` builds a clean environment
  itself; for `pnpm check` or one vitest file, run it under `env -i PATH="$PATH" HOME="$HOME" CI=1`, adding
  `PLAYWRIGHT_BROWSERS_PATH="$PLAYWRIGHT_BROWSERS_PATH"` for the browser tests.
- The container has 4 vCPUs: a browser test (`test/workers/f1-login-browser.test.ts`) can hit its 60 s timeout on a
  cold first run of the whole suite and pass alone in about a second. Run it alone before calling it a failure.
