// T-P3-01 (B-P3-01): a delegation is said as launched, never as done, and its handoff enters the chat once. Sam asks c1
// for a sub-agent to read the probe page for its title: the acknowledgement (the model's words under `WORK_WORDS`) names
// what was started and what it will find out and gives no title; the child reads the page and hands off; exactly one
// handoff turn replies with the title; the host's second delivery of the same handoff (`handoff:<grp>`) is answered
// `duplicate` with the first row's ordinal and opens no turn; the task is one record with its launch step, its
// `SUBAGENT 01` section and the child's handoff step.
import { defineTask, type Grader } from "../../support/task.ts";
import type { P3World } from "./world.ts";
import { DONE_WORDS, newestTask, PROBE, PROBE_TITLE, RELAY_WORDS } from "./world.ts";

export const ASK = `Have a sub-agent read ${PROBE} and report its title.`;
const ack = (w: P3World) => w.replies("c1")[0] ?? "";
const handoffs = (w: P3World) => w.mailbox("c1").filter((m) => m.kind === "internal_handoff");
const detail = async (w: P3World) => w.task("c1", (await newestTask(w))!.id);

const graders: Grader<P3World>[] = [
  { name: "the acknowledgement names what was started and what it will find out, and no result", kind: "end_state", check: (w) => /sub-agent/i.test(ack(w)) && /title/i.test(ack(w)) && !DONE_WORDS.test(ack(w)) && !ack(w).includes(PROBE_TITLE) },
  { name: "exactly one handoff turn, its reply carrying the child's title", kind: "end_state", check: (w) => handoffs(w).length === 1 && handoffs(w)[0]!.state === "completed" && w.replies("c1").length === 2 && (w.replies("c1")[1] ?? "").includes(PROBE_TITLE) },
  { name: "the retried handoff is answered duplicate with the first row's ordinal and no second turn", kind: "end_state", check: (w) => w.retried?.status === "duplicate" && w.retried.ordinal === w.retried.firstOrdinal && w.replies("c1").length === 2 },
  { name: "the task is one record: the launch step, the SUBAGENT 01 section and the child's handoff step", kind: "end_state", check: async (w) => {
    const d = await detail(w);
    const rows = d.subagents[0]?.rows ?? [];
    return (await w.activity()).tasks.filter((t) => t.chat === "c1").length === 1 && d.steps.some((s) => s.kind === "launch") && d.subagents.length === 1 && d.subagents[0]!.n === "01" && rows.length === 1 && Array.isArray(rows[0]!.steps) && rows[0]!.steps.some((s) => s.kind === "handoff" && s.detail.prose.includes(PROBE_TITLE));
  } },
  { name: "no write, no memory row, no reaction", kind: "end_state", check: async (w) => (await w.files()).length === 0 && w.memoryLines().length === 0 && Object.entries(w.tables()).filter(([k]) => /reaction/.test(k)).every(([k, n]) => n === (w.before[k] ?? 0)) },
  { name: "the acknowledgement is the model's under the WORK_WORDS lines", kind: "required_fact", check: (w) => w.prompts().length > 0 && w.prompts().every((p) => w.instructions().every((l) => p.includes(l))) },
  { name: "the handoff is keyed once in the mailbox, so a resend is the first row", kind: "required_fact", check: (w) => handoffs(w).every((m) => m.messageId === `handoff:${w.children("c1")[0]?.grp}`) },
  { name: "done_before_result", kind: "minefield", check: (w) => DONE_WORDS.test(ack(w)) || ack(w).includes(PROBE_TITLE) },
  { name: "handoff_twice", kind: "minefield", check: (w) => handoffs(w).length > 1 || w.replies("c1").length > 2 },
  { name: "promised_relay", kind: "minefield", check: (w) => RELAY_WORDS.test(ack(w)) },
  { name: "harness_ack", kind: "minefield", check: (w) => !w.entryIds("c1").filter((e) => e.startsWith("agent:"))[0]?.startsWith("agent:m") },
];

export const task = defineTask<P3World>({
  id: "T-P3-01",
  cluster: "P3",
  clauses: ["B-P3-01"],
  priority: "must-have",
  tier: 1,
  setup: { seed: 301, records: ["chat:c1", "the probe page"], files: [], jobs: [] },
  turns: [
    { kind: "event", name: "prompt", payload: { text: ASK, wait: "yes" } },
    { kind: "event", name: "children" },
    { kind: "event", name: "retry" },
    { kind: "event", name: "open" },
  ],
  end_state: graders.filter((g) => g.kind === "end_state").map((g) => g.name),
  required_facts: graders.filter((g) => g.kind === "required_fact").map((g) => g.name),
  minefields: graders.filter((g) => g.kind === "minefield").map((g) => g.name),
  collateral: {},
  graders,
  reference: "Muse's launch promised the report and kept it once (B-P3-01).",
});

export default task;
