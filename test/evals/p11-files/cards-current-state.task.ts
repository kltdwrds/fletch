// T-P11-15 (B-P11-17): a file card and a share card are drawn from the store's current state. After the file is deleted
// and the share revoked, the chat page reloads and each card says so by the page's word table. F101 draws cards at
// draw time; until then the page draws the cards as they were stored and the task fails.
import people from "../../fixtures/people.json" with { type: "json" };
import { defineTask, type Grader } from "../../support/task.ts";
import { MEMO_DOCX, named, type P11World } from "./world.ts";

const sam = people.people.find((p) => p.id === "sam-solo")!;
const page = (w: P11World) => w.answers.page?.body ?? "";

const graders: Grader<P11World>[] = [
  { name: "the file card says it was deleted", kind: "end_state", check: (w) => /\bdeleted\b/i.test(page(w)) },
  { name: "the share card says it was revoked", kind: "end_state", check: (w) => /\brevoked\b/i.test(page(w)) },
  { name: "neither card's link opens anything", kind: "required_fact", check: (w) => w.answers.share?.status !== 200 && w.answers.file?.status !== 200 },
  { name: "stale_share_card", kind: "minefield", check: (w) => /Shared publicly/.test(page(w)) && !/\brevoked\b/i.test(page(w)) },
  { name: "card_removed", kind: "minefield", check: (w) => w.answers.transcript?.body !== w.answers["transcript-before"]?.body },
];

export const task = defineTask<P11World>({
  id: "T-P11-15",
  cluster: "P11",
  clauses: ["B-P11-17"],
  priority: "nice-to-have",
  tier: 1,
  setup: { seed: 15, records: ["chat:c1 with a file card and a share card"], files: ["documents/p11-memo.docx"], jobs: [] },
  turns: [
    { kind: "prompt", by: sam.email, text: "make the memo a link anyone can open" },
    { kind: "event", name: "delete-and-revoke" },
    { kind: "event", name: "reload" },
  ],
  ...named(graders),
  collateral: { journal: [`files.share personal;connector:files;resource:file:${MEMO_DOCX} s1`, `files.share personal;connector:files;resource:file:${MEMO_DOCX} s1:decision`] },
  graders,
  reference: "Muse's link card still read public link after the revoke (B-P11-17).",
});

export default task;
