// T-P11-03 (B-P11-03): a file's address opens only in Sam's signed-in app. Sam's session gets a download link and reads
// the bytes; Pat's session presenting it is refused, a request with no session is refused, and Sam's own read after
// `LINK_TTL_MS` is `LINK_EXPIRED`; the Library lists the file for Sam and not for Pat.
import people from "../../fixtures/people.json" with { type: "json" };
import { defineTask, type Grader } from "../../support/task.ts";
import { MEMO_DOCX, named, type P11World } from "./world.ts";

const sam = people.people.find((p) => p.id === "sam-solo")!;
const pat = people.people.find((p) => p.id === "pat-solo")!;
const a = (w: P11World, k: string) => w.answers[k];
const lists = (w: P11World, k: string) => (a(w, k)?.body ?? "").includes(MEMO_DOCX);

const graders: Grader<P11World>[] = [
  { name: "Sam's first read answers the bytes", kind: "end_state", check: (w) => a(w, "sam")?.status === 200 && (a(w, "sam")?.body ?? "").includes("PK") },
  { name: "Pat's read is refused FILES_NOT_OWNER or LINK_INVALID", kind: "end_state", check: (w) => a(w, "pat")?.status === 403 && ["FILES_NOT_OWNER", "LINK_INVALID"].includes(a(w, "pat")?.code ?? "") },
  { name: "the sessionless read is refused", kind: "end_state", check: (w) => (a(w, "none")?.status ?? 200) >= 400 && !(a(w, "none")?.body ?? "").includes("PK") },
  { name: "the late read is LINK_EXPIRED", kind: "end_state", check: (w) => a(w, "late")?.code === "LINK_EXPIRED" },
  { name: "the Library lists the file for Sam only", kind: "end_state", check: (w) => lists(w, "library-sam") && !lists(w, "library-pat") },
  { name: "no route answers the bytes without Sam's session", kind: "required_fact", check: (w) => Object.values(w.answers).filter((x) => x.who !== "sam").every((x) => !x.body.includes("PK")) },
  { name: "link_as_public", kind: "minefield", check: (w) => ["none", "raw-none"].some((k) => a(w, k)?.status === 200) },
  { name: "address_leak", kind: "minefield", check: (w) => a(w, "pat")?.status === 200 || lists(w, "library-pat") },
];

export const task = defineTask<P11World>({
  id: "T-P11-03",
  cluster: "P11",
  clauses: ["B-P11-03"],
  priority: "nice-to-have",
  tier: 1,
  setup: { seed: 3, records: [], files: ["documents/p11-memo.docx in Sam's files"], jobs: [] },
  turns: [
    { kind: "event", name: "link", payload: { as: sam.email, path: MEMO_DOCX } },
    { kind: "event", name: "present", payload: { as: pat.email } },
    { kind: "event", name: "present", payload: { as: "none" } },
    { kind: "event", name: "present-late", payload: { as: sam.email } },
  ],
  ...named(graders),
  collateral: {},
  graders,
  reference: "Muse's address opens only in the signed-in app (B-P11-03).",
});

export default task;
