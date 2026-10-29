# Scorecard

One row per cluster, written by the Lock stage (design §3) and copied from the cluster's contract
(`contracts/README.md`, "Scorecard"). Levels: 0 interrogated, 1 translated, 2 must-have tasks passing on a preview
slot, 3 locked in CI. A level of 2 or more names a results file under `evidence/results/` and the PR it rests on;
`scripts/check-plan.mjs` fails a row that does not. The orchestrator raises a level only by quoting the accept,
verifier and evals lines it rests on (`ORCHESTRATOR.md`).

| cluster | level | must-have tasks passing | evidence (PR, accept line, verifier line) | last verified |
|---|---|---|---|---|
| P1 reactions | 2 | tier 1: 8 of 8 under vitest (T-P1-08 whole since F21); tier 2: T-P1-02 3 of 3 (the one tier-2 must-have); nice-to-have T-P1-06 and T-P1-09 fail (F22) | `contracts/P1-reactions.md`; `pnpm evals P1` 2026-10-29, results `evidence/results/33ce7e13e0d3…json`; PR #26 (F20) and PR #29 (F21); `ACCEPT F20: PASS` (TREE fcaebcf1f9b1), `ACCEPT F21: PASS` (TREE 20c4832fa671), both `VERIFIER: no blocking findings` (PROGRESS.md F20, F21) | 2026-10-29 |
