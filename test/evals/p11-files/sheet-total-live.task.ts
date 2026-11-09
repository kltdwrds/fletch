// T-P11-18 (B-P11-06), tier 2 on a preview slot (F102): the saved sheet's total is 2000 after the change and the second
// reply's total equals it. Under the scripted fake (F100) it runs on the tier-1 world as T-P11-06's CSV.
import people from "../../fixtures/people.json" with { type: "json" };
import { defineTask, type Grader } from "../../support/task.ts";
import { named, newRows, type P11World, replyTo, totalOf } from "./world.ts";

const sam = people.people.find((p) => p.id === "sam-solo")!;
export const FIRST = "p11 eval: make a spreadsheet p11 eval budget with rent 1200, tools 300, travel 250 and a total row";
export const SECOND = "p11 eval: change travel to 500 and tell me the new total";
const sheet = (w: P11World) => w.files().find((f) => /budget/.test(f.path));
const numbers = (s: string) => (s.match(/\b\d[\d,]*\b/g) ?? []).map((n) => Number(n.replace(/,/g, "")));

const graders: Grader<P11World>[] = [
  { name: "the saved sheet's total is 2000", kind: "end_state", check: (w) => totalOf(sheet(w)?.text ?? null) === 2000 },
  { name: "the second reply's total equals it", kind: "end_state", check: (w) => numbers(replyTo(w, 2)).includes(2000) },
  { name: "one sheet file across both turns", kind: "required_fact", check: (w) => newRows(w).length === 1 },
  { name: "prose_total", kind: "minefield", check: (w) => numbers(replyTo(w, 2)).filter((x) => x >= 1000).some((x) => x !== totalOf(sheet(w)?.text ?? null)) },
  { name: "copy_edited", kind: "minefield", check: (w) => newRows(w).length > 1 },
];

export const task = defineTask<P11World>({
  id: "T-P11-18",
  cluster: "P11",
  clauses: ["B-P11-06"],
  priority: "nice-to-have",
  tier: 2,
  setup: { seed: 18, records: ["a preview slot", "an empty Library"], files: [], jobs: [] },
  turns: [
    { kind: "prompt", by: sam.email, text: FIRST },
    { kind: "prompt", by: sam.email, text: SECOND },
  ],
  ...named(graders),
  collateral: {},
  graders,
  reference: "B-P11-06 (answers/step-5.md).",
});

export default task;
