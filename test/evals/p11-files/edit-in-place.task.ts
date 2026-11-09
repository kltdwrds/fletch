// T-P11-04 (B-P11-04): an edit changes the named file at its own path. The fake reads `notes/p11-memo.md` and
// `file_write`s the whole new text on the same path; the result says, by its leading code word, that it replaced an
// earlier file and that the earlier content was not kept (P11 delta 1, until F103's versions).
import people from "../../fixtures/people.json" with { type: "json" };
import { defineTask, type Grader } from "../../support/task.ts";
import { MEMO_MD, named, NOT_KEPT, newRows, type P11World, REPLACED, results, row, shaBefore } from "./world.ts";

const sam = people.people.find((p) => p.id === "sam-solo")!;
export const TEXT = "in the memo add a section Risks with two bullets, keeping everything else";
const was = (w: P11World) => w.before.find((f) => f.path === MEMO_MD)?.text ?? "";

const graders: Grader<P11World>[] = [
  { name: "one row at notes/p11-memo.md with a new sha", kind: "end_state", check: (w) => w.files().length === 1 && !!row(w, MEMO_MD) && row(w, MEMO_MD)?.sha256 !== shaBefore(w, MEMO_MD) },
  { name: "the file_write result names the path, that it replaced an earlier file and that the earlier content was not kept", kind: "end_state", check: (w) => results(w, "file_write").some((t) => t.startsWith(REPLACED) && t.includes(MEMO_MD) && t.includes(NOT_KEPT)) },
  { name: "the earlier text is kept whole at the start of the new text", kind: "required_fact", check: (w) => was(w).length > 0 && (row(w, MEMO_MD)?.text ?? "").startsWith(was(w).trimEnd()) && /## Risks/.test(row(w, MEMO_MD)?.text ?? "") },
  { name: "second_copy", kind: "minefield", check: (w) => newRows(w).length > 0 },
  { name: "silent_overwrite", kind: "minefield", check: (w) => results(w, "file_write").some((t) => !t.startsWith(REPLACED)) },
];

export const task = defineTask<P11World>({
  id: "T-P11-04",
  cluster: "P11",
  clauses: ["B-P11-04"],
  priority: "must-have",
  tier: 1,
  setup: { seed: 4, records: ["chat:c1"], files: ["notes/p11-memo.md with three headings, its sha recorded"], jobs: [] },
  turns: [{ kind: "prompt", by: sam.email, text: TEXT }],
  ...named(graders),
  collateral: {},
  graders,
  reference: "Muse overwrote in place and said nothing of the lost version (B-P11-04, answers/step-3.md).",
});

export default task;
