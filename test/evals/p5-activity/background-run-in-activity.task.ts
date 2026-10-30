// T-P5-09 (B-P5-09): a background run is in Activity and says how it went. Three one-shot jobs of Sam's run: one reports
// to c1, one certifies nothing to report, one reports to a chat that refuses the notice (Pat's, so the Chat answers
// `CHAT_NOT_OWNER` and the outbox row fails after its retries, fletch's form of the failed B7 check). Each run is a row
// of the Activity tab with its word from the panel's table, read through the delivery's state (delta 5), the same word
// in the job dialog's Run history: reported, nothing new, did not arrive.
import { defineTask, type Grader } from "../../support/task.ts";
import type { P5World, RunRow } from "./world.ts";

export const REPORTS = "p5 probe: say it is up";
export const QUIET = "p5 probe: say nothing if unchanged";
export const LOST = "p5 probe: report to a chat that refuses";
const runs = async (w: P5World): Promise<RunRow[]> => (await w.activity()).runs;
const run = async (w: P5World, title: string) => (await runs(w)).find((r) => r.title === title);
/** The row's words as the panel says a run's word (`PANEL_TEXT`). */
const SAID: Record<string, RegExp> = { runReported: /^reported/, runNothing: /^nothing new/, runUndelivered: /did not arrive/, runFailed: /did not finish/ };
const rowsOf = async (w: P5World) => (await w.rows()).filter((r) => r.kind === "run");

const graders: Grader<P5World>[] = [
  { name: "each run has an Activity row with its word from the panel's table", kind: "end_state", check: async (w) => {
    const rows = await rowsOf(w);
    return (await runs(w)).length === 3 && [REPORTS, QUIET, LOST].every((t) => rows.some((r) => r.title === t && r.glyph === "clock"));
  } },
  { name: "the reported run's message is in c1 and its row says reported", kind: "end_state", check: async (w) => (await run(w, REPORTS))?.word === "runReported" && w.notices("c1").length === 1 && (await rowsOf(w)).find((r) => r.title === REPORTS)?.desc.startsWith("reported") === true },
  { name: "the silent run says nothing new and posts nothing", kind: "end_state", check: async (w) => (await run(w, QUIET))?.word === "runNothing" && (await rowsOf(w)).find((r) => r.title === QUIET)?.desc.startsWith("nothing new") === true && w.notices("c1").every((n) => !/unchanged|nothing/i.test(n)) },
  { name: "the undelivered run's row and the dialog's history say it did not arrive", kind: "end_state", check: async (w) => (await run(w, LOST))?.word === "runUndelivered" && /did not arrive/.test((await rowsOf(w)).find((r) => r.title === LOST)?.desc ?? "") && (await w.runHistory(LOST)).some((l) => /did not arrive/.test(l)) },
  { name: "a run's word is the same in the dialog's history and the row", kind: "required_fact", check: async (w) => {
    for (const r of await runs(w)) {
      const h = await w.runHistory(r.title);
      const row = (await rowsOf(w)).find((x) => x.title === r.title);
      const word = row?.desc.split(" ·")[0] ?? "";
      if (!SAID[r.word]?.test(word) || !h.some((l) => l.trim().startsWith(word))) return false;
    }
    return true;
  } },
  { name: "no run reads reported without a delivered outbox row", kind: "required_fact", check: async (w) => (await runs(w)).filter((r) => r.word === "runReported").every((r) => w.outbox().some((o) => o.job === r.title && o.state === "delivered")) },
  { name: "succeeded_undelivered", kind: "minefield", check: async (w) => (await runs(w)).some((r) => r.word === "runReported" && !w.outbox().some((o) => o.job === r.title && o.state === "delivered")) },
  { name: "run_invisible", kind: "minefield", check: async (w) => (await rowsOf(w)).length < 3 },
  { name: "silent_message", kind: "minefield", check: (w) => w.notices("c1").length > 1 },
  { name: "two_words", kind: "minefield", check: async (w) => {
    for (const r of await rowsOf(w)) if (!(await w.runHistory(r.title)).some((l) => l.includes(r.desc.split(" ·")[0] as string))) return true;
    return false;
  } },
];

export const task = defineTask<P5World>({
  id: "T-P5-09",
  cluster: "P5",
  clauses: ["B-P5-09"],
  priority: "must-have",
  tier: 1,
  setup: { seed: 509, records: ["chat:c1", "Pat's main chat", "three one-shot jobs: one reports to c1, one certifies silence, one reports to Pat's chat"], files: [], jobs: [REPORTS, QUIET, LOST] },
  turns: [
    { kind: "event", name: "tick", payload: { job: REPORTS } },
    { kind: "event", name: "tick", payload: { job: QUIET } },
    { kind: "event", name: "tick", payload: { job: LOST } },
    { kind: "event", name: "open" },
  ],
  end_state: graders.filter((g) => g.kind === "end_state").map((g) => g.name),
  required_facts: graders.filter((g) => g.kind === "required_fact").map((g) => g.name),
  minefields: graders.filter((g) => g.kind === "minefield").map((g) => g.name),
  collateral: {},
  graders,
  reference: "Muse's run that \"Succeeded\" with `result_summary null`, no message and no Activity row (B-P5-09).",
});

export default task;
