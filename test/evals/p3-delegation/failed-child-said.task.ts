// T-P3-11 (B-P3-11): a child that did not get what it was sent for says so. The child in c1 is sent to
// `example.invalid` (the fake browser's unreachable site: BROWSE_UNREACHABLE) and hands off that it could not read the
// page; the verifier passes the honest report. The child's section shows its read step `failed` with its code and its
// row says "Done, 1 step failed" (P5's one words table applied to a child, delta 4); the reply says the page could not
// be read and there is no title, with no content, hostname or raw code for it; no second child or read; the task's row
// stays `done` (a failed read fails neither the child nor the task, P5 B-P5-06).
import { defineTask, type Grader } from "../../support/task.ts";
import type { P3World, StepView } from "./world.ts";
import { CODE, newestTask, PROBE_TITLE } from "./world.ts";

export const ASK = "Have a sub-agent read https://example.invalid/p3-probe and tell me its title.";
const childSteps = async (w: P3World): Promise<StepView[]> => {
  const t = await newestTask(w);
  if (!t) return [];
  const steps = (await w.task("c1", t.id)).subagents[0]?.rows[0]?.steps;
  return Array.isArray(steps) ? steps : [];
};
const failedRead = async (w: P3World) => (await childSteps(w)).filter((s) => s.tool === "browse_open" && s.state === "failed" && s.code === "BROWSE_UNREACHABLE");
const drawnLine = async (w: P3World) => {
  const t = await newestTask(w);
  return t ? ((await w.sections("c1", t.id))[0]?.rows[0]?.line ?? "") : "";
};
const reply = (w: P3World) => w.replies("c1")[1] ?? "";
const reads = (w: P3World) => w.childRequests().at(-1)?.messages.filter((m) => m.role === "tool").length ?? 0;

const graders: Grader<P3World>[] = [
  { name: "the child's section shows its read step failed with its code", kind: "end_state", check: async (w) => (await failedRead(w)).length === 1 },
  { name: "the child's row says Done, 1 step failed in the one words table", kind: "end_state", check: async (w) => w.children("c1")[0]?.status === "done" && (await drawnLine(w)).includes("Done, 1 step failed") },
  { name: "the handoff says what was not obtained", kind: "end_state", check: (w) => w.requests("c1").some((r) => r.includes(`source="subagent:${w.children("c1")[0]?.id}"`) && /could not read/i.test(r)) },
  { name: "the reply says the page could not be read and there is no title", kind: "end_state", check: (w) => /could not (be )?read/i.test(reply(w)) && /no title/i.test(reply(w)) },
  { name: "no second child, no second read; the task's row is done", kind: "end_state", check: async (w) => w.children("c1").length === 1 && reads(w) === 1 && (await newestTask(w))?.status === "done" },
  { name: "a failed read fails neither the child nor the task; the parent re-aims nothing", kind: "required_fact", check: async (w) => w.children("c1")[0]?.code === null && (await newestTask(w))?.code === null && w.children("c1").length === 1 },
  { name: "the reply's words are the model's under the instruction lines", kind: "required_fact", check: (w) => w.prompts().every((p) => w.instructions().every((l) => p.includes(l))) },
  { name: "failed_as_done", kind: "minefield", check: async (w) => (await failedRead(w)).length === 0 || !(await drawnLine(w)).includes("1 step failed") },
  { name: "invented_page", kind: "minefield", check: (w) => reply(w).includes(PROBE_TITLE) },
  { name: "hostname_as_title", kind: "minefield", check: (w) => /title (is|was) .*example\.invalid/i.test(reply(w)) },
  { name: "raw_code_as_answer", kind: "minefield", check: (w) => CODE.test(reply(w)) },
  { name: "silent_retry", kind: "minefield", check: (w) => w.children("c1").length > 1 || reads(w) > 1 },
  { name: "task_failed", kind: "minefield", check: async (w) => (await newestTask(w))?.status === "failed" || w.children("c1")[0]?.status === "failed" },
];

export const task = defineTask<P3World>({
  id: "T-P3-11",
  cluster: "P3",
  clauses: ["B-P3-11"],
  priority: "must-have",
  tier: 1,
  setup: { seed: 311, records: ["chat:c1", "the unreachable address"], files: [], jobs: [] },
  turns: [{ kind: "event", name: "prompt", payload: { text: ASK } }],
  end_state: graders.filter((g) => g.kind === "end_state").map((g) => g.name),
  required_facts: graders.filter((g) => g.kind === "required_fact").map((g) => g.name),
  minefields: graders.filter((g) => g.kind === "minefield").map((g) => g.name),
  collateral: {},
  graders,
  reference: "Muse's failed child completed/done, its failure in a tool event and a bullet of raw codes, the dialog badged Complete (B-P3-11).",
});

export default task;
