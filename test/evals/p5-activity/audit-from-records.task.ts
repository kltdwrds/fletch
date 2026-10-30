// T-P5-10 (B-P5-10, B-P5-11): an audit is a read over the records. In c1 Sam has the probe file written, a job set by
// `jobs_create`, two sub-agents launched, a memory line saved and a reply; then she asks what the chat created, changed
// or deleted. The tasks' steps, read by code, name every write with its subject, and their counts equal the stores' (1
// file, 1 job, 2 children, 1 memory line); the reply names the same; the journal is content-free and holds no memory
// write; and no table of any Durable Object the world built changed outside the transcript, the tasks' sources, the
// job, the sub-agent rows, memory, the journal and the Ledger.
import { defineTask, type Grader } from "../../support/task.ts";
import { ASK } from "./request-shows-as-task.task.ts";
import type { P5World, StepView } from "./world.ts";
import { replyOf } from "./world.ts";

export const AUDIT = "What did you create, change or delete in this chat?";
export const JOB_TITLE = "p5 probe: the morning check";
/**
 * The tables a chat's work may write: its transcript and tasks' sources, the person's files, memory and job index, the
 * job, the sub-agent rows and facets, the journal and the Ledger; and the schema rows (`migrations`, a full-text index's
 * own tables, `delivery_state`) every object writes when it is first made.
 */
const SCHEMA = /\/(migrations|\w*_fts(_\w+)?|delivery_state)$/;
export const MAY_WRITE = /^(c1\/(messages|turns|chat_meta|projections|mailbox|outbox|subagents|subagent_groups|tool_loads|todos)|person:[^/]+\/(files|vfs_\w+|_vfs_\w+|chunks\w*|vector_queue|daily_lines|memory_meta|job_index|committed_effects|grants|grant_uses|delivery_state)|job:[^/]+\/[^/]+\/\w+|[0-9a-f-]+\.\d+\/\w+|ledger\/(model_calls|journal|runs|turn_ends|browser_ms)|subagent:[^/]+\/\w+)$/;
const steps = async (w: P5World): Promise<StepView[]> => {
  const out: StepView[] = [];
  for (const t of (await w.activity()).tasks.filter((x) => x.chat === "c1")) out.push(...(await w.task("c1", t.id)).steps);
  return out;
};
const children = async (w: P5World) => {
  let n = 0;
  for (const t of (await w.activity()).tasks.filter((x) => x.chat === "c1")) for (const s of (await w.task("c1", t.id)).subagents) n += s.rows.length;
  return n;
};
const changed = (w: P5World) => Object.entries(w.tables()).filter(([k, n]) => n !== (w.before[k] ?? 0) && !SCHEMA.test(k)).map(([k]) => k);
const recorded = async (w: P5World) => {
  const s = await steps(w);
  return { files: s.filter((x) => x.tool === "file_write" && x.state === "done").length, jobs: s.filter((x) => x.tool === "jobs_create" && x.state === "done").length, children: await children(w), memory: s.filter((x) => x.tool === "memory_write" && x.state === "done").length };
};

const graders: Grader<P5World>[] = [
  { name: "the tasks' steps name every write with its subject, and their counts equal the stores'", kind: "end_state", check: async (w) => {
    const r = await recorded(w);
    const s = await steps(w);
    return r.files === 1 && (await w.files()).includes("p5-probe.md") && r.jobs === 1 && w.jobTitles().includes(JOB_TITLE) && r.children === 2 && w.subagents("c1").length === 2 && r.memory === 1 && w.memoryLines().length === 1
      && s.some((x) => x.tool === "file_write" && x.title.includes("p5-probe.md")) && s.some((x) => x.tool === "jobs_create" && x.title.includes(JOB_TITLE)) && s.some((x) => x.tool === "memory_write" && /saved \S+/.test(x.detail.result?.text ?? ""));
  } },
  { name: "the reply names the same five objects", kind: "end_state", check: (w) => /p5-probe\.md/.test(replyOf(w)) && replyOf(w).includes(JOB_TITLE) && /two sub-agents/.test(replyOf(w)) && /memory/.test(replyOf(w)) },
  { name: "the journal is content-free and a memory write is a step, not a journal row", kind: "required_fact", check: async (w) => (await w.journal()).every((r) => !/^memory/.test(r.kind) && !r.fields.some((f) => /^(text|body|content|message|summary|brief|prompt)$/i.test(f))) },
  { name: "no table changed outside the transcript, the tasks' sources, the job, the sub-agent rows, memory, the journal and the Ledger", kind: "required_fact", check: (w) => changed(w).length > 0 && changed(w).every((k) => MAY_WRITE.test(k)) },
  { name: "undercount", kind: "minefield", check: async (w) => {
    const r = await recorded(w);
    return r.files < 1 || r.jobs < w.jobTitles().length || r.children < w.subagents("c1").length || r.memory < w.memoryLines().length;
  } },
  { name: "from_recollection", kind: "minefield", check: async (w) => (await children(w)) !== w.subagents("c1").length },
  { name: "hidden_store", kind: "minefield", check: (w) => changed(w).some((k) => !MAY_WRITE.test(k)) },
  { name: "content_in_journal", kind: "minefield", check: async (w) => (await w.journal()).some((r) => r.fields.some((f) => /^(text|body|content|message|summary|brief|prompt)$/i.test(f))) },
];

export const task = defineTask<P5World>({
  id: "T-P5-10",
  cluster: "P5",
  clauses: ["B-P5-10", "B-P5-11"],
  priority: "must-have",
  tier: 1,
  setup: { seed: 510, records: ["chat:c1", "the probe page with one link", "a snapshot of every table of the world's objects"], files: [], jobs: [] },
  turns: [
    { kind: "event", name: "prompt", payload: { text: ASK } },
    { kind: "event", name: "prompt", payload: { text: "Every morning at 9, remind me to check the probe." } },
    { kind: "event", name: "prompt", payload: { text: "Have two sub-agents read the probe page." } },
    { kind: "event", name: "prompt", payload: { text: "Remember that the probe page is for the p5 check." } },
    { kind: "event", name: "prompt", payload: { text: AUDIT } },
  ],
  end_state: graders.filter((g) => g.kind === "end_state").map((g) => g.name),
  required_facts: graders.filter((g) => g.kind === "required_fact").map((g) => g.name),
  minefields: graders.filter((g) => g.kind === "minefield").map((g) => g.name),
  collateral: { r2: ["p5-probe.md"] },
  graders,
  reference: "Muse's audit from memory search, \"one sub-agent run\" over four, the worker unlisted, 22 background lines in the daily log (B-P5-10, B-P5-11).",
});

export default task;
