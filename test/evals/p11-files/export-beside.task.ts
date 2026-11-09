// T-P11-08 (B-P11-08): an export is a new file beside its source, the source unchanged; a source already in the asked
// format is handed over as itself and said so. The fake hands the memo over as itself and renders the budget to
// `documents/p11-budget.html`.
import people from "../../fixtures/people.json" with { type: "json" };
import { defineTask, type Grader } from "../../support/task.ts";
import { BUDGET_CSV, BUDGET_HTML, MEMO_DOCX, named, newRows, type P11World, replyTo, row, shaBefore } from "./world.ts";

const sam = people.people.find((p) => p.id === "sam-solo")!;
export const TEXT = "export the memo as docx and the budget as html, and tell me where each file is";
const linked = (w: P11World) => [...replyTo(w, 1).matchAll(/files\/([A-Za-z0-9._/-]+[A-Za-z0-9])/g)].map((m) => m[1] as string);

const graders: Grader<P11World>[] = [
  { name: "documents/p11-budget.html exists", kind: "end_state", check: (w) => !!row(w, BUDGET_HTML) },
  { name: "the two sources keep their sha", kind: "end_state", check: (w) => [BUDGET_CSV, MEMO_DOCX].every((p) => row(w, p)?.sha256 === shaBefore(w, p)) },
  { name: "the reply names both paths and says the memo already was docx", kind: "end_state", check: (w) => linked(w).includes(MEMO_DOCX) && linked(w).includes(BUDGET_HTML) && /already (is|was) docx/i.test(replyTo(w, 1)) },
  { name: "the reply's paths equal the rows' paths", kind: "required_fact", check: (w) => linked(w).length > 0 && linked(w).every((p) => !!row(w, p)) },
  { name: "source_replaced", kind: "minefield", check: (w) => [BUDGET_CSV, MEMO_DOCX].some((p) => row(w, p)?.sha256 !== shaBefore(w, p)) },
  { name: "needless_copy", kind: "minefield", check: (w) => newRows(w).some((f) => f.path !== BUDGET_HTML) },
];

export const task = defineTask<P11World>({
  id: "T-P11-08",
  cluster: "P11",
  clauses: ["B-P11-08"],
  priority: "must-have",
  tier: 1,
  setup: { seed: 8, records: ["chat:c1", "a Renderer that answers docx, odt and html"], files: ["sheets/p11-budget.csv", "documents/p11-memo.docx"], jobs: [] },
  turns: [{ kind: "prompt", by: sam.email, text: TEXT }],
  ...named(graders),
  collateral: {},
  graders,
  reference: "Muse handed the PDF over as itself and wrote the CSV beside the XLSX (B-P11-08).",
});

export default task;
