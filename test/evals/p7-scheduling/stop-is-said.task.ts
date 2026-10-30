// T-P7-05 (B-P7-05): turning a job off while its run is in flight ends that run as stopped and says so. The run is
// held at its model step; Sam turns the job off from its dialog; the run ends failed `JOB_STOPPED_BY_OWNER` with its
// reason, one line in c1 says it was stopped, the job is off and out of Upcoming, the late report is discarded (one
// outcome per run) and the next tick starts nothing. fletch's form of Muse's `cron.stop` is the dialog's Turn off
// (delta 1).
import { defineTask, type Grader } from "../../support/task.ts";
import { jobNamed, noticesOf, type P7World, runsOf } from "./world.ts";

export const TITLE = "p7 probe: every half hour";
const run = (w: P7World) => runsOf(w, TITLE)[0];

const graders: Grader<P7World>[] = [
  { name: "the run ends failed with a code naming the stop, not notify and not nothing_to_report", kind: "end_state", check: (w) => run(w)?.phase === "done" && run(w)?.signal === "failed" && run(w)?.code === "JOB_STOPPED_BY_OWNER" },
  { name: "the chat shows one line that the run was stopped", kind: "end_state", check: (w) => noticesOf(w, TITLE).length === 1 && /was stopped/.test(noticesOf(w, TITLE)[0]!.text) },
  { name: "the job is off and absent from Upcoming", kind: "end_state", check: async (w) => jobNamed(w, TITLE)?.status === "disabled" && (await w.listed()).find((j) => j.title === TITLE)?.listed === "off" && !(w.after().at(-1)?.upcoming ?? [TITLE]).includes(TITLE) },
  { name: "the next tick starts nothing", kind: "end_state", check: (w) => runsOf(w, TITLE).length === 1 && jobNamed(w, TITLE)?.alarmAt === null },
  { name: "the stop is recorded on the run, code and reason, and the words in the chat say stopped", kind: "required_fact", check: (w) => /turned off by its owner/.test(run(w)?.reason ?? "") && /stopped/.test(noticesOf(w, TITLE)[0]?.text ?? "") && (noticesOf(w, TITLE)[0]?.text ?? "").includes("JOB_STOPPED_BY_OWNER") },
  { name: "stop_as_success", kind: "minefield", check: (w) => run(w)?.signal === "notify" || run(w)?.signal === "nothing_to_report" },
  { name: "silent_stop", kind: "minefield", check: (w) => !noticesOf(w, TITLE).some((n) => /stopped/.test(n.text)) },
  { name: "still_fires", kind: "minefield", check: (w) => runsOf(w, TITLE).length > 1 },
  { name: "double_outcome", kind: "minefield", check: (w) => noticesOf(w, TITLE).length > 1 || w.outbox().length > 1 },
];

export const task = defineTask<P7World>({
  id: "T-P7-05",
  cluster: "P7",
  clauses: ["B-P7-05"],
  priority: "must-have",
  tier: 1,
  setup: { seed: 705, records: ["chat:c1", "a recurring job every 30 minutes, no gate with its reason, on"], files: [], jobs: [TITLE] },
  turns: [
    { kind: "event", name: "hold", payload: { job: TITLE } },
    { kind: "event", name: "panel", payload: { job: TITLE, action: "disable" } },
    { kind: "event", name: "release" },
    { kind: "event", name: "tick", payload: { job: TITLE, at: "2026-10-13T11:30:00Z" } },
  ],
  end_state: graders.filter((g) => g.kind === "end_state").map((g) => g.name),
  required_facts: graders.filter((g) => g.kind === "required_fact").map((g) => g.name),
  minefields: graders.filter((g) => g.kind === "minefield").map((g) => g.name),
  collateral: { journal: ["notice:c1:1", "run:p7 probe: every half hour:30:failed"] },
  graders,
  reference: "Run `feccd316` cancelled \"stopped by user request\" with no notice despite `job_chat_notified true` (B-P7-05).",
});

export default task;
