---
name: handoff
description: Use when the handoff hook says the context has passed the handoff point, before asking the user for a /clear, or when a note restored after compaction or /clear is behind git. Also for /handoff, session handoff notes, auto-compaction, long multi-phase or unattended sessions and context limits.
---

# handoff

Compaction keeps what its summary chooses; the handoff note keeps what you choose. It is one file per branch,
`.claude/handoff/<branch>.md` (the branch with `-` for `/` and any other character unsafe in a filename),
git-ignored and overwritten in place. `.claude/hooks/handoff.mjs` prints it back after every compaction and
`/clear`, with what git did since.

## When

- **The hook says the context passed the handoff point** (90% of the way to auto-compaction, near 350k). Finish
  the phase in hand (a task done, a PR opened, a review round answered, a ruling made), never stopping mid-task,
  then write the note and carry on. The compaction follows on its own; nothing waits for the user.
- **You want a clean start now.** Write the note, then ask the user to run `/clear`; nothing needs pasting.
- **A restored note is behind git.** Rewrite it before continuing.

## The note

Overwrite the file with exactly these sections, 60 lines at most. Name files, PRs, commits, commands and codes
exactly. Link a plan or spec rather than copying it.

```markdown
# <branch>: <the goal in one line>

## Next
<The one action to take first: the file, the command or the PR thread. One to three lines.>

## Open
- <each unfinished task, PR, review thread or question, with its link or path, and what blocks it>

## Done
- <what is finished and verified, one line each, with its commit or PR>

## Decisions
- <each ruling with its reason and the rejected alternative; each trap and its fix>

## Sources
<the plan and spec this work follows, by path; the commands that verify it>
```
