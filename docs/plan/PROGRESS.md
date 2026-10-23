# Progress

One row per part, in plan order. Status: TODO | IN PROGRESS | DONE | BLOCKED. The note ends with the accept tree
hash, the test counts, the verifier's result, the duration and `model: <model>` for parts run under
`docs/plan/KICKOFF.md`. F0 and F1 predate the protocol: their rows were written from git (2026-10-22).

| Part | Status | Commit | Date | Note |
|---|---|---|---|---|
| F0 | DONE | 3439121 | 2026-10-20 | The harness carried over from qyvr-co; no verifier run (predates the protocol). |
| F1 | BLOCKED | ecc508d | 2026-10-21 | Implemented and hermetically green; the live exit test has never run (Q1). |
| F2 | DONE | f478148 | 2026-10-22 | Each Chat searches what its thread draws for its owner; `/app/search` fans out, answers one row per chat with the newest line and `more`, and names a chat it could not search with its code. Accept TREE fd683b175127442c1bd6e5e543a0ce792fa1de1e; 1046 hermetic tests passed, 0 failed (11 of this part); verifier: no blocking findings; about 50 min; model: claude-opus-5-5. |
| F3 | TODO | | | The search surfaces on F2: the dialog's title, snippet and time rows, one clear control, the drawer filtering in place with snippets, and dismissal at one fast duration. |
