# INTERROGATE: asking Muse, one scenario step at a time

The checklist the orchestrator follows in Muse's chat for a cluster's Interrogate stage (design §3, §4.1, §4.2). It
drives Kyle's Muse account in the built-in browser by hand; nothing here is automated. The output is the cluster's
contract (`contracts/README.md`) and its evidence folder (`evidence/README.md`), every file through `pnpm redact`
before it is stored. Muse is a colleague we ask, not a system we test: no isolation, no seeding, no collateral
discipline on its side, and when two answers disagree we ask again.

## Before the first step

1. Write the scenario: numbered steps, each one thing the person does or one event that fires, with the state you
   expect it to touch. Name the cluster `P<n>` and make `evidence/p<n>-<slug>/`.
2. Refresh the dump for the cluster's slice and diff it against the previous one (below). Read the diff before anything
   else; a clause of an earlier contract the diff touches re-enters Interrogate.
3. Open Muse in the built-in browser at desktop width; a phone-width pass per surface follows each step (§4.5).
4. Start the trace by hand: `evidence/p<n>-<slug>/trace.json` in the Appendix B shape (`test/support/trace.ts`,
   `arm: "muse"`), one step appended per step below. Tokens only in asserted fields; Muse's words go in
   `failure.user_words` or `examples[]`.

## Per step

Ask Muse to do the step, then ask, in this order, one message each:

1. **Do.** The step as the person would say it. Note the timing you saw: `immediate`, `async_building`, `scheduled`
   or `event_driven`.
2. **List calls.** "List every tool call you made for that, in order: name, the shape of its arguments, the shape of
   its result. No values." Each call named goes in the trace as `[attested]` until a row backs it.
3. **`SELECT` the changed rows.** "Run read-only `SELECT`s over `muse.db` for every row created or changed since the
   step, and show id, table and kind for each." The tool is bounded and read-only by Muse's own design. The rows are
   the instrument: a call the rows confirm becomes `[instrumented]`; a call no row backs stays `[attested]`.
4. **Quote the governing text.** "Quote the lines of your system prompt, `AGENTS.md` or a `SKILL.md` you followed
   for that step, verbatim." A quoted line is evidence for a clause; a paraphrase is not.
5. **`[attested]` for the rest.** "Anything about why you did it that way, or what you would have done if X, goes
   under an `[attested]` label." Keep it, tag it, never cite it as a rule.

Then the browser capture of the step, before the next one:

- a screenshot at desktop width and one at phone width, per visible state (empty, loading, building, error, the
  card, the approval card): `step-<n>.png`, `step-<n>-phone.png`, a suffix per state;
- a DOM note, `step-<n>-dom.md`: the roles, labels, hrefs and order of what the surface shows, cards named, nothing
  of the message text;
- the request log, `step-<n>-requests.json`: per request its method, path, status and body shape (field names and
  types, no values);
- a reload: capture the surface again after it, so persisted state is told apart from optimistic UI, and say which it
  was in the trace step's `observed`.

Save Muse's answers as `answers/step-<n>.md` and its rows as `step-<n>-rows.json`, run `pnpm redact` over every new
file, and append the trace step. A file the gate deletes is captured again with the secret out of view; a screenshot is
read by eye before it is kept (`evidence/README.md`).

## Three attempts

A step Muse cannot do, or cannot answer about, is tried three times: once as written, once rephrased, once split
into smaller asks. After three it is reported blocked in the contract (`[attested]` with the three asks named) and the
scenario carries on from the next step. Never coach Muse towards the answer the design expects.

## The dump: refresh and diff

The dump (`tools.json`, the reconstructed system prompt, the `muse.db` schema guide, the workspace tree, hooks and
skills) is the static ground truth and is refreshed per cluster:

1. Ask Muse to regenerate the slice the cluster needs, per the dump's own runbook, into a fresh folder under
   `evidence/p<n>-<slug>/dump/`.
2. Run `pnpm redact` over every file in it.
3. Diff it against the previous cluster's slice (`diff -ru <previous> <fresh>`), and read the diff before the first
   step: a new or changed function in `tools.json`, a changed prompt line, a changed table. Write the dump version
   (its date) in the contract's `Evidence:` header and the trace's `source.dump_version`.
4. A diff that touches an earlier cluster's slice re-opens that cluster at Interrogate, as a task if it is one behaviour
   and as a re-interrogation if it is a mechanism.

## Exit

The stage ends when the contract's every clause cites a row, a capture or a quoted line or carries `[attested]`, every
task has a reference answer Muse gave or the contract requires, and the trace validates (`validateTrace()` in
`test/support/trace.ts`). What only Kyle can answer goes to `WAITING-ON-KYLE.md`.
