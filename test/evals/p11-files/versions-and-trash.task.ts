// T-P11-05 (B-P11-05, B-P11-14): a write over a Library file keeps the earlier bytes as a numbered version, and a
// deleted file sits in a trash, on the store F103 builds under D-0028 (proposed). Each step is one of Sam's requests to
// the routes F103 names (`/app/file/versions`, `/app/file/version`, `/app/file/restore`, `/app/trash`,
// `/app/trash/restore`); until F103 they do not exist, and the task fails on its first end state. Nice-to-have, so the
// cluster's level never rests on an unaccepted door.
import { defineTask, type Grader } from "../../support/task.ts";
import { MEMO_MD, named, type P11World } from "./world.ts";

/** The texts the setup writes, first and second. */
export const FIRST = "# p11 memo\n\nfirst\n";
export const SECOND = "# p11 memo\n\nsecond\n";
const body = (w: P11World, k: string): Record<string, unknown> => {
  try {
    return JSON.parse(w.answers[k]?.body ?? "{}") as Record<string, unknown>;
  } catch {
    return {};
  }
};
const versions = (w: P11World, k: string) => (body(w, k).versions as Array<{ n: number; sha256: string }> | undefined) ?? [];

const graders: Grader<P11World>[] = [
  { name: "version 1's bytes equal the first write's", kind: "end_state", check: (w) => w.answers.v1?.status === 200 && body(w, "v1").text === FIRST },
  { name: "a restore makes a new current version and keeps the one it replaced", kind: "end_state", check: (w) => versions(w, "after-restore").length === versions(w, "versions").length + 1 },
  { name: "the deleted file is in the trash with its versions until restored", kind: "end_state", check: (w) => JSON.stringify(body(w, "trash")).includes(MEMO_MD) },
  { name: "restored, the path answers again", kind: "end_state", check: (w) => w.files().some((f) => f.path === MEMO_MD) },
  { name: "every version's sha matches its bytes", kind: "required_fact", check: (w) => versions(w, "after-restore").length > 0 && versions(w, "after-restore").every((v) => /^[0-9a-f]{64}$/.test(v.sha256)) },
  { name: "restore_overwrites", kind: "minefield", check: (w) => w.answers["after-restore"]?.status === 200 && versions(w, "after-restore").length <= versions(w, "versions").length },
  { name: "trash_lost", kind: "minefield", check: (w) => w.answers.trash?.status === 200 && !JSON.stringify(body(w, "trash")).includes(MEMO_MD) },
];

export const task = defineTask<P11World>({
  id: "T-P11-05",
  cluster: "P11",
  clauses: ["B-P11-05", "B-P11-14"],
  priority: "nice-to-have",
  tier: 1,
  setup: { seed: 5, records: ["the store F103 builds under D-0028 (proposed)"], files: ["notes/p11-memo.md written twice with different text"], jobs: [] },
  turns: [
    { kind: "event", name: "versions", payload: { path: MEMO_MD } },
    { kind: "event", name: "open-version", payload: { path: MEMO_MD, n: "1" } },
    { kind: "event", name: "restore-version", payload: { path: MEMO_MD, n: "1" } },
    { kind: "event", name: "delete", payload: { path: MEMO_MD } },
    { kind: "event", name: "trash" },
    { kind: "event", name: "restore-trash", payload: { path: MEMO_MD } },
  ],
  ...named(graders),
  collateral: {},
  graders,
  reference: "No version existed after either of Muse's edits, and its delete had no trash (B-P11-05, B-P11-14; answers/step-3.md, answers/step-12.md).",
});

export default task;
