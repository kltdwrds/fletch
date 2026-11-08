// T-P11-01 (B-P11-01): a document asked for is made as one file in Sam's Library, and the reply that says it is saved
// carries its `files/<path>` link, drawn as the file's card, after the tool's result. The fake calls `render_document`
// (`to: docx`, `name: p11-memo`) on a Renderer that answers docx.
import people from "../../fixtures/people.json" with { type: "json" };
import { defineTask, type Grader } from "../../support/task.ts";
import { homeR2, indexOf, MEMO_DOCX, named, newRows, type P11World, replyTo, row } from "./world.ts";

const sam = people.people.find((p) => p.id === "sam-solo")!;
export const TEXT = "write a one-page memo titled p11 memo with three headings and keep it where I can find it";
const SAVED = /\b(saved|made|ready|done)\b/i;
const savedReply = (w: P11World) => indexOf(w, (e) => e.role === "agent" && SAVED.test(e.text));
const toolResult = (w: P11World) => indexOf(w, (e) => e.role === "tool" && e.tool === "render_document" && e.text.startsWith("SAVED:"));

const graders: Grader<P11World>[] = [
  { name: "documents/p11-memo.docx is one row in Sam's files with its media type", kind: "end_state", check: (w) => newRows(w).length === 1 && row(w, MEMO_DOCX)?.mediaType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
  { name: "the reply carries a files/documents/p11-memo.docx link in the message that says it is saved", kind: "end_state", check: (w) => { const r = replyTo(w, 1); return SAVED.test(r) && r.includes(`(files/${MEMO_DOCX})`); } },
  { name: "the reply's file path equals the saved row's path", kind: "required_fact", check: (w) => { const m = /\(files\/([^)]+)\)/.exec(replyTo(w, 1)); return !!m && row(w, m[1] as string) !== undefined; } },
  { name: "saved_before_write", kind: "minefield", check: (w) => savedReply(w) !== -1 && (toolResult(w) === -1 || savedReply(w) < toolResult(w)) },
  { name: "ready_without_card", kind: "minefield", check: (w) => SAVED.test(replyTo(w, 1)) && !/\]\(files\/[^)]+\)/.test(replyTo(w, 1)) },
  { name: "second_copy", kind: "minefield", check: (w) => newRows(w).some((f) => f.path !== MEMO_DOCX) },
];

export const task = defineTask<P11World>({
  id: "T-P11-01",
  cluster: "P11",
  clauses: ["B-P11-01"],
  priority: "must-have",
  tier: 1,
  setup: { seed: 1, records: ["chat:c1 for Sam", "a Renderer that answers docx"], files: [], jobs: [] },
  turns: [{ kind: "prompt", by: sam.email, text: TEXT }],
  ...named(graders),
  collateral: { r2: [homeR2(MEMO_DOCX)] },
  graders,
  reference: "Muse delivered the PDF card in its Done turn (B-P11-01, answers/step-1.md); fletch saves in the turn and links files/<path> after the tool's result (delta 2).",
});

export default task;
