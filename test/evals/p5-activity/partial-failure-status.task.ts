// T-P5-07 (B-P5-06, B-P5-07): a partial failure is said, never hidden. Sam asks for two titles, one page unreachable,
// twice; then for the reachable one alone; then a turn whose model call is refused. A turn with a failed read is
// Complete with the failed-step count on the row (the failed-count glyph) and in the drawer's pill, its reads `done` and
// `failed` with the code, one word per state from one table in both turns; the read that worked alone is a bare
// Complete; the turn that failed is `Failed` with its code. A task fails only when its turn ended with a code.
import { defineTask, type Grader } from "../../support/task.ts";
import { fromRequest } from "./request-shows-as-task.task.ts";
import type { P5World, TaskView } from "./world.ts";
import { DEAD, PROBE, work } from "./world.ts";

export const TITLES = `What are the titles of ${PROBE} and ${DEAD}?`;
export const ONE = `What is the title of ${PROBE}?`;
export const BROKEN = "Say it once more.";
const tasks = async (w: P5World): Promise<TaskView[]> => (await w.activity()).tasks;
/** The two tasks with a failed read, oldest first. */
const partial = async (w: P5World) => (await tasks(w)).filter((t) => fromRequest(t.title, TITLES)).reverse();
const reads = async (w: P5World, t: TaskView) => work(await w.task("c1", t.id)).filter((s) => s.tool === "browse_open");

const graders: Grader<P5World>[] = [
  { name: "each turn with a failed read is Complete, 1 step failed on the row and in the pill, with the failed-count glyph", kind: "end_state", check: async (w) => {
    const rows = (await w.rows()).filter((r) => fromRequest(r.title, TITLES));
    const pills = await Promise.all((await partial(w)).map(async (t) => (await w.drawer("c1", t.id))?.pill));
    return rows.length === 2 && rows.every((r) => r.desc === "Complete, 1 step failed" && r.glyph === "flag") && pills.every((p) => p === "Complete, 1 step failed");
  } },
  { name: "the read that worked alone is a bare Complete", kind: "end_state", check: async (w) => (await w.rows()).find((r) => fromRequest(r.title, ONE))?.desc === "Complete" && (await tasks(w)).find((t) => fromRequest(t.title, ONE))?.failed === 0 },
  { name: "the reads are done and failed with the code, one word per state on the step and in the drawer, in both turns", kind: "end_state", check: async (w) => {
    for (const t of await partial(w)) {
      const r = await reads(w, t);
      const d = await w.drawer("c1", t.id);
      const failedPane = d?.details[r[1]?.title ?? ""]?.text ?? "";
      if (r.map((s) => s.state).join() !== "done,failed" || r[1]?.code !== "BROWSE_UNREACHABLE" || !failedPane.includes("Failed · BROWSE_UNREACHABLE")) return false;
    }
    return (await partial(w)).length === 2;
  } },
  { name: "a turn that failed reads Failed with its code", kind: "end_state", check: async (w) => {
    const t = (await tasks(w)).find((x) => x.title === BROKEN);
    return t?.status === "failed" && !!t.code && t.words === `Failed: ${t.code}`;
  } },
  { name: "a task is failed only when its turn ended with a code, never for a failed step", kind: "required_fact", check: async (w) => (await tasks(w)).every((t) => (t.status === "failed") === (t.title === BROKEN) && (t.status !== "failed" || !!t.code)) },
  { name: "complete_without_mark", kind: "minefield", check: async (w) => (await tasks(w)).some((t) => t.failed > 0 && t.words === "Complete") || (await w.rows()).some((r) => fromRequest(r.title, TITLES) && r.desc === "Complete") },
  { name: "whole_task_failed", kind: "minefield", check: async (w) => (await partial(w)).some((t) => t.status === "failed") },
  { name: "two_words_one_state", kind: "minefield", check: async (w) => {
    for (const t of await partial(w)) {
      const r = await reads(w, t);
      const pane = (await w.drawer("c1", t.id))?.details[r[1]?.title ?? ""]?.text ?? "";
      if (/\b(Completed|Done)\b/.test(pane)) return true;
    }
    return false;
  } },
  { name: "count_wrong", kind: "minefield", check: async (w) => {
    for (const t of await tasks(w)) if (t.failed !== work(await w.task("c1", t.id)).filter((s) => s.state === "failed").length) return true;
    return false;
  } },
];

export const task = defineTask<P5World>({
  id: "T-P5-07",
  cluster: "P5",
  clauses: ["B-P5-06", "B-P5-07"],
  priority: "must-have",
  tier: 1,
  setup: { seed: 507, records: ["chat:c1", "the probe page with one link", "example.invalid unreachable"], files: [], jobs: [] },
  turns: [
    { kind: "event", name: "prompt", payload: { text: TITLES } },
    { kind: "event", name: "prompt", payload: { text: TITLES } },
    { kind: "event", name: "prompt", payload: { text: ONE } },
    { kind: "event", name: "prompt", payload: { text: BROKEN } },
    { kind: "event", name: "open" },
  ],
  end_state: graders.filter((g) => g.kind === "end_state").map((g) => g.name),
  required_facts: graders.filter((g) => g.kind === "required_fact").map((g) => g.name),
  minefields: graders.filter((g) => g.kind === "minefield").map((g) => g.name),
  collateral: {},
  graders,
  reference: "Muse's `success` with a failed action and a card that said Completed then Failed for the same failure (B-P5-06, B-P5-07).",
});

export default task;
