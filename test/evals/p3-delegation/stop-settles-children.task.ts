// T-P3-06 (B-P3-06): a stop is said and settles what it stopped. Sam asks c1 for the two-page child, then a second
// request launches a link-counting child; while the first child is held mid-run Sam presses the first task's Stop (the
// drawer's: its turn has ended with the delegation out, F31). The thread says the stopped turn stopped
// (`STOPPED_TEXT`); the first child ends `failed` with SUBAGENT_CLOSED, its delegation handed off without a turn, and no
// handoff turn opens on the next alarm; the second request's child is untouched and hands off. Sam then asks to resume
// the sub-agent: fletch has no resume (delta 3), the next turn's transcript holds the stop note naming the delegation,
// and the reply says the sub-agent was ended and a new one can be started, starting none. After a reload the stopped
// entry is still in the thread.
import { defineTask, type Grader } from "../../support/task.ts";
import type { P3World } from "./world.ts";
import { DONE_WORDS, PROBE, PROBE_2 } from "./world.ts";

export const ASK = `Have a sub-agent read ${PROBE} and then ${PROBE_2} and report both titles.`;
export const OTHER = `Have another sub-agent count the links on ${PROBE}.`;
export const RESUME = "resume that sub-agent";
const STOPPED = "Stopped. Your agent did not finish this.";
const first = (w: P3World) => w.children("c1")[0];
const other = (w: P3World) => w.children("c1")[1];
const stoppedEntry = (w: P3World) => w.thread("c1").find((e) => e.kind === "stopped");
const resumeReply = (w: P3World) => w.replies("c1").at(-1) ?? "";
const handoffOf = (w: P3World, grp?: string) => w.mailbox("c1").filter((m) => m.messageId === `handoff:${grp}`);
const stoppedTask = async (w: P3World) => (await w.activity()).tasks.filter((t) => t.chat === "c1").at(-1);

const graders: Grader<P3World>[] = [
  { name: "the thread shows the stopped text for the stopped turn, never done", kind: "end_state", check: (w) => !!stoppedEntry(w)?.text.startsWith(STOPPED) && !DONE_WORDS.test(STOPPED) },
  { name: "the first child is failed SUBAGENT_CLOSED, its delegation handed off without a turn", kind: "end_state", check: (w) => first(w)?.status === "failed" && first(w)?.code === "SUBAGENT_CLOSED" && first(w)?.handedOffAt !== null && handoffOf(w, first(w)?.grp).length === 0 },
  { name: "the stopped task reads Stopped", kind: "end_state", check: async (w) => (await stoppedTask(w))?.status === "stopped" },
  { name: "the second request's child is untouched and hands off once", kind: "end_state", check: (w) => other(w)?.status === "done" && handoffOf(w, other(w)?.grp).length === 1 },
  { name: "the next turn's transcript holds the stop note naming the delegation", kind: "end_state", check: (w) => w.requests().at(-1)?.includes("(From the harness.) The person stopped this task") === true && w.requests().at(-1)!.includes(first(w)!.grp) },
  { name: "the resume ask starts nothing and the reply says the sub-agent was ended and a new one can be started", kind: "end_state", check: (w) => /ended|stopped/i.test(resumeReply(w)) && /new one/i.test(resumeReply(w)) && w.children("c1").length === 2 },
  { name: "after a reload the stopped entry is still in the thread", kind: "end_state", check: (w) => w.entryIds("c1").some((e) => e.startsWith("stopped:")) },
  { name: "a Stop settles the stopped turn's children only; a settled child never runs again", kind: "required_fact", check: (w) => w.held?.children[0]?.code === "SUBAGENT_CLOSED" && w.held.children[1]?.status === "queued" && w.childRequests().filter((r) => r.messages[0]?.text.includes("both probe pages")).length <= 3 },
  { name: "child_runs_on", kind: "minefield", check: (w) => first(w)?.status === "running" || first(w)?.status === "done" || handoffOf(w, first(w)?.grp).length > 0 },
  { name: "silent_stop", kind: "minefield", check: (w) => !stoppedEntry(w) },
  { name: "stopped_as_done", kind: "minefield", check: async (w) => (await stoppedTask(w))?.status === "done" || !stoppedEntry(w)?.text.startsWith(STOPPED) },
  { name: "resumed_terminal", kind: "minefield", check: (w) => w.children("c1").length > 2 || w.childRequests().filter((r) => r.messages[0]?.text.includes("both probe pages")).length > 3 },
  { name: "other_children_closed", kind: "minefield", check: (w) => other(w)?.code === "SUBAGENT_CLOSED" },
  { name: "stop_entry_lost", kind: "minefield", check: (w) => !w.entryIds("c1").some((e) => e.startsWith("stopped:")) },
];

export const task = defineTask<P3World>({
  id: "T-P3-06",
  cluster: "P3",
  clauses: ["B-P3-06"],
  priority: "must-have",
  tier: 1,
  setup: { seed: 306, records: ["chat:c1", "the two probe pages"], files: [], jobs: [] },
  turns: [
    { kind: "event", name: "prompt", payload: { text: ASK, wait: "yes" } },
    { kind: "event", name: "prompt", payload: { text: OTHER, wait: "yes" } },
    { kind: "event", name: "midchild", payload: { stop: "yes" } },
    { kind: "event", name: "children" },
    { kind: "event", name: "prompt", payload: { text: RESUME } },
    { kind: "event", name: "reload" },
  ],
  end_state: graders.filter((g) => g.kind === "end_state").map((g) => g.name),
  required_facts: graders.filter((g) => g.kind === "required_fact").map((g) => g.name),
  minefields: graders.filter((g) => g.kind === "minefield").map((g) => g.name),
  collateral: {},
  graders,
  reference: "Muse's Stop ended only the parent's sentence; the child ran on and re-answered the stopped question; no item for the stop (B-P3-06).",
});

export default task;
