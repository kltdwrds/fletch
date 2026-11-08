# Starting the overnight orchestrator

## When

Kyle wants the parity loop to run unattended for a night with every open question answered by its recommended
default (`docs/plan-v2/ORCHESTRATOR-OVERNIGHT.md`, Defaults), as many builders in parallel as the three preview
slots allow, and the ledgers current for his check-in. The usual loop (`docs/plan-v2/ORCHESTRATOR.md`) stops at
`ORCHESTRATOR: waiting on Kyle` as soon as a question blocks a part; this one takes the default and builds.

## Steps

1. Before sleeping, anything from "What Kyle can do before sleeping" in `docs/plan-v2/ORCHESTRATOR-OVERNIGHT.md`
   (a Muse sign-in in the desktop app's browser pane, the P10 and P11 evidence tarball unpacked and mirrored with
   `pnpm evidence-mirror`, `claude` then `/login` in a terminal). Each unblocks a Queue item; none blocks the rest.
2. Fresh main, free slots:

   ```bash
   cd /Users/kyleedwards/Development/fletch && git checkout main && git pull --ff-only && pnpm install && node scripts/preview.mjs gc && node scripts/preview.mjs list
   ```

3. Start a new session in the Claude desktop app (Code tab) in this repository, on Fable, in auto mode, in its own
   worktree, and paste the `/goal` line of `docs/plan-v2/ORCHESTRATOR-OVERNIGHT.md` as its first message. A session
   another session starts (`start_session`) takes the same line as its prompt; check that the goal is active (the
   Stop hook names it) and paste it if not. Keep the Mac awake and plugged in: the orchestrator asks for the keep-awake
   itself, and the cloud builders keep running if it sleeps, but their merges wait for it.
4. In the morning, read `docs/plan-v2/WAITING-ON-KYLE.md`: every default taken is a line in the item it unblocked;
   reverse one by a line under `## Steering`, and the next cycle acts on it. The run is over when the transcript
   ends with `ORCHESTRATOR: waiting on Kyle`; restart it the same way for another night.
