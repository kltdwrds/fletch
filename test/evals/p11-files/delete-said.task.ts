// T-P11-12 (B-P11-14): a deleted file leaves a content-free journal row and ends every share of it. The deck has a live
// share; the fake calls `file_delete`. F101 has the delete end its shares and write the row (`files.delete`, subject
// `resource:file:<path>`); until then the share survives and no row is written, and the task fails.
import people from "../../fixtures/people.json" with { type: "json" };
import { defineTask, type Grader } from "../../support/task.ts";
import { homeR2, named, type P11World, replyTo, row } from "./world.ts";

const sam = people.people.find((p) => p.id === "sam-solo")!;
export const TEXT = "delete the deck";
export const DECK_PATH = "documents/p11-deck.pptx";
const deleteRow = async (w: P11World) => (await w.journal()).find((j) => j.startsWith("files.delete ") && j.includes(`resource:file:${DECK_PATH}`));

const graders: Grader<P11World>[] = [
  { name: "the row and its R2 bytes are gone", kind: "end_state", check: (w) => !row(w, DECK_PATH) && !w.answers.bytes },
  { name: "the share answers as unknown", kind: "end_state", check: (w) => w.answers.share?.code === "SHARE_UNKNOWN" && w.shares().length === 0 && w.pointers().length === 0 },
  { name: "a journal row names files.delete and the file", kind: "end_state", check: async (w) => !!(await deleteRow(w)) },
  { name: "the reply says the deck was deleted and its share ended", kind: "end_state", check: (w) => /\bdeleted\b/i.test(replyTo(w, 1)) && /\b(share|link)\b.*\b(ended|stopped|no longer)\b/i.test(replyTo(w, 1)) },
  { name: "the journal row's subject is resource:file:documents/p11-deck.pptx", kind: "required_fact", check: async (w) => (await deleteRow(w))?.endsWith(`resource:file:${DECK_PATH}`) === true },
  { name: "share_survives", kind: "minefield", check: (w) => w.answers.share?.status === 200 || w.shares().length > 0 },
  { name: "no_journal", kind: "minefield", check: async (w) => !(await deleteRow(w)) },
  { name: "content_in_journal", kind: "minefield", check: async (w) => (await w.journalText()).includes("p11 deck slide") },
];

export const task = defineTask<P11World>({
  id: "T-P11-12",
  cluster: "P11",
  clauses: ["B-P11-14"],
  priority: "must-have",
  tier: 1,
  setup: { seed: 12, records: ["chat:c1", "a live share of the deck"], files: ["documents/p11-deck.pptx"], jobs: [] },
  turns: [{ kind: "prompt", by: sam.email, text: TEXT }],
  ...named(graders),
  collateral: { journal: [`files.delete personal;resource:file:${DECK_PATH}`] },
  graders,
  reference: `Muse's delete left no audit row and an orphan identity row (B-P11-14); the deck's R2 key ${homeR2(DECK_PATH)} goes with it.`,
});

export default task;
