// T-P7-14 (B-P7-11): tier 2, the schedule's surfaces on a slot (`pnpm evals P7` with its page rubric, F30). Sam has a
// one-shot, a daily and a weekly job, and one turned off. Upcoming draws the three under Reminders, Daily and Weekly;
// the one turned off is not among them (fletch draws it under Off, after the cadence groups, so its dialog can turn it
// on again: B-P7-06). The daily job's dialog shows its status in words, its time, the run history collapsed and its
// fixed actions; the same after a reload; at phone width the panel is a bottom sheet.
import { defineTask, type Grader } from "../../support/task.ts";
import { fixedControls, type P7World } from "./world.ts";

export const JOBS = { once: "p7 probe: reminder at noon", daily: "p7 probe: daily at nine", weekly: "p7 probe: weekly on Monday", off: "p7 probe: turned off" };
const CADENCE = ["Reminders", "Daily", "Weekly"];
/** `JOB_STATUS_WORDS`, as the route says them. */
const WORDS = ["on", "off until you turn it on", "off", "on, but blocked", "needs your attention", "ran", "removed"];

const graders: Grader<P7World>[] = [
  { name: "three rows under their cadence groups, the one turned off not among them", kind: "end_state", check: async (w) => { const l = await w.listed(); return [JOBS.once, JOBS.daily, JOBS.weekly].every((t) => l.find((j) => j.title === t)?.listed === "upcoming") && l.find((j) => j.title === JOBS.off)?.listed !== "upcoming"; } },
  { name: "the dialog shows the badge in words, the time, the collapsed run history and the fixed actions", kind: "end_state", check: async (w) => { const d = await w.dialog(JOBS.daily); return !!d && d.state.length > 0 && /09:00/.test(d.words) && !d.historyOpen && fixedControls(d) && ["job-run", "job-toggle", "job-remove"].every((c) => d.controls.includes(c)); } },
  { name: "the same after the reload, and the phone draws the panel as a sheet", kind: "end_state", check: async (w) => (await w.listed()).filter((j) => j.listed === "upcoming").length === 3 && (await w.phoneSheet()) },
  { name: "group titles Reminders, Daily, Weekly; status words from JOB_STATUS_WORDS", kind: "required_fact", check: async (w) => { const g = (await w.groups()).filter((t) => t !== "Off"); return JSON.stringify(g) === JSON.stringify(CADENCE) && (await w.listed()).every((j) => WORDS.includes(j.words)); } },
  { name: "disabled_listed", kind: "minefield", check: async (w) => (await w.listed()).some((j) => j.title === JOBS.off && j.listed === "upcoming") },
  { name: "reload_loses_row", kind: "minefield", check: (w) => w.after().some((a) => a.upcoming.length !== 3) },
  { name: "model_text_as_button", kind: "minefield", check: async (w) => { const d = await w.dialog(JOBS.daily); return !d || !fixedControls(d); } },
];

export const task = defineTask<P7World>({
  id: "T-P7-14",
  cluster: "P7",
  clauses: ["B-P7-11"],
  priority: "nice-to-have",
  tier: 2,
  setup: { seed: 714, records: ["the slot", "Sam's one-shot, daily and weekly jobs, on", "one job turned off"], files: [], jobs: Object.values(JOBS) },
  turns: [
    { kind: "event", name: "reload" },
    { kind: "event", name: "reload" },
  ],
  end_state: graders.filter((g) => g.kind === "end_state").map((g) => g.name),
  required_facts: graders.filter((g) => g.kind === "required_fact").map((g) => g.name),
  minefields: graders.filter((g) => g.kind === "minefield").map((g) => g.name),
  collateral: {},
  graders,
  reference: "`step-1.png`, `step-1-phone.png`, `step-2-detail.png` (B-P7-11).",
});

export default task;
