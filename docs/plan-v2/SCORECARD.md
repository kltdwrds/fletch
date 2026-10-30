# Scorecard

One row per cluster, written by the Lock stage (design §3) and copied from the cluster's contract
(`contracts/README.md`, "Scorecard"). Levels: 0 interrogated, 1 translated, 2 must-have tasks passing on a preview
slot, 3 locked in CI. A level of 2 or more names a results file under `evidence/results/` and the PR it rests on;
`scripts/check-plan.mjs` fails a row that does not. The orchestrator raises a level only by quoting the accept,
verifier and evals lines it rests on (`ORCHESTRATOR.md`).

| cluster | level | must-have tasks passing | evidence (PR, accept line, verifier line) | last verified |
|---|---|---|---|---|
| P1 reactions | 2 | tier 1: 8 of 8 under vitest (T-P1-08 whole since F21); tier 2: T-P1-02 3 of 3 (the one tier-2 must-have); nice-to-have T-P1-06 3 of 3 and T-P1-09 3 of 3 since F22 | `contracts/P1-reactions.md`; `pnpm evals P1` 2026-10-29, results `docs/plan-v2/evidence/results/33ce7e13e0d346d6f474683d42ce0035d58af6b2fbee584310b7dfc48c0a6c10.json` (T-P1-02), `docs/plan-v2/evidence/results/550090e2c7a499e03ffd2d79ef97dfa2a85d47fdfd38a59bac967c05715596a0.json` (T-P1-06) and `docs/plan-v2/evidence/results/35f8abe744e425dcb868462d91e9202ccb201fe16943fe838f1510ac34060e73.json` (T-P1-09); PR #26 (F20), PR #29 (F21) and PR #31 (F22); `ACCEPT F20: PASS` (TREE fcaebcf1f9b1), `ACCEPT F21: PASS` (TREE 20c4832fa671), `ACCEPT F22: PASS` (TREE d4acf6cceabc), all `VERIFIER: no blocking findings` (PROGRESS.md F20, F21, F22) | 2026-10-29 |
| P2 loop, tools and deferral | 1 | none yet: 11 tier-1 and 1 tier-2 must-have, 2 nice-to-have, written 2026-10-29 | `contracts/P2-loop.md` (13 clauses, 15 tasks, the Translation with seven deltas, no one-way door); interrogation 2026-10-29, `evidence/p2-loop/trace.json` validates; parts F23 and F24; no PR yet | 2026-10-29 |
