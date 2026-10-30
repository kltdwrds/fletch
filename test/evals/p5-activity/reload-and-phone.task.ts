// T-P5-12 (B-P5-13, B-P5-02, B-P5-07): tier 2, on a slot with the real model and the browser lane (`pnpm evals P5`,
// F32): the rows, the drawer and the cards read the same before and after a reload and at desktop and phone width.
// Under the tier-1 harness a reload is a fresh read of the routes and a fresh page.
import { defineTask, type Grader } from "../../support/task.ts";
import { ASK } from "./request-shows-as-task.task.ts";
import type { P5World } from "./world.ts";
import { newest } from "./world.ts";

const route = async (w: P5World) => JSON.stringify(await w.task("c1", (await newest(w))!.id));
const views = async (w: P5World) => {
  const id = (await newest(w))!.id;
  return { desk: await w.drawer("c1", id), phone: await w.drawer("c1", id, true), rows: await w.rows() };
};

const graders: Grader<P5World>[] = [
  { name: "the rows and the drawer read the same after a reload and at both widths", kind: "end_state", check: async (w) => {
    const a = await views(w);
    const b = await views(w);
    return JSON.stringify(a) === JSON.stringify(b) && a.desk?.pill === a.phone?.pill && JSON.stringify(a.desk?.details) === JSON.stringify(a.phone?.details);
  } },
  { name: "the drawer at phone width stacks with every word readable", kind: "end_state", check: async (w) => !!(await views(w)).phone?.stacked },
  { name: "the route's answer for a finished task is the same on every read", kind: "required_fact", check: async (w) => {
    const first = await route(w);
    return first === (await route(w));
  } },
  { name: "strip_summary", kind: "minefield", check: async (w) => {
    const v = await views(w);
    return !v.phone?.stacked || JSON.stringify(v.phone.details) !== JSON.stringify(v.desk?.details);
  } },
  { name: "word_drift", kind: "minefield", check: async (w) => {
    const v = await views(w);
    return v.rows.filter((r) => r.kind === "task")[0]?.desc !== v.desk?.pill || v.desk?.pill !== v.phone?.pill;
  } },
  { name: "reload_differs", kind: "minefield", check: async (w) => {
    const first = await route(w);
    const rows = JSON.stringify(await w.rows());
    return first !== (await route(w)) || rows !== JSON.stringify(await w.rows());
  } },
];

export const task = defineTask<P5World>({
  id: "T-P5-12",
  cluster: "P5",
  clauses: ["B-P5-13", "B-P5-02", "B-P5-07"],
  priority: "nice-to-have",
  tier: 2,
  setup: { seed: 512, records: ["chat:c1 on the slot", "the slot's probe page with one link"], files: [], jobs: [] },
  turns: [
    { kind: "event", name: "prompt", payload: { text: ASK } },
    { kind: "event", name: "open" },
    { kind: "event", name: "open" },
  ],
  end_state: graders.filter((g) => g.kind === "end_state").map((g) => g.name),
  required_facts: graders.filter((g) => g.kind === "required_fact").map((g) => g.name),
  minefields: graders.filter((g) => g.kind === "minefield").map((g) => g.name),
  collateral: { r2: ["p5-probe.md"] },
  graders,
  reference: "Muse's persistence of rows and cards, the Summary strip on a phone (B-P5-13, B-P5-02, B-P5-07).",
});

export default task;
