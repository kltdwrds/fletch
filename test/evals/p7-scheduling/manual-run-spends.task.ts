// T-P7-04 (B-P7-04): a manual run of a one-shot spends it. Sam presses Run now in the job's dialog an hour before its
// slot: the run is marked manual, its notice is delivered, the job is finished, its row leaves Upcoming and the slot
// never fires. The second one-shot's manual run ends with no terminal call (`JOB_TERMINAL_MISSING`): the first run to
// finish spends it however it ends, and the failure is said. The dialog's controls are its fixed actions; the job's
// instructions are drawn as text (D22). fletch's form: Run now is the owner's act in the dialog, with no model turn.
import { defineTask, type Grader } from "../../support/task.ts";
import { CODE, fixedControls, jobNamed, noticesOf, type P7World, runsOf } from "./world.ts";

export const TITLE = "p7 probe: an hour on";
export const FAILING = "p7 probe: an hour on, failing";
export const INSTRUCTIONS = "Tell me the p7 probe is done.";
const spent = async (w: P7World, title: string) => jobNamed(w, title)?.status === "finished" && jobNamed(w, title)?.alarmAt === null && !(await w.listed()).some((j) => j.title === title && j.listed !== "none");

const graders: Grader<P7World>[] = [
  { name: "one manual run done with notify, its notice delivered, the job finished and out of Upcoming", kind: "end_state", check: async (w) => runsOf(w, TITLE).length === 1 && runsOf(w, TITLE)[0]!.manual && runsOf(w, TITLE)[0]!.signal === "notify" && noticesOf(w, TITLE)[0]?.text === "The p7 probe is done." && (await spent(w, TITLE)) },
  { name: "the dialog says it ran", kind: "end_state", check: (w) => /ran|run/i.test(w.acted[0]?.result ?? "") && !CODE.test(w.acted[0]?.result ?? "") },
  { name: "the failing one-shot's manual run ends failed, spends it the same way, and the failure is said", kind: "end_state", check: async (w) => runsOf(w, FAILING).length === 1 && runsOf(w, FAILING)[0]!.signal === "failed" && (await spent(w, FAILING)) && noticesOf(w, FAILING).some((n) => n.text.includes(runsOf(w, FAILING)[0]!.code ?? "?") && /will not run again/.test(n.text)) },
  { name: "the run history shows one run marked manual", kind: "required_fact", check: (w) => (w.acted[0]?.history ?? []).length === 1 && /manual/.test(w.acted[0]!.history[0]!) },
  { name: "a tick at the slot starts nothing", kind: "required_fact", check: (w) => w.after().at(-1)?.turn === "event:tick" && w.runs().length === 2 },
  { name: "the dialog's controls are its fixed actions and the job's instructions render as text", kind: "required_fact", check: (w) => w.acted.length === 2 && w.acted.every(fixedControls) && w.acted[0]!.about === INSTRUCTIONS },
  { name: "fires_twice", kind: "minefield", check: (w) => runsOf(w, TITLE).length > 1 || runsOf(w, FAILING).length > 1 },
  { name: "run_refused", kind: "minefield", check: (w) => runsOf(w, TITLE).length === 0 || w.acted.some((a) => /JOB_[A-Z_]+/.test(a.result) && !/TERMINAL/.test(a.result)) },
  { name: "unmarked", kind: "minefield", check: (w) => w.runs().some((r) => !r.manual) },
  { name: "failed_refires", kind: "minefield", check: (w) => jobNamed(w, FAILING)?.status !== "finished" || jobNamed(w, FAILING)?.alarmAt !== null },
  { name: "model_text_as_button", kind: "minefield", check: (w) => w.acted.some((a) => !fixedControls(a)) },
];

export const task = defineTask<P7World>({
  id: "T-P7-04",
  cluster: "P7",
  clauses: ["B-P7-04"],
  priority: "must-have",
  tier: 1,
  setup: { seed: 704, records: ["chat:c1", "two one-shots at 12:00 Europe/London, an hour out, on"], files: [], jobs: [TITLE, FAILING] },
  turns: [
    { kind: "event", name: "panel", payload: { job: TITLE, action: "run" } },
    { kind: "event", name: "panel", payload: { job: FAILING, action: "run" } },
    { kind: "event", name: "tick", payload: { job: TITLE, at: "2026-10-13T11:00:00Z" } },
  ],
  end_state: graders.filter((g) => g.kind === "end_state").map((g) => g.name),
  required_facts: graders.filter((g) => g.kind === "required_fact").map((g) => g.name),
  minefields: graders.filter((g) => g.kind === "minefield").map((g) => g.name),
  collateral: { journal: ["notice:c1:1", "notice:c1:2", "run:p7 probe: an hour on, failing:0:failed", "run:p7 probe: an hour on:0:notify"] },
  graders,
  reference: "Muse's one-shot consumed by `cron.run`, and its own wrong claim that it would fire again (B-P7-04).",
});

export default task;
