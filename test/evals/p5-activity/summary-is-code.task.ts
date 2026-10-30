// T-P5-05 (B-P5-04): the summary step is code's. Sam asks for two reads and a write; the second read fails. While the
// turn runs (held after the first read) no summary step is drawn; once it ends, the timeline closes with the summary:
// what the task did by count, from the steps' states ("Read 2, 1 failed; wrote 1"), the file card, and the turn's final
// text quoted as the agent's own words. The reply says nothing of the failure; the count says it.
import { defineTask, type Grader } from "../../support/task.ts";
import type { P5World, TaskDetail } from "./world.ts";
import { DEAD, newest, PROBE, summaryOf, work } from "./world.ts";

export const BOTH = `Read ${PROBE} and ${DEAD} and write their titles to p5-probe.md`;
export const FINAL = "I read both pages and wrote the titles down.";
const detail = async (w: P5World) => w.task("c1", (await newest(w))!.id);
/** The counts line computed here from the steps' states, in the words table's shape. */
const counted = (d: TaskDetail) => {
  const reads = work(d).filter((s) => s.kind === "read");
  const writes = work(d).filter((s) => s.kind === "write");
  const failed = reads.filter((s) => s.state === "failed").length;
  return `Read ${reads.length}${failed ? `, ${failed} failed` : ""}; wrote ${writes.length} (p5-probe.md)`;
};

const graders: Grader<P5World>[] = [
  { name: "the summary says by count what the task did, from the steps' states, with the file", kind: "end_state", check: async (w) => {
    const d = await detail(w);
    const s = summaryOf(d);
    return d.steps.at(-1) === s && s?.detail.prose === "Read 2, 1 failed; wrote 1 (p5-probe.md)" && s.detail.prose === counted(d) && s.detail.files[0]?.path === "p5-probe.md";
  } },
  { name: "it quotes the turn's final text as the agent's own words", kind: "end_state", check: async (w) => {
    const b = summaryOf(await detail(w))?.detail.blocks[0];
    return b?.label === "The agent's reply, in its own words" && b.text === FINAL && w.replies().at(-1) === FINAL;
  } },
  { name: "a task still running has no summary step", kind: "end_state", check: (w) => w.during?.status === "running" && w.during.summaryStep === false },
  { name: "the failed read counts failed though the reply says nothing of it", kind: "required_fact", check: async (w) => !/fail|could not|no page/i.test(FINAL) && (await newest(w))?.failed === 1 && (summaryOf(await detail(w))?.detail.prose ?? "").includes("1 failed") },
  { name: "paraphrased_reply", kind: "minefield", check: async (w) => summaryOf(await detail(w))?.detail.blocks[0]?.text !== w.replies().at(-1) },
  { name: "count_from_claim", kind: "minefield", check: async (w) => summaryOf(await detail(w))?.detail.prose !== counted(await detail(w)) },
  { name: "summary_on_running", kind: "minefield", check: (w) => w.during?.summaryStep !== false },
];

export const task = defineTask<P5World>({
  id: "T-P5-05",
  cluster: "P5",
  clauses: ["B-P5-04"],
  priority: "must-have",
  tier: 1,
  setup: { seed: 505, records: ["chat:c1", "the probe page with one link", "example.invalid unreachable"], files: [], jobs: [] },
  turns: [{ kind: "event", name: "hold", payload: { text: BOTH } }],
  end_state: graders.filter((g) => g.kind === "end_state").map((g) => g.name),
  required_facts: graders.filter((g) => g.kind === "required_fact").map((g) => g.name),
  minefields: graders.filter((g) => g.kind === "minefield").map((g) => g.name),
  collateral: { r2: ["p5-probe.md"] },
  graders,
  reference: "Muse's model-written finish_message that contradicted its own turn, three times (B-P5-04).",
});

export default task;
