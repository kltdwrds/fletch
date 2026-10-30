// T-P5-04 (B-P5-04): the record's words are code's. The model's reply claims "two links" while the page and the file say
// one; a second request follows, and c2's mail resumes after a card (a continuation whose text is the decision). The
// rows are titled by their requests, the steps by `STEP_WORDS`, their details by the calls' own arguments and results;
// "two links" stands only in the reply, quoted under the summary as the agent's own words.
import { defineTask, type Grader } from "../../support/task.ts";
import { ASK, fromRequest, MAIL, OTHER } from "./request-shows-as-task.task.ts";
import type { P5World, StepView, TaskDetail } from "./world.ts";
import { PROBE_TITLE, work } from "./world.ts";

export const TWO = "It has two links; I wrote them down in p5-probe.md.";
/** Chat model calls the run makes: the load, the read, the write and the reply; the second answer; the mail and its reply. */
export const CALLS = 7;
const tasks = async (w: P5World) => (await w.activity()).tasks;
const first = async (w: P5World) => (await tasks(w)).filter((t) => t.chat === "c1").at(-1)!;
const detail = async (w: P5World) => w.task("c1", (await first(w)).id);
/** Every field of the record but the reply the summary quotes. */
const fields = (d: TaskDetail) => JSON.stringify([d.task, d.steps.map((s: StepView) => (s.kind === "summary" ? { ...s, detail: { ...s.detail, blocks: [] } } : s))]);

const graders: Grader<P5World>[] = [
  { name: "the second row is titled by the second request", kind: "end_state", check: async (w) => (await tasks(w)).filter((t) => t.chat === "c1")[0]?.title === OTHER },
  { name: "the read's detail is the tool's own result and the write's the file's own lines", kind: "end_state", check: async (w) => {
    const [, r, wr] = work(await detail(w));
    return !!r && (r.detail.result?.text ?? "").includes("1 links") && (r.detail.result?.text ?? "").includes(PROBE_TITLE) && r.detail.lines.some((l) => /bytes came back/.test(l)) && (wr?.detail.files[0]?.preview ?? "").includes("1 link");
  } },
  { name: "the model's two links stands only in its reply, quoted as its own words", kind: "end_state", check: async (w) => {
    const d = await detail(w);
    const s = d.steps.at(-1);
    return w.replies().includes(TWO) && !fields(d).includes("two links") && s?.kind === "summary" && s.detail.blocks[0]?.text === TWO;
  } },
  { name: "a continuation keeps the anchor's title", kind: "end_state", check: async (w) => {
    const c2 = (await tasks(w)).filter((t) => t.chat === "c2");
    return c2.length === 1 && c2[0]!.title === MAIL && c2[0]!.turnIds.length === 2;
  } },
  { name: "no record field is model text about the work", kind: "required_fact", check: async (w) => {
    const d = await detail(w);
    return [...w.replies("c1"), ...w.replies("c2")].every((r) => !r || !fields(d).includes(r));
  } },
  { name: "fabricated_summary", kind: "minefield", check: async (w) => fields(await detail(w)).includes("two links") || /two/.test((await first(w)).summary ?? "") },
  { name: "prior_turn_title", kind: "minefield", check: async (w) => (await tasks(w)).filter((t) => t.chat === "c1")[0]?.title !== OTHER },
  { name: "summary_by_model", kind: "minefield", check: (w) => w.prompts().length > CALLS },
  { name: "title_rewrite", kind: "minefield", check: async (w) => !fromRequest((await first(w)).title, ASK) },
];

export const task = defineTask<P5World>({
  id: "T-P5-04",
  cluster: "P5",
  clauses: ["B-P5-04"],
  priority: "must-have",
  tier: 1,
  setup: { seed: 504, records: ["chat:c1", "chat:c2", "the probe page with one link"], files: [], jobs: [] },
  turns: [
    { kind: "event", name: "prompt", payload: { text: ASK } },
    { kind: "event", name: "prompt", payload: { text: OTHER } },
    { kind: "event", name: "prompt", payload: { text: MAIL, chat: "c2" } },
    { kind: "event", name: "decide", payload: { chat: "c2" } },
    { kind: "event", name: "open" },
  ],
  end_state: graders.filter((g) => g.kind === "end_state").map((g) => g.name),
  required_facts: graders.filter((g) => g.kind === "required_fact").map((g) => g.name),
  minefields: graders.filter((g) => g.kind === "minefield").map((g) => g.name),
  collateral: { r2: ["p5-probe.md"], journal: ["mail.send:PENDING", "mail.send:DONE"] },
  graders,
  reference: "Muse's Activity Summary \"two links\" above a file saying one; the step 5 row titled by the previous turn's intent (B-P5-04).",
});

export default task;
