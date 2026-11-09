// T-P11-14 (B-P11-16): a Library listing names each file with its kind, size and last change. The fake calls
// `file_list`, whose lines carry each home file's size and `changed <time> UTC` (F100); Sam's session reads
// `GET /app/library`, whose items carry `size`, `updated_at` and a binary's `mediaType`. The version count is F103's.
import people from "../../fixtures/people.json" with { type: "json" };
import { defineTask, type Grader } from "../../support/task.ts";
import { named, type P11World } from "./world.ts";

const sam = people.people.find((p) => p.id === "sam-solo")!;
export const TEXT = "list my files";
const at = (ms: number) => new Date(ms).toISOString().slice(0, 16).replace("T", " ");
const line = (w: P11World, path: string) => w.listing.tool.split("\n").find((l) => l.startsWith(`${path} (`)) ?? "";

const graders: Grader<P11World>[] = [
  { name: "each listed line carries its size and last change", kind: "end_state", check: (w) => w.files().length === 3 && w.files().every((f) => line(w, f.path).includes(`(${f.size} bytes, changed ${at(f.updatedAt)} UTC`)) },
  { name: "each Library item carries size, last change and, for a document, its kind", kind: "end_state", check: (w) => w.listing.library.length === 3 && w.listing.library.every((i) => typeof i.size === "number" && typeof i.updated_at === "number") && w.listing.library.some((i) => (i.mediaType ?? "").includes("wordprocessingml")) },
  { name: "sizes and times equal the rows'", kind: "required_fact", check: (w) => w.files().every((f) => w.listing.library.some((i) => i.path === f.path && i.size === f.size && i.updated_at === f.updatedAt)) },
  { name: "invented_metadata", kind: "minefield", check: (w) => /\bversions?\b|\bv\d\b/i.test(w.listing.tool) || w.listing.library.some((i) => !w.files().some((f) => f.path === i.path)) },
  { name: "missing_time", kind: "minefield", check: (w) => w.files().some((f) => !line(w, f.path).includes("changed ")) },
];

export const task = defineTask<P11World>({
  id: "T-P11-14",
  cluster: "P11",
  clauses: ["B-P11-16"],
  priority: "nice-to-have",
  tier: 1,
  setup: { seed: 14, records: ["chat:c1"], files: ["documents/p11-memo.docx", "sheets/p11-budget.csv", "notes/p11-note.txt, rewritten twice"], jobs: [] },
  turns: [
    { kind: "prompt", by: sam.email, text: TEXT },
    { kind: "event", name: "library", payload: { as: sam.email } },
  ],
  ...named(graders),
  collateral: {},
  graders,
  reference: "Muse's listing had no file-listing function and its Library showed no date or version (B-P11-16).",
});

export default task;
