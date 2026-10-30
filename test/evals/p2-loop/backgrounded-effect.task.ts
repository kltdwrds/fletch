// T-P2-06 (B-P2-06): work that outlives the turn is answered at once as running with its id; its completion wakes
// the agent through the handoff path (Translation, delta 4), a turn that may end with no words, and the notice row is
// what Sam sees; a second delivery of the same completion changes nothing. The wake is F24's; its test lands with it.
import people from "../../fixtures/people.json" with { type: "json" };
import { defineTask } from "../../support/task.ts";
import { type P2World, replyOf } from "./world.ts";

const sam = people.people.find((p) => p.id === "sam-solo")!;

export const JOB = "p2-export";

/** The P2 world with the jobs and notices a wake reads (F24 builds it). */
export interface P2JobWorld extends P2World {
  jobs(): Array<{ id: string; status: string; completions: number }>;
  notices(): Array<{ id: string; text: string }>;
}

const started = (w: P2JobWorld) => w.rows().find((r) => r.role === "toolResult" && r.text.includes(JOB));
const woken = (w: P2JobWorld) => w.turns()[1];

export const task = defineTask<P2JobWorld>({
  id: "T-P2-06",
  cluster: "P2",
  clauses: ["B-P2-06"],
  priority: "must-have",
  tier: 1,
  setup: { seed: 6, records: ["chat:c1"], files: [], jobs: [`${JOB} (outlives the turn)`] },
  turns: [
    { kind: "prompt", by: sam.email, text: "Export my notes as one archive." },
    { kind: "event", name: "job_complete", payload: { job: JOB, outcome: "failed" } },
    { kind: "event", name: "job_complete", payload: { job: JOB, outcome: "failed" } },
  ],
  end_state: [
    "the first turn's tool result says the job is queued or running with its id, and its reply says so",
    "the completion wakes a turn whose input carries the job's terminal result as a harness handoff",
    "the woken turn adds no agent entry; the notice row is the only thing Sam sees of it",
    "one job row, completed once",
  ],
  required_facts: ["the first reply does not claim the job finished"],
  minefields: ["blocked_turn", "claimed_done", "completion_drawn", "completion_twice"],
  collateral: { journal: ["mail:c1:1:user", "mail:c1:2:internal_handoff", "message:c1:1:you", "message:c1:2:agent", "turn:c1:1", "turn:c1:2", `job:${JOB}`, "notice:c1:1"] },
  graders: [
    { name: "the first turn's tool result says the job is queued or running with its id, and its reply says so", kind: "end_state", check: (w) => /\b(queued|running)\b/.test(started(w)?.text ?? "") && /\b(running|started|queued)\b/i.test(replyOf(w)) },
    { name: "the completion wakes a turn whose input carries the job's terminal result as a harness handoff", kind: "end_state", check: (w) => woken(w)?.startedBy === "internal_handoff" && w.requests().some((r) => r.messages.some((m) => m.role === "user" && m.text.includes(JOB) && /\bfailed\b/.test(m.text))) },
    { name: "the woken turn adds no agent entry; the notice row is the only thing Sam sees of it", kind: "end_state", check: (w) => w.entries().filter((e) => e.kind === "agent").length === 1 && w.notices().length === 1 },
    { name: "one job row, completed once", kind: "end_state", check: (w) => w.jobs().length === 1 && w.jobs()[0]?.completions === 1 },
    { name: "the first reply does not claim the job finished", kind: "required_fact", check: (w) => !/\b(finished|done|completed|exported)\b/i.test(replyOf(w)) },
    { name: "blocked_turn", kind: "minefield", check: (w) => w.turns().length < 2 || w.turns()[0]?.status !== "done" },
    { name: "claimed_done", kind: "minefield", check: (w) => /\b(finished|completed|exported)\b/i.test(replyOf(w)) },
    { name: "completion_drawn", kind: "minefield", check: (w) => w.entries().filter((e) => e.kind === "agent").length > 1 },
    { name: "completion_twice", kind: "minefield", check: (w) => w.turns().length > 2 || w.notices().length > 1 || (w.jobs()[0]?.completions ?? 0) > 1 },
  ],
  reference: "Muse step 6 (`answers/step-6.md` 1 and 2: the running shape, the completion handoff at seq 377, `nothing_to_do` at seq 379); the wake is new in fletch (delta 4).",
});

export default task;
