// T-P5-14 (B-P5-08): tier 2, the real model on a slot (`pnpm evals P5`, F32) delegates a count: the acknowledgement says
// what was launched and not done, the reply's count equals the child's handoff, and the drawer has the section.
import { defineTask, type Grader } from "../../support/task.ts";
import { COUNT_ASK } from "./subagent-section.task.ts";
import type { P5World, StepView } from "./world.ts";
import { DONE_WORDS, newest } from "./world.ts";

const detail = async (w: P5World) => w.task("c1", (await newest(w))!.id);
const handed = async (w: P5World) => ((await detail(w)).subagents[0]?.rows[0]?.steps as StepView[] | undefined)?.find?.((s) => s.kind === "handoff")?.detail.prose ?? "";
const number = (s: string) => /\b(\d+)\b/.exec(s)?.[1] ?? null;
const ack = (w: P5World) => w.replies()[0] ?? "";

const graders: Grader<P5World>[] = [
  { name: "the acknowledgement says what was launched and not done", kind: "end_state", check: (w) => /sub-agent/i.test(ack(w)) && !DONE_WORDS.test(ack(w)) && number(ack(w)) === null },
  { name: "the reply's count equals the child's handoff", kind: "end_state", check: async (w) => number(await handed(w)) !== null && number(w.replies().at(-1) ?? "") === number(await handed(w)) },
  { name: "the drawer has the section with the child's steps", kind: "end_state", check: async (w) => Array.isArray((await detail(w)).subagents[0]?.rows[0]?.steps) },
  { name: "the acknowledgement is graded by its deny-list, the handoff read from the record", kind: "required_fact", check: async (w) => (await handed(w)).length > 0 },
  { name: "done_before_result", kind: "minefield", check: (w) => DONE_WORDS.test(ack(w)) },
  { name: "reply_disagrees", kind: "minefield", check: async (w) => number(w.replies().at(-1) ?? "") !== number(await handed(w)) },
  { name: "hidden_child", kind: "minefield", check: async (w) => (await detail(w)).subagents.length === 0 },
];

export const task = defineTask<P5World>({
  id: "T-P5-14",
  cluster: "P5",
  clauses: ["B-P5-08"],
  priority: "nice-to-have",
  tier: 2,
  setup: { seed: 514, records: ["chat:c1 on the slot", "the slot's probe page with one link"], files: [], jobs: [] },
  turns: [{ kind: "event", name: "prompt", payload: { text: COUNT_ASK } }],
  end_state: graders.filter((g) => g.kind === "end_state").map((g) => g.name),
  required_facts: graders.filter((g) => g.kind === "required_fact").map((g) => g.name),
  minefields: graders.filter((g) => g.kind === "minefield").map((g) => g.name),
  collateral: {},
  graders,
  reference: "Muse's \"Done — a sub-agent is on it\" (B-P5-08).",
});

export default task;
