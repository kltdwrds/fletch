// T-P7-02 (B-P7-02, B-P7-12): the one-shot's run lands in the chat that made it, once, as the run's report: one run
// done with `notify`, its outbox row delivered within the tick, the notice drawn in c1 from the job, the one-shot
// finished and gone from Upcoming, the card as it was, and the agent woken once by the notice (F24's handoff).
import people from "../../fixtures/people.json" with { type: "json" };
import { defineTask, type Grader } from "../../support/task.ts";
import { TITLE } from "./one-shot-set.task.ts";
import { jobNamed, noticesOf, type P7World, runsOf } from "./world.ts";

const sam = people.people.find((p) => p.id === "sam-solo")!;
export const REPORT = "It is seven minutes past three.";
const slot = (w: P7World) => w.start() + 5 * 60_000;

const graders: Grader<P7World>[] = [
  { name: "one run done with notify, and one outbox row delivered", kind: "end_state", check: (w) => runsOf(w, TITLE).length === 1 && runsOf(w, TITLE)[0]!.phase === "done" && runsOf(w, TITLE)[0]!.signal === "notify" && w.outbox().length === 1 && w.outbox()[0]!.state === "delivered" },
  { name: "the notice is drawn in c1 as a message from the job", kind: "end_state", check: (w) => noticesOf(w, TITLE).length === 1 && w.notices().length === 1 },
  { name: "the job is finished and absent from Upcoming", kind: "end_state", check: async (w) => jobNamed(w, TITLE)?.status === "finished" && !(await w.listed()).some((j) => j.title === TITLE && j.listed !== "none") },
  { name: "the card is unchanged: one, decided, naming the job", kind: "end_state", check: (w) => w.cards().length === 1 && w.cards()[0]!.state !== "pending" && w.cards()[0]!.lines.includes(`Job: ${TITLE}`) },
  { name: "the notice woke the agent once (F24)", kind: "end_state", check: (w) => w.calls().filter((c) => c.handoff).length === 1 },
  { name: "the notice text is the run's report verbatim", kind: "required_fact", check: (w) => noticesOf(w, TITLE)[0]?.text === REPORT },
  { name: "delivered within the tick", kind: "required_fact", check: (w) => w.after().length === 1 && w.after()[0]!.turn === "event:tick" && w.outbox().every((o) => o.state === "delivered") },
  { name: "wrong_chat", kind: "minefield", check: (w) => jobNamed(w, TITLE)?.chat !== "c1" || w.outbox().length !== w.notices().length },
  { name: "double_notice", kind: "minefield", check: (w) => noticesOf(w, TITLE).length > 1 },
  { name: "still_listed", kind: "minefield", check: async (w) => (await w.listed()).some((j) => j.title === TITLE && j.listed !== "none") },
  { name: "early_fire", kind: "minefield", check: (w) => runsOf(w, TITLE).some((r) => r.scheduledFor < slot(w)) },
];

export const task = defineTask<P7World>({
  id: "T-P7-02",
  cluster: "P7",
  clauses: ["B-P7-02", "B-P7-12"],
  priority: "must-have",
  tier: 1,
  setup: { seed: 702, records: ["chat:c1", "home zone Europe/London", "T-P7-01's one-shot, on"], files: [], jobs: ["p7 probe: the time in words"] },
  turns: [{ kind: "event", name: "tick", payload: { by: sam.email } }],
  end_state: graders.filter((g) => g.kind === "end_state").map((g) => g.name),
  required_facts: graders.filter((g) => g.kind === "required_fact").map((g) => g.name),
  minefields: graders.filter((g) => g.kind === "minefield").map((g) => g.name),
  collateral: { journal: ["notice:c1:1", "run:p7 probe: the time in words:5:notify"] },
  graders,
  reference: "Run `864fa716`, the message in thread A 18 s after the slot, the outbox row delivered (B-P7-02, B-P7-12).",
});

export default task;
