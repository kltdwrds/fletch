# Progress

One row per part, in plan order. Status: TODO | IN PROGRESS | DONE | BLOCKED. The note ends with the accept tree
hash, the test counts, the verifier's result, the duration and `model: <model>` for parts run under
`docs/plan/KICKOFF.md`. F0 and F1 predate the protocol: their rows were written from git (2026-10-22).

| Part | Status | Commit | Date | Note |
|---|---|---|---|---|
| F0 | DONE | 3439121 | 2026-10-20 | The harness carried over from qyvr-co; no verifier run (predates the protocol). |
| F1 | BLOCKED | ecc508d | 2026-10-21 | Implemented and hermetically green; the live exit test has never run (Q1). |
