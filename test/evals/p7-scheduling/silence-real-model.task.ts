// T-P7-11 (B-P7-03): tier 2, a recurring job over the probe page told "if nothing changed, say nothing", run twice by
// the real model on a slot (`pnpm evals P7`, F30) with the page unchanged: no message in c1, two runs that end
// `nothing_to_report` certified by code, and the watermark committed. The job has no gate (its reason is on the card),
// so each tick runs the model, which must read the page and certify its silence.
import { defineTask, type Grader } from "../../support/task.ts";
import { jobNamed, type P7World, runsOf } from "./world.ts";

export const TITLE = "p7 probe: say nothing if unchanged";
export const INSTRUCTIONS = "Read the p7 probe page. If nothing changed, say nothing.";

const graders: Grader<P7World>[] = [
  { name: "two runs nothing_to_report and the watermark committed", kind: "end_state", check: (w) => runsOf(w, TITLE).length === 2 && runsOf(w, TITLE).every((r) => r.signal === "nothing_to_report") && !!jobNamed(w, TITLE)?.mark },
  { name: "zero messages in c1", kind: "required_fact", check: (w) => w.notices().length === 0 && w.replies().every((r) => r.trim() === "") },
  { name: "chatty_silence", kind: "minefield", check: (w) => w.notices().length > 0 },
  { name: "model_on_every_tick", kind: "minefield", check: (w) => w.calls().filter((c) => c.side === "job").length > 2 * 3 },
];

export const task = defineTask<P7World>({
  id: "T-P7-11",
  cluster: "P7",
  clauses: ["B-P7-03"],
  priority: "must-have",
  tier: 2,
  setup: { seed: 711, records: ["chat:c1 on the slot", "a recurring job every 30 minutes over https://example.com/p7-probe, no gate with its reason, on"], files: [], jobs: [TITLE] },
  turns: [
    { kind: "event", name: "tick", payload: { job: TITLE } },
    { kind: "event", name: "tick", payload: { job: TITLE } },
  ],
  end_state: graders.filter((g) => g.kind === "end_state").map((g) => g.name),
  required_facts: graders.filter((g) => g.kind === "required_fact").map((g) => g.name),
  minefields: graders.filter((g) => g.kind === "minefield").map((g) => g.name),
  collateral: { journal: [`run:${TITLE}:30:nothing_to_report`, `run:${TITLE}:60:nothing_to_report`] },
  graders,
  reference: "Muse (B-P7-03): run `7be82856` succeeded, its outbox row admitted, nothing in the chat.",
});

export default task;
