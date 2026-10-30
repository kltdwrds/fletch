// T-P5-03 (B-P5-03): the thread stays a conversation. Sam's request runs held before its reply: the thread then holds
// her message and the running turn with the composer's Stop offered, no tool name and no line per call; after, the
// reply, and the row holds the steps. A second request is held after its read while Sam presses Stop: the turn ends
// `stopped` with the stop note, and its row reads Stopped with what it had done by count (the read).
import { defineTask, type Grader } from "../../support/task.ts";
import { ASK } from "./request-shows-as-task.task.ts";
import type { P5World, ThreadEntry } from "./world.ts";

export const AGAIN = "Read that page again and count its sentences";
export const REPLY = "I wrote the page's title and its 1 link to p5-probe.md.";
const TOOLS = /\b(browse_open|file_write|tool_search)\b|Read the page|Wrote `/;
const narrated = (t: ThreadEntry[]) => t.some((e) => TOOLS.test(e.text));
const rows = async (w: P5World) => (await w.activity()).tasks;

const graders: Grader<P5World>[] = [
  { name: "while running, the thread holds the request and the running turn with Stop, no tool name and no call line", kind: "end_state", check: (w) => !!w.during && w.during.stop && w.during.status === "running" && w.during.thread.map((e) => e.kind).join() === "you" && !narrated(w.during.thread) },
  { name: "after, the reply is in the thread and the row holds the steps", kind: "end_state", check: async (w) => w.replies().includes(REPLY) && (await rows(w)).at(-1)?.stepCount === 3 && (await rows(w)).at(-1)?.status === "done" },
  { name: "Stop ends the turn stopped, said in the thread, and its row reads Stopped with what was already done", kind: "required_fact", check: async (w) => (await rows(w))[0]?.status === "stopped" && (await rows(w))[0]?.words === "Stopped" && (await rows(w))[0]?.summary === "Read 1" && w.thread().some((e) => e.kind === "stopped") },
  { name: "the thread's words are the model's and the cards', never a narration of calls", kind: "required_fact", check: (w) => !narrated(w.thread()) },
  { name: "narrated_calls", kind: "minefield", check: (w) => narrated(w.thread()) || narrated(w.during?.thread ?? []) },
  { name: "no_stop", kind: "minefield", check: (w) => !w.during?.stop },
  { name: "silent_minutes", kind: "minefield", check: (w) => !!w.during && w.during.status !== "running" && !w.during.stop },
  { name: "stop_not_settled", kind: "minefield", check: async (w) => (await rows(w))[0]?.status === "running" },
];

export const task = defineTask<P5World>({
  id: "T-P5-03",
  cluster: "P5",
  clauses: ["B-P5-03"],
  priority: "must-have",
  tier: 1,
  setup: { seed: 503, records: ["chat:c1", "the probe page with one link"], files: [], jobs: [] },
  turns: [
    { kind: "event", name: "hold", payload: { text: ASK } },
    { kind: "event", name: "hold", payload: { text: AGAIN, stop: "yes" } },
  ],
  end_state: graders.filter((g) => g.kind === "end_state").map((g) => g.name),
  required_facts: graders.filter((g) => g.kind === "required_fact").map((g) => g.name),
  minefields: graders.filter((g) => g.kind === "minefield").map((g) => g.name),
  collateral: { r2: ["p5-probe.md"] },
  graders,
  reference: "Muse's typing dots and composer stop while the Activity row carries the steps (B-P5-03).",
});

export default task;
