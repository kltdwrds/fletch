// T-P5-02 (B-P5-02): the task drawer. After T-P5-01's request Sam opens its row and selects each step: the head is the
// pill in the table's words and the row's title; the timeline is the steps in order titled by code with their
// arguments, then the summary; the read's detail is the page as text with its byte count, the write's the file card;
// at phone width the drawer is one column and the detail keeps every word. fletch's forms: the timeline starts with the
// tool load the turn made, and a drawer refused to Pat, the second member, is the route's `CHAT_NOT_OWNER`.
import { defineTask, type Grader } from "../../support/task.ts";
import { ASK } from "./request-shows-as-task.task.ts";
import type { P5World } from "./world.ts";
import { newest, PROBE, PROBE_TITLE, work } from "./world.ts";

const detail = async (w: P5World) => w.task("c1", (await newest(w))!.id);
const drawers = async (w: P5World) => {
  const id = (await newest(w))!.id;
  return { desk: await w.drawer("c1", id), phone: await w.drawer("c1", id, true) };
};

const graders: Grader<P5World>[] = [
  { name: "the head is the pill in the table's words and the title as the row drew it", kind: "end_state", check: async (w) => {
    const [row] = (await w.rows()).filter((r) => r.kind === "task");
    const { desk } = await drawers(w);
    return !!desk && !!row && desk.pill === "Complete" && desk.pill === row.desc && desk.title === row.title;
  } },
  { name: "the timeline is the steps in order, titled by code with their arguments, then the summary", kind: "end_state", check: async (w) => {
    const d = await detail(w);
    const { desk } = await drawers(w);
    return work(d).map((s) => s.tool).join() === "tool_search,browse_open,file_write" && work(d)[1]!.title.includes(PROBE) && work(d)[2]!.title.includes("p5-probe.md") && d.steps.at(-1)?.kind === "summary" && JSON.stringify(desk?.steps) === JSON.stringify(d.steps.map((s) => s.title));
  } },
  { name: "the read's detail is the page as text with its byte count; the write's the file card with its lines", kind: "end_state", check: async (w) => {
    const d = await detail(w);
    const { desk } = await drawers(w);
    const readPane = desk?.details[work(d)[1]!.title];
    return !!readPane && readPane.plain && readPane.text.includes(PROBE_TITLE) && /\d+ bytes came back/.test(readPane.text) && work(d)[2]!.detail.files[0]?.path === "p5-probe.md" && (work(d)[2]!.detail.files[0]?.preview ?? "").includes("1 link");
  } },
  { name: "at phone width the drawer stacks and the detail keeps every word", kind: "end_state", check: async (w) => {
    const { desk, phone } = await drawers(w);
    return !!phone && phone.stacked && JSON.stringify(phone.details) === JSON.stringify(desk?.details);
  } },
  { name: "each step's state is its own call's result", kind: "required_fact", check: async (w) => work(await detail(w)).every((s) => (s.state === "done") === (s.detail.result?.ok === true)) },
  { name: "a drawer that cannot be read says so with its code", kind: "required_fact", check: async (w) => {
    const r = await w.task("c1", (await newest(w))!.id, "pat");
    return r.ok === false && r.code === "CHAT_NOT_OWNER";
  } },
  { name: "model_prose_step", kind: "minefield", check: async (w) => (await detail(w)).steps.some((s) => w.replies().some((r) => r && s.title.includes(r))) },
  { name: "summary_clipped", kind: "minefield", check: async (w) => {
    const { desk, phone } = await drawers(w);
    return !phone?.stacked || JSON.stringify(phone.details) !== JSON.stringify(desk?.details);
  } },
  { name: "markup_executed", kind: "minefield", check: async (w) => Object.values((await drawers(w)).desk?.details ?? {}).some((x) => !x.plain) },
  { name: "empty_on_error", kind: "minefield", check: async (w) => {
    const r = await w.task("c1", (await newest(w))!.id, "pat");
    return r.ok !== false || !r.code;
  } },
];

export const task = defineTask<P5World>({
  id: "T-P5-02",
  cluster: "P5",
  clauses: ["B-P5-02"],
  priority: "must-have",
  tier: 1,
  setup: { seed: 502, records: ["chat:c1", "the probe page with one link"], files: [], jobs: [] },
  turns: [
    { kind: "event", name: "prompt", payload: { text: ASK } },
    { kind: "event", name: "open" },
  ],
  end_state: graders.filter((g) => g.kind === "end_state").map((g) => g.name),
  required_facts: graders.filter((g) => g.kind === "required_fact").map((g) => g.name),
  minefields: graders.filter((g) => g.kind === "minefield").map((g) => g.name),
  collateral: { r2: ["p5-probe.md"] },
  graders,
  reference: "Muse's detail dialog with a Summary pane cut to a strip on a phone and steps titled by prose (B-P5-02).",
});

export default task;
