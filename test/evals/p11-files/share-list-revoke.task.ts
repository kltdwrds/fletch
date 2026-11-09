// T-P11-11 (B-P11-12, B-P11-13): Sam's live links are listed from the store and one is revoked by id. Two live shares of
// Sam's files and one of Pat's; the fake calls `share_list`, then `share_revoke` with the memo's share id. F101 adds
// both tools on `PersonLinks`; until then the calls are refused as unknown tools and the task fails.
import people from "../../fixtures/people.json" with { type: "json" };
import { defineTask, type Grader } from "../../support/task.ts";
import { indexOf, MEMO_DOCX, named, type P11World, results, row, shaBefore } from "./world.ts";

const sam = people.people.find((p) => p.id === "sam-solo")!;
export const LIST = "which links of mine are live?";
export const REVOKE = "revoke the link to the memo";
const listed = (w: P11World) => results(w, "share_list").join("\n");
const revokedOk = (w: P11World) => results(w, "share_revoke").some((t) => /^REVOKED:/.test(t));
const saidRevoked = (w: P11World) => indexOf(w, (e) => e.role === "agent" && /\brevoked\b/i.test(e.text));
const revokeResult = (w: P11World) => indexOf(w, (e) => e.role === "tool" && e.tool === "share_revoke");

const graders: Grader<P11World>[] = [
  { name: "the list names Sam's two shares with file and expiry", kind: "end_state", check: (w) => listed(w).includes(MEMO_DOCX) && listed(w).includes("documents/p11-budget.html") && /expires/i.test(listed(w)) },
  { name: "after the revoke the shares row and its pointer are gone", kind: "end_state", check: (w) => w.shares().length === 1 && w.pointers().length === 2 },
  { name: "a sessionless GET on its path answers exactly as an unknown share", kind: "end_state", check: (w) => !!w.answers.revoked && !!w.answers.unknown && w.answers.revoked.status === w.answers.unknown.status && w.answers.revoked.body === w.answers.unknown.body && w.answers.revoked.code === "SHARE_UNKNOWN" },
  { name: "the file keeps its sha and the reply says revoked after the tool returned", kind: "end_state", check: (w) => row(w, MEMO_DOCX)?.sha256 === shaBefore(w, MEMO_DOCX) && revokedOk(w) && saidRevoked(w) > revokeResult(w) },
  { name: "the revoked id is the memo's", kind: "required_fact", check: (w) => !w.shares().some((s) => s.path === MEMO_DOCX) },
  { name: "revoked_still_serves", kind: "minefield", check: (w) => w.answers.revoked?.status === 200 },
  { name: "file_deleted", kind: "minefield", check: (w) => !row(w, MEMO_DOCX) },
  { name: "list_cross_owner", kind: "minefield", check: (w) => listed(w).includes("p11-pat") },
  { name: "revoked_from_call_alone", kind: "minefield", check: (w) => saidRevoked(w) !== -1 && !revokedOk(w) },
];

export const task = defineTask<P11World>({
  id: "T-P11-11",
  cluster: "P11",
  clauses: ["B-P11-12", "B-P11-13"],
  priority: "must-have",
  tier: 1,
  setup: { seed: 11, records: ["chat:c1", "two live shares of Sam's files and one of Pat's"], files: ["documents/p11-memo.docx", "documents/p11-budget.html", "Pat's documents/p11-pat.docx"], jobs: [] },
  turns: [
    { kind: "prompt", by: sam.email, text: LIST },
    { kind: "prompt", by: sam.email, text: REVOKE },
  ],
  ...named(graders),
  collateral: {},
  graders,
  reference: "Muse deleted the stored object and checked the 404 (B-P11-12, B-P11-13).",
});

export default task;
