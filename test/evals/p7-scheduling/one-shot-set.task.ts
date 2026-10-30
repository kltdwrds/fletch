// T-P7-01 (B-P7-01, B-P7-12): a one-shot asked in plain words is set in one turn: one create, a runonce at the asked
// time in Sam's home zone, stopping after one run, owned by the chat it was asked in; the card under the reply names
// the title, the time and the stop; the reply names the time. fletch's form: a job the agent registers starts off, so
// the one card under the creating reply is the job's own (`jobs_enable`, its lines `cardLinesOf`), and the job is on
// once Sam decides it; Muse's "Scheduled task" card is that card (the Translation's step 2).
import people from "../../fixtures/people.json" with { type: "json" };
import { defineTask, type Grader } from "../../support/task.ts";
import { clockOf, type P7World, replyOf } from "./world.ts";

const sam = people.people.find((p) => p.id === "sam-solo")!;

export const PROMPT = "in five minutes, tell me the time in words (p7 probe)";
export const TITLE = "p7 probe: the time in words";
export const INSTRUCTIONS = "Tell me the time in words. (p7 probe)";

/** The one job the ask made, when there is exactly one. */
const only = (w: P7World) => (w.jobs().length === 1 ? w.jobs()[0] : undefined);
/** Five minutes after the world's start, as a local `YYYY-MM-DDTHH:MM` in Europe/London. */
export const fiveOn = (w: P7World) => new Date(w.start() + 5 * 60_000).toLocaleString("sv-SE", { timeZone: "Europe/London" }).slice(0, 16).replace(" ", "T");

/** Shared with T-P7-09, which asks the same with the real model. */
export const graders: Grader<P7World>[] = [
  {
    name: "one job, a runonce five minutes on in Europe/London, stopping after one run, for chat c1, on",
    kind: "end_state",
    check: (w) => {
      const j = only(w);
      return !!j && j.kind === "runonce" && j.at === fiveOn(w) && j.zone === "Europe/London" && j.stop.kind === "after_runs" && j.stop.runs === 1 && j.owner.kind === "chat" && j.chat === "c1" && j.status === "active";
    },
  },
  { name: "the reply says it is set and names the time", kind: "end_state", check: (w) => /\bset\b/i.test(replyOf(w)) && !!only(w) && replyOf(w).includes(clockOf(only(w)?.at ?? null)) },
  {
    name: "the card under the reply names the title, the when and the stop",
    kind: "end_state",
    check: (w) => {
      const j = only(w);
      const c = w.cards();
      return !!j && c.length === 1 && c[0]!.lines.includes(`Job: ${j.title}`) && c[0]!.lines.includes(`When: ${j.cadence}`) && c[0]!.lines.includes("Stops: after it runs once");
    },
  },
  { name: "the time in the reply is the registered slot in the home zone", kind: "required_fact", check: (w) => !!only(w) && only(w)!.cadence.includes(clockOf(fiveOn(w))) && replyOf(w).includes(clockOf(fiveOn(w))) },
  { name: "double_create", kind: "minefield", check: (w) => w.jobs().length > 1 },
  { name: "recurring_for_once", kind: "minefield", check: (w) => w.jobs().some((j) => j.kind !== "runonce") },
  { name: "asked_permission", kind: "minefield", check: (w) => w.jobs().length === 0 || /\b(shall|should|do you want|would you like) (I|me)\b[^.]*\?/i.test(replyOf(w)) },
  { name: "time_unsaid", kind: "minefield", check: (w) => !/\b\d{1,2}:\d{2}\b/.test(replyOf(w)) },
];

export const task = defineTask<P7World>({
  id: "T-P7-01",
  cluster: "P7",
  clauses: ["B-P7-01", "B-P7-12"],
  priority: "must-have",
  tier: 1,
  setup: { seed: 701, records: ["chat:c1", "home zone Europe/London", "no jobs"], files: [], jobs: [] },
  turns: [
    { kind: "prompt", by: sam.email, text: PROMPT },
    // Sam decides the one card under the reply (fletch's form of "set in one turn": the agent's job starts off).
    { kind: "event", name: "decide", payload: { choice: "once" } },
  ],
  end_state: graders.filter((g) => g.kind === "end_state").map((g) => g.name),
  required_facts: graders.filter((g) => g.kind === "required_fact").map((g) => g.name),
  minefields: graders.filter((g) => g.kind === "minefield").map((g) => g.name),
  collateral: { journal: ["card:1:Your agent asks to: jobs enable", "job:p7 probe: the time in words"] },
  graders,
  reference: "Muse's one `cron.add` (runonce, the owner's zone) and \"Set. It will fire ... in about 4 minutes\", with the \"Scheduled task\" card drawn under the reply (B-P7-01, B-P7-12).",
});

export default task;
