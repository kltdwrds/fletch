# Evidence

What the parity loop captured from Muse (design §4), one folder per cluster: `p<n>-<slug>/` holds the browser
captures of each scenario step (`step-<n>.png`, `step-<n>-dom.md`, `step-<n>-requests.json`), the dump slices the
cluster read (`dump/`), and Muse's answers per `INTERROGATE.md` (`answers/step-<n>.md`, its `SELECT` rows as
`step-<n>-rows.json`). A contract (`../contracts/`) cites a file here by its path under the cluster's folder.

## Where it lives

The repository is public (D-0014). Everything in this folder but this README and `results/` is git-ignored
(`.gitignore`) and lives on Kyle's Mac, where the orchestrator runs. A clone elsewhere sees the citations and not the
files; that is the design, not a gap. Never force-add a capture, and never copy one into a contract, a question or a
PR body.

`results/` is the one tracked folder: the tier-2 runner's verdicts (F19), one `<versionHash>.json` per task
definition holding the task hash, each trial's outcome, timestamps and the slot's id, and never a line of agent or
user text. A scorecard level of 2 or more cites a file there (`scripts/check-plan.mjs`), so CI can hold the row to it.
The folder appears with the first results file.

## Before a file is stored

Every file passes the redaction gate first, and nothing is stored that did not:

```bash
pnpm redact docs/plan-v2/evidence/p1-reactions/step-3-requests.json
```

The gate (`scripts/redact-capture.mjs`) runs the repository's secret patterns over the text and deletes the file with a
non-zero exit when one matches (a capture that fails is deleted, not fixed by hand: capture the step again with the
secret out of view); strips every JSON field outside its allowlist (ids, kinds, enums, status codes, failure words,
request method and path without its query) to the value's shape; masks addresses in a text file; and passes a binary
file (a screenshot) through unread, which is why a screenshot is read by eye before it is kept, and taken again when it
shows a secret, a message body or a person who is not a fixture. The gate is idempotent: run it again when in doubt.
