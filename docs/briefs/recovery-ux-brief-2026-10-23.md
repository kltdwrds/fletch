# Brief: recovery-code page — tap-to-copy + confirm gate (plain PR)

Repo: fletch (this working copy). This is a PLAIN PR per AGENTS.md (small change, no part id).
Read AGENTS.md and packages/host-cloudflare/AGENTS.md first and follow them.

## Where
`packages/host-cloudflare/src/passkeys/page.ts` — the `#saved` section shown once after a
passkey is registered (states `register` and `add`): it displays the one-time recovery code
in `<code id="code">` with a single button `#done` ("I have written it down") that today
navigates to `/` immediately on click.

## The ask (from Kyle, using the live staging deploy)
1. **Tap-to-copy the recovery code.** Tapping/clicking the code copies it to the clipboard
   (navigator.clipboard.writeText where available) and gives brief visible feedback in the
   page's own voice (short, plain, sentence case). If the clipboard API is missing or the
   write rejects, fall back gracefully to the current behaviour (the code is user-select:all)
   and say so in the feedback — a failed copy must never look like a successful one, and must
   never break the page. Keep the code element keyboard-operable.
2. **A confirm on the done button.** The first click on "I have written it down" must NOT
   navigate away — the code is shown once and is gone forever after. Arm an explicit
   confirmation instead (the button's label/state changes to make the stakes plain, e.g. a
   second-click-to-confirm in the page's voice); only the confirming second click navigates
   to `/`. Copying the code does not bypass this gate.

## Constraints
- The page is one self-contained HTML string: inline script + inline style, no external
  assets, and the CSP allows them by hash. Find how those hashes are maintained (serving
  code and/or tests) and keep them correct — the suite will check.
- Copy tone: the page's existing voice (short plain sentences, sentence case, no emoji).
- Add or extend tests where the behaviour is genuinely observable (candidates:
  packages/host-cloudflare/test/passkeys-routes.test.ts, test/workers/f1-login-browser.test.ts).
  A guard whose removal fails no test protects nothing: plant both behaviours in tests.
- Run the gates the way AGENTS.md prescribes and report their exact results: `pnpm check`
  and the tests you touched; `pnpm verify` once before finishing.
- Work on a new branch `recovery-code-ux` off local main. Commit with Conventional Commits
  and DCO sign-off (`git commit -s`). The working copy has unrelated untracked files
  (wrangler.staging.json, dist/ output): commit ONLY the files your change needs.
- Do NOT push or touch GitHub (no working transport here); Muse publishes the PR.
- Never edit the guard-rail files listed in docs/runbooks/muse-execution.md.

## Finish with (in your final message)
- The branch name and commit list.
- A PR body draft: what changed, the two behaviours, the tests, the gate results verbatim.
