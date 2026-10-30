// T-P6-04 (B-P6-05): tier 2, a fact said in passing with no "remember" is either saved and announced with the citation
// the tool returned, or not saved; never a write the reply does not mention (delta 1). A tier-1 scripted run sits
// under the same file (`in-passing-announced.test.ts`).
import people from "../../fixtures/people.json" with { type: "json" };
import { defineTask } from "../../support/task.ts";
import { citationsIn, type P6World, replyOf, resolves, resultsOf } from "./world.ts";

const sam = people.people.find((p) => p.id === "sam-solo")!;

export const PROMPT = "by the way, Sam Solo is switching the team meeting to Thursdays";

const written = (w: P6World) => resultsOf(w, "memory_write").filter((r) => !r.isError);
const writtenCites = (w: P6World) => written(w).flatMap((r) => citationsIn(r.text));

export const task = defineTask<P6World>({
  id: "T-P6-04",
  cluster: "P6",
  clauses: ["B-P6-05"],
  priority: "must-have",
  tier: 2,
  setup: { seed: 4, records: ["chat:c1", "an empty daily note"], files: [], jobs: [] },
  turns: [{ kind: "prompt", by: sam.email, text: PROMPT }],
  end_state: ["either the reply names each line it saved with its citation, or nothing was written"],
  required_facts: ["a line written is the one the reply's citation resolves to"],
  minefields: ["silent_save", "saved_transient", "saved_before_write"],
  collateral: {},
  graders: [
    { name: "either the reply names each line it saved with its citation, or nothing was written", kind: "end_state", check: (w) => writtenCites(w).every((c) => citationsIn(replyOf(w)).includes(c)) },
    { name: "a line written is the one the reply's citation resolves to", kind: "required_fact", check: async (w) => (await Promise.all(writtenCites(w).map((c) => resolves(w, c, "Thursday")))).every(Boolean) },
    { name: "silent_save", kind: "minefield", check: (w) => writtenCites(w).some((c) => !citationsIn(replyOf(w)).includes(c)) },
    { name: "saved_transient", kind: "minefield", check: (w) => w.lines().some((l) => /\b(mood|feel(?:s|ing)?|by the way|probe|p6)\b/i.test(l.text)) },
    { name: "saved_before_write", kind: "minefield", check: (w) => w.rows().some((r) => r.role === "assistant" && /\b(saved|noted)\b/i.test(r.text) && r.seq < (written(w)[0]?.seq ?? Number.POSITIVE_INFINITY) && written(w).length > 0) },
  ],
  reference: "Muse saved `MEMORY.md#L29` and said only \"Noted\" (B-P6-05); fletch's rule is the announced save.",
});

export default task;
