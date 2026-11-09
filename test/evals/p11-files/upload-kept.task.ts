// T-P11-13 (B-P11-15): an attached file asked to be kept is saved in the Library once, under its own name. The upload
// is in Sam's working tree at `work/uploads/u1/p11-probe.txt`, as `ingestAttachment` leaves it (the attachment path is
// M24.3's `m24-3-uploads.test.ts`); the fake reads it and `file_write`s its text to the home path `p11-probe.txt`; asked
// again, it keeps no second copy.
import people from "../../fixtures/people.json" with { type: "json" };
import { defineTask, type Grader } from "../../support/task.ts";
import { indexOf, named, newRows, type P11World, PROBE_TXT, replyTo, row } from "./world.ts";

const sam = people.people.find((p) => p.id === "sam-solo")!;
export const TEXT = "summarise the file I just attached in one sentence and keep it in my library";
export const AGAIN = "keep the file I attached in my library";
const UPLOAD = "work/uploads/u1/p11-probe.txt";
const readAt = (w: P11World) => indexOf(w, (e) => e.role === "call" && e.tool === "file_read" && e.text.includes(UPLOAD));
const replyAt = (w: P11World) => indexOf(w, (e) => e.role === "agent");
/** The upload's lines as the fixture writes them. */
const UPLOAD_TEXT = "Sam Solo owns the p11 probe.\nPat Solo reads it.\nSolo Sam keeps it.\n";

const graders: Grader<P11World>[] = [
  { name: "one Library row p11-probe.txt whose bytes equal the upload", kind: "end_state", check: (w) => newRows(w).length === 1 && row(w, PROBE_TXT)?.text === UPLOAD_TEXT },
  { name: "the reply names it", kind: "end_state", check: (w) => replyTo(w, 1).includes(`files/${PROBE_TXT}`) },
  { name: "the summary names a fixture name from the file", kind: "required_fact", check: (w) => /Sam Solo|Pat Solo|Solo Sam/.test(replyTo(w, 1)) },
  { name: "double_keep", kind: "minefield", check: (w) => w.entries().filter((e) => e.role === "call" && e.tool === "file_write").length > 1 || newRows(w).length > 1 },
  { name: "unread_summary", kind: "minefield", check: (w) => readAt(w) === -1 || replyAt(w) < readAt(w) },
];

export const task = defineTask<P11World>({
  id: "T-P11-13",
  cluster: "P11",
  clauses: ["B-P11-15"],
  priority: "nice-to-have",
  tier: 1,
  setup: { seed: 13, records: ["chat:c1", "a text attachment p11-probe.txt of three fixture lines in work/uploads/u1/"], files: [], jobs: [] },
  turns: [
    { kind: "prompt", by: sam.email, text: TEXT },
    { kind: "prompt", by: sam.email, text: AGAIN },
  ],
  ...named(graders),
  collateral: {},
  graders,
  reference: "Muse copied the upload into the Library (B-P11-15).",
});

export default task;
