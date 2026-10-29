# Scorecard

One row per cluster, written by the Lock stage (design §3) and copied from the cluster's contract
(`contracts/README.md`, "Scorecard"). Levels: 0 interrogated, 1 translated, 2 must-have tasks passing on a preview
slot, 3 locked in CI. A level of 2 or more names a results file under `evidence/results/` and the PR it rests on;
`scripts/check-plan.mjs` fails a row that does not. The orchestrator raises a level only by quoting the accept,
verifier and evals lines it rests on (`ORCHESTRATOR.md`).

| cluster | level | must-have tasks passing | evidence (PR, accept line, verifier line) | last verified |
|---|---|---|---|---|
