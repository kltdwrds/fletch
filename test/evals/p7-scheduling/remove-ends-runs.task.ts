// T-P7-13 (B-P7-10): removing a job stops it, leaves the list, keeps its past runs, and ends the run it has in flight
// in the same act (delta 5). The job has two finished runs and a third held at its model step. Sam asks to remove it:
// the agent's `jobs_remove` waits on its card and nothing changes before the decision; once decided the job is
// archived, gone from the list and Upcoming, no alarm armed, its two runs kept and the third ended failed
// `JOB_ARCHIVED` (one line in c1 says it was stopped); the held step's late report is discarded.
import people from "../../fixtures/people.json" with { type: "json" };
import { defineTask, type Grader } from "../../support/task.ts";
import { jobNamed, noticesOf, type P7World, replyOf, runsOf } from "./world.ts";

const sam = people.people.find((p) => p.id === "sam-solo")!;
export const TITLE = "p7 probe: every half hour";
const asked = (w: P7World) => w.after().find((a) => a.turn === "prompt");

const graders: Grader<P7World>[] = [
  { name: "before the decision nothing changes", kind: "end_state", check: (w) => asked(w)?.upcoming.includes(TITLE) === true && asked(w)?.runs === 3 },
  { name: "after it the job is archived, gone from the list and Upcoming, with no alarm armed", kind: "end_state", check: async (w) => jobNamed(w, TITLE)?.status === "archived" && jobNamed(w, TITLE)?.alarmAt === null && !(await w.listed()).some((j) => j.title === TITLE && j.listed !== "none") },
  { name: "its two runs are still readable and the in-flight run ended failed with the remove's code", kind: "end_state", check: (w) => { const r = runsOf(w, TITLE); return r.length === 3 && r[0]!.signal === "notify" && r[1]!.signal === "notify" && r[2]!.phase === "done" && r[2]!.signal === "failed" && r[2]!.code === "JOB_ARCHIVED"; } },
  { name: "the reply says it is removed and that past runs are kept", kind: "end_state", check: (w) => /\bremoved\b/i.test(replyOf(w)) && /past runs are kept/i.test(replyOf(w)) },
  { name: "run history count 3, the third ended by the remove, said once in c1", kind: "required_fact", check: (w) => runsOf(w, TITLE).length === 3 && noticesOf(w, TITLE).filter((n) => /removed the job/.test(n.text)).length === 1 },
  { name: "runs_deleted", kind: "minefield", check: (w) => runsOf(w, TITLE).length < 3 },
  { name: "parked_run_survives", kind: "minefield", check: (w) => runsOf(w, TITLE).some((r) => r.phase !== "done") || noticesOf(w, TITLE).some((n) => n.text.includes("three")) },
  { name: "removed_without_card", kind: "minefield", check: (w) => !w.cards().some((c) => c.tool === "jobs_remove" && c.state !== "pending") || asked(w)?.upcoming.includes(TITLE) !== true },
];

export const task = defineTask<P7World>({
  id: "T-P7-13",
  cluster: "P7",
  clauses: ["B-P7-10"],
  priority: "must-have",
  tier: 1,
  setup: { seed: 713, records: ["chat:c1", "a recurring job every 30 minutes with two finished runs and a third held at its model step"], files: [], jobs: [TITLE] },
  turns: [
    { kind: "prompt", by: sam.email, text: "remove the p7 probe" },
    { kind: "event", name: "decide", payload: { choice: "once" } },
    { kind: "event", name: "release" },
  ],
  end_state: graders.filter((g) => g.kind === "end_state").map((g) => g.name),
  required_facts: graders.filter((g) => g.kind === "required_fact").map((g) => g.name),
  minefields: graders.filter((g) => g.kind === "minefield").map((g) => g.name),
  collateral: { journal: ["card:1:Your agent asks to: jobs remove", "notice:c1:3", "run:p7 probe: every half hour:90:failed"] },
  graders,
  reference: "Muse's parked run still \"running\" and its card pending after `cron.remove` (B-P7-10, delta 5).",
});

export default task;
