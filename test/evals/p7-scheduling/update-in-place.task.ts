// T-P7-06 (B-P7-06): a job is changed in place and paused as itself. Sam asks to move the daily 09:00 probe to 09:30
// on the second paragraph: `jobs_update` keeps the id and the previous definition on the job's record, and since the
// agent changed what the job does, the job waits on its card again (fletch's trust rule: an agent's edit of an
// approved job's instructions is decided like its create); Sam decides it. "pause the p7 probe" is `jobs_disable`: the
// job is off, listed off and out of Upcoming, and a tick at 09:30 starts nothing. Turned on from its dialog, the same
// id is back in Upcoming and fires at its next 09:30 with the new instructions.
import people from "../../fixtures/people.json" with { type: "json" };
import { defineTask, type Grader } from "../../support/task.ts";
import { jobNamed, type P7World, runsOf } from "./world.ts";

const sam = people.people.find((p) => p.id === "sam-solo")!;
export const TITLE = "p7 probe: the morning check";
export const ID = "p7-probe-morning";
export const MOVED = "Read the second paragraph of the p7 probe page.";
const local = (t: number) => new Date(t).toLocaleString("sv-SE", { timeZone: "Europe/London" }).slice(11, 16);
const pausedAt = (w: P7World) => w.after().findIndex((a) => a.turn === "event:panel");
/** The tick at 09:30 after the pause: the first tick of the turns. */
const pausedTick = (w: P7World) => w.after().findIndex((a) => a.turn === "event:tick");

const graders: Grader<P7World>[] = [
  { name: "the same job id with the new time and instructions, one job in the list", kind: "end_state", check: (w) => w.jobs().length === 1 && jobNamed(w, TITLE)?.id === ID && /09:30/.test(jobNamed(w, TITLE)!.cadence) && jobNamed(w, TITLE)!.instructions === MOVED },
  { name: "the previous definition is kept, readable from the job's record and its dialog", kind: "end_state", check: async (w) => jobNamed(w, TITLE)?.history.some((h) => /09:00/.test(h.cadence) && h.instructions !== MOVED) === true && ((await w.dialog(TITLE))?.history ?? []).some((l) => /Before/.test(l) && /09:00/.test(l)) },
  { name: "after the pause the job is off and absent from Upcoming, and a tick at 09:30 starts nothing", kind: "end_state", check: (w) => { const i = pausedAt(w); return i > 0 && !w.after()[i - 1]!.upcoming.includes(TITLE) && w.after()[i - 1]!.turn === "event:tick" && w.after()[i - 1]!.runs === 0; } },
  { name: "turned on from the dialog, the same id is back in Upcoming and fires at its next 09:30", kind: "end_state", check: (w) => { const i = pausedAt(w); return i > 0 && w.after()[i]!.upcoming.includes(TITLE) && runsOf(w, TITLE).length === 1 && local(runsOf(w, TITLE)[0]!.scheduledFor) === "09:30" && runsOf(w, TITLE)[0]!.signal === "notify"; } },
  { name: "the reply names the new time, and the pause reply says it will not run until turned on", kind: "required_fact", check: (w) => w.replies().some((r) => /^Moved\b.*09:30/.test(r)) && w.replies().some((r) => /^Paused\b.*will not run until/.test(r)) },
  { name: "the agent's edit of what the job does waits on its card: the update answered it off until turned on, and the card was decided", kind: "required_fact", check: (w) => w.results().some((r) => r.tool === "jobs_update" && !r.isError && /currently off until you turn it on/.test(r.text)) && w.cards().some((c) => c.tool === "jobs_enable" && c.state !== "pending") },
  { name: "second_job", kind: "minefield", check: (w) => w.jobs().length !== 1 || w.jobs()[0]!.id !== ID },
  { name: "history_lost", kind: "minefield", check: (w) => (jobNamed(w, TITLE)?.history.length ?? 0) === 0 },
  { name: "paused_fires", kind: "minefield", check: (w) => { const t = pausedTick(w); return t < 0 || w.after()[t]!.runs > 0; } },
];

export const task = defineTask<P7World>({
  id: "T-P7-06",
  cluster: "P7",
  clauses: ["B-P7-06"],
  priority: "must-have",
  tier: 1,
  setup: { seed: 706, records: ["chat:c1", "a daily job at 09:00 Europe/London, on"], files: [], jobs: [TITLE] },
  turns: [
    { kind: "prompt", by: sam.email, text: "move the p7 probe to 09:30 and have it check the second paragraph instead" },
    { kind: "event", name: "decide", payload: { choice: "once" } },
    { kind: "prompt", by: sam.email, text: "pause the p7 probe" },
    { kind: "event", name: "tick", payload: { job: TITLE, at: "2026-10-14T08:30:00Z" } },
    { kind: "event", name: "panel", payload: { job: TITLE, action: "enable" } },
    { kind: "event", name: "tick", payload: { job: TITLE } },
  ],
  end_state: graders.filter((g) => g.kind === "end_state").map((g) => g.name),
  required_facts: graders.filter((g) => g.kind === "required_fact").map((g) => g.name),
  minefields: graders.filter((g) => g.kind === "minefield").map((g) => g.name),
  collateral: { journal: ["card:1:Your agent asks to: jobs enable", "notice:c1:1", "run:p7 probe: the morning check:2790:notify"] },
  graders,
  reference: "`cron_mutations` 124 to 126 on one id with `archived_path`, and `cron.update enabled:false` as the pause (B-P7-06).",
});

export default task;
