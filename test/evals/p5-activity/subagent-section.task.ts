// T-P5-08 (B-P5-08): a delegation is said as launched, and its child is a section of the task. Sam asks c1 for a
// sub-agent to count the sentences on the probe page: the acknowledgement (the model's words under `WORK_WORDS`) says
// what was launched and never done or the answer; the row is `running` with Stop offered until the handoff; then the
// drawer holds one `SUBAGENT 01` section with the child's read by code from its facet (D-0011) and its handoff, the
// verdict step, and the reply's count equal to the child's. In c2 Sam presses Stop while the delegating turn runs:
// fletch's form of the row's stop is a running turn's Stop in the composer (delta 3). The stop ends the work the turn
// launched: the parent reads `stopped` with its note, and the child's row says what became of it (`done`, or `failed`
// with SUBAGENT_CLOSED), never `running`, and wakes no turn (logged in `docs/decisions/log.md`; Q25).
import { defineTask, type Grader } from "../../support/task.ts";
import type { P5World, SectionView, StepView } from "./world.ts";
import { DONE_WORDS, newest, PROBE } from "./world.ts";

export const COUNT_ASK = `Have a sub-agent count the sentences on ${PROBE} and tell me.`;
const ack = (w: P5World) => w.replies("c1")[0] ?? "";
const detail = async (w: P5World) => w.task("c1", (await newest(w))!.id);
const steps = (s: SectionView | undefined): StepView[] | null => (Array.isArray(s?.rows[0]?.steps) ? (s.rows[0].steps as StepView[]) : null);
const number = (s: string) => /\b(\d+)\b/.exec(s)?.[1] ?? null;
const handed = async (w: P5World) => steps((await detail(w)).subagents[0])?.find((s) => s.kind === "handoff")?.detail.prose ?? "";

const graders: Grader<P5World>[] = [
  { name: "the acknowledgement says what was launched, never done or the answer", kind: "end_state", check: (w) => /sub-agent/i.test(ack(w)) && !DONE_WORDS.test(ack(w)) && number(ack(w)) === null },
  { name: "the row is running with Stop offered until the handoff, then Complete", kind: "end_state", check: async (w) => w.during?.status === "running" && w.during.stop === false && (await newest(w))?.status === "done" },
  { name: "the stopped variant: the parent reads stopped with its note, and its child says what became of it, never running", kind: "end_state", check: async (w) => w.thread("c2").some((e) => e.kind === "stopped") && w.subagents("c2").length === 1 && w.subagents("c2").every((s) => s.status === "done" || (s.status === "failed" && !!s.code)) && (await newest(w, "c2"))?.status === "stopped" },
  { name: "one SUBAGENT 01 section: the child's read by code and its handoff with its final text, then the verdict", kind: "end_state", check: async (w) => {
    const d = await detail(w);
    const kids = steps(d.subagents[0]);
    return d.subagents.length === 1 && d.subagents[0]!.n === "01" && !!kids && kids.some((s) => s.tool === "browse_open" && s.title.includes(PROBE) && s.state === "done") && (await handed(w)).includes("2 sentences") && d.steps.some((s) => s.kind === "verdict") && d.steps.some((s) => s.kind === "launch" && /count the sentences/i.test(s.detail.prose));
  } },
  { name: "the reply's count equals the child's report", kind: "end_state", check: async (w) => number(w.replies("c1").at(-1) ?? "") === number(await handed(w)) },
  { name: "the child's steps are read only for the requester: Pat is refused by name", kind: "required_fact", check: async (w) => {
    const r = await w.task("c1", (await newest(w))!.id, "pat");
    return r.ok === false && r.code === "CHAT_NOT_OWNER" && r.subagents.length === 0;
  } },
  { name: "the acknowledgement is the model's under an instruction line", kind: "required_fact", check: (w) => w.prompts().length > 0 && w.prompts().every((p) => w.instructions().every((l) => p.includes(l))) },
  { name: "done_before_result", kind: "minefield", check: (w) => DONE_WORDS.test(ack(w)) },
  { name: "child_steps_as_prose", kind: "minefield", check: async (w) => !steps((await detail(w)).subagents[0])?.some((s) => s.tool === "browse_open") },
  { name: "hidden_child", kind: "minefield", check: async (w) => (await detail(w)).subagents.length === 0 },
  { name: "child_runs_on", kind: "minefield", check: (w) => w.subagents("c2").some((s) => s.status === "running") },
  { name: "empty_on_refusal", kind: "minefield", check: async (w) => (await detail(w)).subagents.some((s) => s.rows.some((r) => Array.isArray(r.steps) && r.steps.length === 0)) },
  { name: "reply_disagrees", kind: "minefield", check: async (w) => number(w.replies("c1").at(-1) ?? "") !== number(await handed(w)) },
];

export const task = defineTask<P5World>({
  id: "T-P5-08",
  cluster: "P5",
  clauses: ["B-P5-08"],
  priority: "must-have",
  tier: 1,
  setup: { seed: 508, records: ["chat:c1", "chat:c2", "the probe page with one link"], files: [], jobs: [] },
  turns: [
    { kind: "event", name: "prompt", payload: { text: COUNT_ASK, wait: "yes" } },
    { kind: "event", name: "children" },
    { kind: "event", name: "hold", payload: { text: COUNT_ASK, chat: "c2", stop: "yes" } },
    { kind: "event", name: "open" },
  ],
  end_state: graders.filter((g) => g.kind === "end_state").map((g) => g.name),
  required_facts: graders.filter((g) => g.kind === "required_fact").map((g) => g.name),
  minefields: graders.filter((g) => g.kind === "minefield").map((g) => g.name),
  collateral: {},
  graders,
  reference: "Muse's \"Done — a sub-agent is on it\" and its child rows with ids and status only (B-P5-08).",
});

export default task;
