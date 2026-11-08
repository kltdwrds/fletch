// T-P11-06 (B-P11-06): a spreadsheet's total equals the sum of its rows, and after a change the reply states the total
// read back from the saved file. fletch makes no xlsx (delta 3): the sheet is a CSV by `file_write`, its total row
// written and read back with `file_read` before each reply.
import people from "../../fixtures/people.json" with { type: "json" };
import { defineTask, type Grader } from "../../support/task.ts";
import { BUDGET_CSV, indexOf, named, newRows, type P11World, replyTo, row, sumOf, totalOf } from "./world.ts";

const sam = people.people.find((p) => p.id === "sam-solo")!;
export const FIRST = "make a spreadsheet p11 budget with rent 1200, tools 300, travel 250 and a total row, saved as sheets/p11-budget.csv";
export const SECOND = "change travel to 500 and tell me the new total";
const writes = (w: P11World) => w.entries().filter((e) => e.role === "call" && e.tool === "file_write").map((e) => (JSON.parse(e.text) as { text: string }).text);
const numbers = (s: string) => (s.match(/\b\d[\d,]*\b/g) ?? []).map((n) => Number(n.replace(/,/g, "")));
/** The index of the last `file_read` of the sheet before the second reply, and of the last write. */
const lastWrite = (w: P11World) => w.entries().map((e, i) => (e.role === "call" && e.tool === "file_write" ? i : -1)).filter((i) => i >= 0).at(-1) ?? -1;
const readAfter = (w: P11World) => w.entries().some((e, i) => i > lastWrite(w) && e.role === "call" && e.tool === "file_read" && e.text.includes(BUDGET_CSV));
const secondReplyAt = (w: P11World) => indexOf(w, (e) => e.role === "agent" && /2,?000/.test(e.text));

const graders: Grader<P11World>[] = [
  { name: "the first saved sheet's total row is 1750 and the second's 2000", kind: "end_state", check: (w) => writes(w).length === 2 && totalOf(writes(w)[0] ?? null) === 1750 && totalOf(row(w, BUDGET_CSV)?.text ?? null) === 2000 },
  { name: "the second reply's number equals the saved file's total cell", kind: "end_state", check: (w) => numbers(replyTo(w, 2)).includes(totalOf(row(w, BUDGET_CSV)?.text ?? null) ?? Number.NaN) },
  { name: "the total equals the sum of the data rows in each saved version", kind: "required_fact", check: (w) => writes(w).every((t) => totalOf(t) === sumOf(t)) },
  { name: "prose_total", kind: "minefield", check: (w) => [1, 2].some((n) => numbers(replyTo(w, n)).filter((x) => x >= 1000).some((x) => x !== totalOf(n === 1 ? (writes(w)[0] ?? null) : (row(w, BUDGET_CSV)?.text ?? null)))) },
  { name: "copy_edited", kind: "minefield", check: (w) => newRows(w).length !== 1 },
  { name: "unread_total", kind: "minefield", check: (w) => !readAfter(w) || secondReplyAt(w) < lastWrite(w) },
];

export const task = defineTask<P11World>({
  id: "T-P11-06",
  cluster: "P11",
  clauses: ["B-P11-06"],
  priority: "must-have",
  tier: 1,
  setup: { seed: 6, records: ["chat:c1"], files: [], jobs: [] },
  turns: [
    { kind: "prompt", by: sam.email, text: FIRST },
    { kind: "prompt", by: sam.email, text: SECOND },
  ],
  ...named(graders),
  collateral: {},
  graders,
  reference: "Muse reported 1,750 then 2,000 from the builder's recalculation (B-P11-06); fletch writes a CSV and reads its total back.",
});

export default task;
