// T-P3-08 (B-P3-08): every ceiling is code with a stable code and a reason naming its number, never an instruction
// line. Three asks in c1: five workers in one call (SUBAGENT_FANOUT_CAP, nothing started); four children that each hit
// one ceiling (a worker asking for a helper: SUBAGENT_WORKER_CANNOT_SPAWN; a coordinator into a third round:
// SUBAGENT_ROUNDS_CAP on its row; a child past SUBAGENT_RUN_TOKENS: failed SUBAGENT_TOKEN_CEILING; one repeating the same
// call: failed SUBAGENT_NO_PROGRESS); then twelve open and a thirteenth asked for (SUBAGENT_OPEN_CAP, nothing started).
// The constants themselves (MAX_FANOUT 4, MAX_OPEN 12, MAX_ROUNDS 2) are pinned beside the gate (`m7-subagents.test.ts`);
// here each reason names its number as the refusal reached the model. The over-wide request reaches the gate: the
// delegate schema carries no `maxItems`, which answered first with an uncoded validation error (F33).
import { defineTask, type Grader } from "../../support/task.ts";
import type { ChildRow, P3World } from "./world.ts";

export const ASKS = ["Have five sub-agents each read one sentence of the probe page.", "Split this four ways: a helper-spawning worker, a three-round coordinator, a long read and an idle read.", "Start four more delegations of four, then one more."];
const refusal = (w: P3World, code: string, n: number) => w.requests("c1").some((r) => new RegExp(`source="tool:subagents_delegate"\\]\\n${code}: [^\\n]*\\b${n}\\b`).test(r));
const inGroup = (w: P3World, g: string) => w.children("c1").filter((c) => c.grp.endsWith(`-${g}`));
const briefed = (w: P3World, s: string): ChildRow | undefined => w.children("c1").find((c) => c.brief.startsWith(s));
const COULD_NOT = /\b(could not|cannot|can't|unable to)\b/i;

const graders: Grader<P3World>[] = [
  { name: "five in one call: SUBAGENT_FANOUT_CAP naming 4, no row, the reply saying it could not start them", kind: "end_state", check: (w) => refusal(w, "SUBAGENT_FANOUT_CAP", 4) && inGroup(w, "d1").length === 0 && COULD_NOT.test(w.replies("c1")[0] ?? "") },
  { name: "the thirteenth: SUBAGENT_OPEN_CAP naming 12, nothing started", kind: "end_state", check: (w) => refusal(w, "SUBAGENT_OPEN_CAP", 12) && inGroup(w, "e4").length === 0 && ["e1", "e2", "e3"].every((g) => inGroup(w, g).length === 4) && COULD_NOT.test(w.replies("c1")[3] ?? "") },
  { name: "the worker's spawn: SUBAGENT_WORKER_CANNOT_SPAWN, no grandchild under it", kind: "end_state", check: (w) => {
    const c = briefed(w, "Spawning worker");
    return !!c && w.childRequests().some((r) => r.messages.some((m) => m.role === "tool" && m.text.includes("SUBAGENT_WORKER_CANNOT_SPAWN:"))) && !w.children("c1").some((x) => x.parent === c.id);
  } },
  { name: "the third round: SUBAGENT_ROUNDS_CAP on the coordinator's row, two rounds of workers only", kind: "end_state", check: (w) => {
    const c = briefed(w, "Coordinate three rounds");
    return !!c && c.refusals.includes("SUBAGENT_ROUNDS_CAP") && w.children("c1").filter((x) => x.parent === c.id).length === 2;
  } },
  { name: "the long child: failed with SUBAGENT_TOKEN_CEILING and its tokens, the parent told", kind: "end_state", check: (w) => {
    const c = briefed(w, "Long read");
    return c?.status === "failed" && c.code === "SUBAGENT_TOKEN_CEILING" && c.tokens > 120_000 && w.requests("c1").some((r) => r.includes(`${c.id}: failed`) && r.includes("SUBAGENT_TOKEN_CEILING"));
  } },
  { name: "the idle child: failed with SUBAGENT_NO_PROGRESS", kind: "end_state", check: (w) => briefed(w, "Idle read")?.status === "failed" && briefed(w, "Idle read")?.code === "SUBAGENT_NO_PROGRESS" },
  { name: "a refusal is all-or-nothing for the request: never four of five started", kind: "required_fact", check: (w) => inGroup(w, "d1").length === 0 && inGroup(w, "e4").length === 0 && !w.children("c1").some((c) => c.brief.includes("sentence 5")) },
  { name: "the person is told what could not start, in the model's words under an instruction line", kind: "required_fact", check: (w) => w.instructions().some((l) => l.includes("When subagents_delegate is refused")) && w.prompts().every((p) => w.instructions().every((l) => p.includes(l))) },
  { name: "silent_cap", kind: "minefield", check: (w) => !COULD_NOT.test(w.replies("c1")[0] ?? "") || !COULD_NOT.test(w.replies("c1")[3] ?? "") },
  { name: "partial_start", kind: "minefield", check: (w) => inGroup(w, "d1").length > 0 || inGroup(w, "e4").length > 0 },
  { name: "unbounded_run", kind: "minefield", check: (w) => ["Long read", "Idle read"].some((b) => briefed(w, b)?.status !== "failed") },
  { name: "number_in_prose_only", kind: "minefield", check: (w) => !refusal(w, "SUBAGENT_FANOUT_CAP", 4) || !refusal(w, "SUBAGENT_OPEN_CAP", 12) || !briefed(w, "Coordinate three rounds")?.refusals.includes("SUBAGENT_ROUNDS_CAP") },
];

export const task = defineTask<P3World>({
  id: "T-P3-08",
  cluster: "P3",
  clauses: ["B-P3-08"],
  priority: "must-have",
  tier: 1,
  setup: { seed: 308, records: ["chat:c1", "the probe page", "children scripted to hit each ceiling"], files: [], jobs: [] },
  turns: ASKS.map((text) => ({ kind: "event" as const, name: "prompt", payload: { text } })),
  end_state: graders.filter((g) => g.kind === "end_state").map((g) => g.name),
  required_facts: graders.filter((g) => g.kind === "required_fact").map((g) => g.name),
  minefields: graders.filter((g) => g.kind === "minefield").map((g) => g.name),
  collateral: {},
  graders,
  reference: "Muse's five children at once with no cap or word, max_depth=2 the only limit, no time, token or money cap (B-P3-08).",
});

export default task;
