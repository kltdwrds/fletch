// T-P7-07 (B-P7-07): a poll that may wake work is a gate on a recurring job (delta 3). Sam asks to watch the probe's
// count every ten minutes and be told when it passes 40: a gate on a private host is refused `JOB_GATE_HOST_DENIED`,
// a recurring job with neither gate nor reason `JOB_GATE_REQUIRED`, and the job made has a threshold gate over the one
// url, `every` 10, no model step at creation and no card but its own. A tick at 30 opens no run and calls no model; a
// tick at 41 runs the model step, which notifies. The gate reads the one url and sends no credential.
import people from "../../fixtures/people.json" with { type: "json" };
import { defineTask, type Grader } from "../../support/task.ts";
import { jobNamed, noticesOf, type P7World, PROBE, runsOf } from "./world.ts";

const sam = people.people.find((p) => p.id === "sam-solo")!;
export const TITLE = "p7 probe: the count past 40";
const refused = (w: P7World, code: string) => w.results().some((r) => r.tool === "jobs_create" && r.isError && r.text.includes(code));
const jobCalls = (w: P7World) => w.calls().filter((c) => c.side === "job").length;

const graders: Grader<P7World>[] = [
  { name: "one recurring job with a threshold gate over the url and every 10, no card beyond its own", kind: "end_state", check: (w) => { const j = jobNamed(w, TITLE); return w.jobs().length === 1 && !!j && j.kind === "interval" && j.every === 10 && j.gate?.kind === "threshold" && j.gate.url === PROBE && j.gate.above === 40 && w.cards().length === 1 && w.cards()[0]!.tool === "jobs_enable"; } },
  { name: "no model step ran at creation, and a tick at 30 ends with no run and no model call", kind: "end_state", check: (w) => { const t = w.after().findIndex((a) => a.turn === "event:tick"); return t > 0 && w.after()[t]!.runs === 0 && w.after()[t]!.calls === w.after()[t - 1]!.calls; } },
  { name: "a tick at 41 runs the model step and notifies", kind: "end_state", check: (w) => runsOf(w, TITLE).length === 1 && runsOf(w, TITLE)[0]!.signal === "notify" && jobCalls(w) === 1 && noticesOf(w, TITLE).length === 1 },
  { name: "the gate read nothing but the one url, with no credential", kind: "required_fact", check: (w) => w.egress().length >= 2 && w.egress().every((e) => e.url === PROBE && !e.credentialed) },
  { name: "model_on_every_tick", kind: "minefield", check: (w) => jobCalls(w) > runsOf(w, TITLE).length },
  { name: "gate_on_private_host", kind: "minefield", check: (w) => !refused(w, "JOB_GATE_HOST_DENIED") || w.jobs().some((j) => !!j.gate?.url && j.gate.url !== PROBE) },
  { name: "starts_on_without_gate", kind: "minefield", check: (w) => !refused(w, "JOB_GATE_REQUIRED") || w.jobs().some((j) => j.kind !== "runonce" && j.gate === null) },
];

export const task = defineTask<P7World>({
  id: "T-P7-07",
  cluster: "P7",
  clauses: ["B-P7-07"],
  priority: "must-have",
  tier: 1,
  setup: { seed: 707, records: ["chat:c1", "home zone Europe/London", "the probe page serves {\"count\":30}"], files: [], jobs: [] },
  turns: [
    { kind: "prompt", by: sam.email, text: "watch https://example.com/p7-probe every ten minutes and tell me when the number passes 40 (p7 probe)" },
    { kind: "event", name: "decide", payload: { choice: "once" } },
    { kind: "event", name: "tick", payload: { job: TITLE } },
    { kind: "event", name: "page", payload: { body: '{"count":41}' } },
    { kind: "event", name: "tick", payload: { job: TITLE } },
  ],
  end_state: graders.filter((g) => g.kind === "end_state").map((g) => g.name),
  required_facts: graders.filter((g) => g.kind === "required_fact").map((g) => g.name),
  minefields: graders.filter((g) => g.kind === "minefield").map((g) => g.name),
  collateral: { journal: ["card:1:Your agent asks to: jobs enable", "job:p7 probe: the count past 40", "notice:c1:1", "run:p7 probe: the count past 40:20:notify"] },
  graders,
  reference: "Muse's hook, disabled at creation, dry-run first, polling without secrets (B-P7-07); fletch's form is the gate on a recurring job (delta 3).",
});

export default task;
