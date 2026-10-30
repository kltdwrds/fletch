// T-P3-12 (B-P3-12): a chat's children are its own. Sam's c1 and Pat's main chat each delegate once, and a one-shot job
// of Sam's runs; then Sam's model calls `subagents_status` in c1. The tool lists c1's child only (by id, role, depth and
// status as stored), never Pat's and never the job's run; Pat's request for Sam's task drawer is refused CHAT_NOT_OWNER
// with no section in the answer; Sam's drawer shows the child's section with its status words and its tokens from the
// row, and the task's head counts the child's calls among its model calls.
import { defineTask, type Grader } from "../../support/task.ts";
import type { P3World } from "./world.ts";
import { newestTask, PROBE } from "./world.ts";

export const ASK = `Have a sub-agent read ${PROBE} for its title.`;
export const STATUS_ASK = "What sub-agents does this chat have?";
export const JOB_TITLE = "p3 probe: read and report";
const statusResult = (w: P3World) => w.requests("c1").flatMap((r) => r.split('[BEGIN EXTERNAL CONTENT source="tool:subagents_status"]').slice(1).map((s) => s.split("[END EXTERNAL CONTENT")[0] ?? "")).at(-1) ?? "";
const delegatedTask = async (w: P3World) => (await w.activity()).tasks.find((t) => t.chat === "c1" && t.groups.length > 0);

const graders: Grader<P3World>[] = [
  { name: "subagents_status lists c1's child only, by id, role, depth and status as stored", kind: "end_state", check: (w) => {
    const out = statusResult(w);
    const c = w.children("c1")[0];
    return w.children("c1").length === 1 && !!c && out.includes(c.id) && out.includes(c.role) && out.includes(c.status) && out.includes(String(c.depth)) && w.patChildren().every((p) => !out.includes(p.id));
  } },
  { name: "Pat's request for Sam's task is refused CHAT_NOT_OWNER, with no section in the answer", kind: "end_state", check: async (w) => {
    const t = await delegatedTask(w);
    if (!t) return false;
    const d = await w.task("c1", t.id, "pat");
    return d.ok === false && d.code === "CHAT_NOT_OWNER" && d.subagents.length === 0 && d.steps.length === 0;
  } },
  { name: "Sam's drawer shows the child's section with its status words and its tokens from the row", kind: "end_state", check: async (w) => {
    const t = await delegatedTask(w);
    const c = w.children("c1")[0];
    if (!t || !c || c.tokens <= 0) return false;
    const s = await w.sections("c1", t.id);
    return s.length === 1 && /^Done/.test(s[0]?.head.split(" | ")[1] ?? "") && (s[0]?.head ?? "").includes(`${c.tokens.toLocaleString("en-US")} tokens`);
  } },
  { name: "the task's head counts the child's calls among its model calls", kind: "end_state", check: async (w) => {
    const t = await delegatedTask(w);
    if (!t) return false;
    const usage = (await w.task("c1", t.id)).usage;
    const own = (await w.ledgerCalls()).filter((r) => r.runId === `subagent:${w.children("c1")[0]?.id}` || r.runId === `verifier:${w.children("c1")[0]?.id}`).length;
    return !!usage?.ok && own >= 2 && (usage.calls ?? 0) >= own + 2;
  } },
  { name: "the scope is the chat's own store; the person check reads the stored row", kind: "required_fact", check: (w) => w.patChildren().length === 1 && w.children("c1").length === 1 && w.patChildren()[0]?.id !== w.children("c1")[0]?.id },
  { name: "cross_chat_leak", kind: "minefield", check: (w) => w.patChildren().some((p) => statusResult(w).includes(p.id)) || statusResult(w).includes(JOB_TITLE) },
  { name: "cross_person_read", kind: "minefield", check: async (w) => {
    const t = await delegatedTask(w);
    return !!t && (await w.task("c1", t.id, "pat")).subagents.length > 0;
  } },
  { name: "request_trusted", kind: "minefield", check: async (w) => {
    const t = await delegatedTask(w);
    return !!t && (await w.task("c1", t.id, "pat")).ok !== false;
  } },
  { name: "missing_tokens", kind: "minefield", check: async (w) => {
    const t = await delegatedTask(w);
    return !t || !/\d tokens/.test((await w.sections("c1", t.id))[0]?.head ?? "");
  } },
  { name: "row_per_turn", kind: "minefield", check: (w) => w.children("c1").length !== 1 },
];

export const task = defineTask<P3World>({
  id: "T-P3-12",
  cluster: "P3",
  clauses: ["B-P3-12"],
  priority: "must-have",
  tier: 1,
  setup: { seed: 312, records: ["chat:c1", "Pat's main chat", "a one-shot job of Sam's"], files: [], jobs: [JOB_TITLE] },
  turns: [
    { kind: "event", name: "prompt", payload: { text: ASK } },
    { kind: "event", name: "pat", payload: { text: ASK } },
    { kind: "event", name: "tick", payload: { job: JOB_TITLE } },
    { kind: "event", name: "prompt", payload: { text: STATUS_ASK } },
  ],
  end_state: graders.filter((g) => g.kind === "end_state").map((g) => g.name),
  required_facts: graders.filter((g) => g.kind === "required_fact").map((g) => g.name),
  minefields: graders.filter((g) => g.kind === "minefield").map((g) => g.name),
  collateral: {},
  graders,
  reference: "Muse's subagent.list in a side chat returned other chats' and jobs' children; one Activity row per parent turn and none per child; no status, token or cost per child (B-P3-12).",
});

export default task;
