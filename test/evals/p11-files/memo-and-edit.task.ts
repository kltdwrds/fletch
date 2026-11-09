// T-P11-16 (B-P11-01, B-P11-04), tier 2 on a preview slot (F102): a memo made and then edited in place, each reply
// carrying the file's link after its tool result, the second saying whether the earlier version was kept in the words
// the tool returned. Under the scripted fake (F100) the same file runs on the tier-1 world, the memo as Markdown.
import people from "../../fixtures/people.json" with { type: "json" };
import { defineTask, type Grader } from "../../support/task.ts";
import { indexOf, named, NOT_KEPT, type P11World, REPLACED, replyTo, results } from "./world.ts";

const sam = people.people.find((p) => p.id === "sam-solo")!;
export const FIRST = "p11 eval: write a one-page memo titled p11 eval memo on Solo Sam's fictional plan for next quarter (three headings, invented numbers) and keep it where I can find it later";
export const SECOND = "p11 eval: in the memo add a section Risks with two bullets, keeping everything else";
const paths = (w: P11World) => w.entries().filter((e) => e.role === "call" && (e.tool === "file_write" || e.tool === "render_document")).map((e) => (JSON.parse(e.text) as { path?: string; name?: string }).path ?? (JSON.parse(e.text) as { name?: string }).name);
const linkIn = (s: string) => /\]\(files\/[^)]+\)/.test(s);
/** The `n`th tool result of a write and the `n`th agent entry that links a file. */
const writeAt = (w: P11World, n: number) => w.entries().map((e, i) => (e.role === "tool" && (e.tool === "file_write" || e.tool === "render_document") ? i : -1)).filter((i) => i >= 0)[n - 1] ?? -1;
const linkAt = (w: P11World, n: number) => w.entries().map((e, i) => (e.role === "agent" && linkIn(e.text) ? i : -1)).filter((i) => i >= 0)[n - 1] ?? -1;

const graders: Grader<P11World>[] = [
  { name: "one file after the first turn, the same path after the second", kind: "end_state", check: (w) => w.files().length === 1 && paths(w).length === 2 && paths(w)[0] === paths(w)[1] },
  { name: "each reply carries the file's link after its tool result", kind: "end_state", check: (w) => [1, 2].every((n) => linkIn(replyTo(w, n)) && linkAt(w, n) > writeAt(w, n) && writeAt(w, n) !== -1) },
  { name: "the second reply says the earlier version was not kept, as the tool returned", kind: "end_state", check: (w) => results(w, "file_write").some((t) => t.startsWith(REPLACED) && t.includes(NOT_KEPT)) && /\bnot kept\b/i.test(replyTo(w, 2)) },
  { name: "one path across both turns", kind: "required_fact", check: (w) => new Set(paths(w)).size === 1 },
  { name: "saved_before_write", kind: "minefield", check: (w) => indexOf(w, (e) => e.role === "agent" && linkIn(e.text)) < writeAt(w, 1) },
  { name: "second_copy", kind: "minefield", check: (w) => w.files().length > 1 },
  { name: "silent_overwrite", kind: "minefield", check: (w) => paths(w).length === 2 && !/\b(replaced|not kept|kept)\b/i.test(replyTo(w, 2)) },
];

export const task = defineTask<P11World>({
  id: "T-P11-16",
  cluster: "P11",
  clauses: ["B-P11-01", "B-P11-04"],
  priority: "must-have",
  tier: 2,
  setup: { seed: 16, records: ["a preview slot with the Renderer on", "Sam signed in", "an empty Library"], files: [], jobs: [] },
  turns: [
    { kind: "prompt", by: sam.email, text: FIRST },
    { kind: "prompt", by: sam.email, text: SECOND },
  ],
  ...named(graders),
  collateral: {},
  graders,
  reference: "B-P11-01 and B-P11-04 (answers/step-1.md, answers/step-3.md).",
});

export default task;
