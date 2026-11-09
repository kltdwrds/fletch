// T-P11-07 (B-P11-07): a deck made from a document is a new file beside it, the document untouched, with exactly the
// slide count asked. The fake calls `render_document` (`to: pptx`, three `---`-separated slides); F101 adds `pptx` to
// `RENDER_FORMATS`, and until then the render is refused `RENDER_FORMAT_REFUSED` and the task fails on its end state.
import people from "../../fixtures/people.json" with { type: "json" };
import { defineTask, type Grader } from "../../support/task.ts";
import { DECK, MEMO_DOCX, MEMO_MD, named, newRows, type P11World, row, shaBefore } from "./world.ts";

const sam = people.people.find((p) => p.id === "sam-solo")!;
export const TEXT = "make a three-slide deck from the memo";
/** The slide count `ooxml.ts` read back from the saved deck, kept by the run. */
const slides = (w: P11World) => Number(w.answers.slides?.body ?? "0");

const graders: Grader<P11World>[] = [
  { name: "documents/p11-memo-deck.pptx exists", kind: "end_state", check: (w) => !!row(w, DECK) },
  { name: "the memo's two rows keep their sha", kind: "end_state", check: (w) => [MEMO_DOCX, MEMO_MD].every((p) => row(w, p)?.sha256 === shaBefore(w, p)) },
  { name: "the saved deck has three slides", kind: "required_fact", check: (w) => slides(w) === 3 },
  { name: "source_changed", kind: "minefield", check: (w) => [MEMO_DOCX, MEMO_MD].some((p) => row(w, p)?.sha256 !== shaBefore(w, p)) || newRows(w).some((f) => f.path !== DECK) },
  { name: "slide_count_wrong", kind: "minefield", check: (w) => !!row(w, DECK) && slides(w) !== 3 },
];

export const task = defineTask<P11World>({
  id: "T-P11-07",
  cluster: "P11",
  clauses: ["B-P11-07"],
  priority: "nice-to-have",
  tier: 1,
  setup: { seed: 7, records: ["chat:c1", "a Renderer that answers pptx (F101 adds pptx to RENDER_FORMATS)"], files: ["documents/p11-memo.docx", "notes/p11-memo.md"], jobs: [] },
  turns: [{ kind: "prompt", by: sam.email, text: TEXT }],
  ...named(graders),
  collateral: {},
  graders,
  reference: "Muse built a new presentation with slide_count_target 3 (B-P11-07).",
});

export default task;
