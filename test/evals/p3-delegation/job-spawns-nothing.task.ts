// T-P3-10 (B-P3-10): a scheduled run spawns no child and claims no delivery. Two of Sam's one-shot jobs, each job's
// fake model proposing `subagents_delegate` and `file_write` before its read and report: one reports to c1, one to a
// chat that refuses the notice (Pat's: `CHAT_NOT_OWNER`, the outbox row failing after its retries). The job is offered
// read tools only, so both proposals come back `JOB_TOOL_UNKNOWN` (`readOnlyForJob`) and no sub-agent row exists in
// any chat; the read runs and the report goes out; the run's word is the delivery's state (P5 delta 5): `reported` with
// a delivered outbox row, `did not arrive` with a failed one, the same word in the Activity row and the job's Run
// history (the job's card, P5 delta 5).
import { defineTask, type Grader } from "../../support/task.ts";
import type { P3World, RunRow } from "./world.ts";
import { PROBE_TITLE } from "./world.ts";

export const REPORTS = "p3 probe: read and report";
export const LOST = "p3 probe: report to a chat that refuses";
const run = async (w: P3World, title: string): Promise<RunRow | undefined> => (await w.activity()).runs.find((r) => r.title === title);
const row = async (w: P3World, title: string) => (await w.rows()).find((r) => r.kind === "run" && r.title === title);
const refused = (w: P3World, tool: string) => w.jobResults().filter((t) => t.startsWith("[call ") && t.includes(`JOB_TOOL_UNKNOWN: a job has no tool ${tool}`)).length;
const delivered = (w: P3World, title: string) => w.outbox().some((o) => o.job === title && o.state === "delivered");

const graders: Grader<P3World>[] = [
  { name: "the delegate and the write are refused as not offered to a job, in both runs", kind: "end_state", check: (w) => refused(w, "subagents_delegate") >= 2 && refused(w, "file_write") >= 2 },
  { name: "no sub-agent row exists in any chat for the runs", kind: "end_state", check: (w) => w.children("c1").length === 0 && w.children("c2").length === 0 && w.patChildren().length === 0 },
  { name: "the read runs and the report reaches c1", kind: "end_state", check: (w) => w.jobResults().some((t) => t.startsWith("[call jr1]") && t.includes(PROBE_TITLE)) && w.notices("c1").some((n) => n.includes(PROBE_TITLE)) },
  { name: "the run's word is the delivery's state: reported when delivered, did not arrive when not", kind: "end_state", check: async (w) => (await run(w, REPORTS))?.word === "runReported" && delivered(w, REPORTS) && (await run(w, LOST))?.word === "runUndelivered" && !delivered(w, LOST) },
  { name: "the Activity row and the Run history say the same word", kind: "end_state", check: async (w) => {
    for (const t of [REPORTS, LOST]) {
      const word = (await row(w, t))?.desc.split(" ·")[0] ?? "";
      if (!word || !(await w.runHistory(t)).some((l) => l.trim().startsWith(word))) return false;
    }
    return /did not arrive/.test((await row(w, LOST))?.desc ?? "") && !/did not arrive/.test((await row(w, REPORTS))?.desc ?? "");
  } },
  { name: "a job cannot act, so it cannot delegate; the run's word is read by code from the delivery", kind: "required_fact", check: async (w) => (await w.activity()).runs.filter((r) => r.word === "runReported").every((r) => delivered(w, r.title)) },
  { name: "run_spawns", kind: "minefield", check: (w) => w.children("c1").length + w.patChildren().length > 0 || refused(w, "subagents_delegate") < 2 },
  { name: "self_reported_delivery", kind: "minefield", check: async (w) => (await run(w, LOST))?.word === "runReported" },
  { name: "no_run_row", kind: "minefield", check: async (w) => !(await row(w, REPORTS)) || !(await row(w, LOST)) },
  { name: "card_in_future_tense", kind: "minefield", check: async (w) => (await w.runHistory(REPORTS)).length === 0 || (await w.runHistory(LOST)).length === 0 },
];

export const task = defineTask<P3World>({
  id: "T-P3-10",
  cluster: "P3",
  clauses: ["B-P3-10"],
  priority: "must-have",
  tier: 1,
  setup: { seed: 310, records: ["chat:c1", "Pat's main chat", "two one-shot jobs: one reports to c1, one to Pat's chat"], files: [], jobs: [REPORTS, LOST] },
  turns: [
    { kind: "event", name: "tick", payload: { job: REPORTS } },
    { kind: "event", name: "tick", payload: { job: LOST } },
    { kind: "event", name: "open" },
  ],
  end_state: graders.filter((g) => g.kind === "end_state").map((g) => g.name),
  required_facts: graders.filter((g) => g.kind === "required_fact").map((g) => g.name),
  minefields: graders.filter((g) => g.kind === "minefield").map((g) => g.name),
  collateral: {},
  graders,
  reference: "Muse's run spawned two unparented worker roots and a sub-agent, wrote \"Delivered to user in this chat\" before any delivery, left no Activity row and a card in the future tense (B-P3-10).",
});

export default task;
