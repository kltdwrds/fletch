// T-P3-05 (B-P3-05): a message that arrives while a child runs is answered on its own. Sam asks c1 for the two-page
// child; while it is held mid-run (`running`) Sam types "unrelated: what is 17 times 23?": no turn runs, so the message
// starts its own turn, which replies "391." while the child still runs; the child then hands off and its handoff turn
// comes after, once. The mailbox holds the question `completed` by its own turn and the handoff `completed` by its own.
// The shipped page draws "391." as text in the reply's bubble at desktop and phone width: no list element, no
// `<ol start>` marker (delta 8; the thread sets a message as text, never as markup).
import { defineTask, type Grader } from "../../support/task.ts";
import type { P3World, ThreadDom } from "./world.ts";
import { PROBE, PROBE_2, PROBE_TITLE } from "./world.ts";

export const ASK = `Have a sub-agent read ${PROBE} and then ${PROBE_2} and report both titles.`;
export const QUESTION = "unrelated: what is 17 times 23?";
const ANSWER = "391.";
const at = (w: P3World, f: (r: string) => boolean) => w.replies("c1").findIndex(f);
const asText = (d: ThreadDom) => d.lists.length === 0 && d.bubbles.some((b) => b.side === "agent" && b.text === ANSWER);

const graders: Grader<P3World>[] = [
  { name: "the question's turn replies 391. while the child is still running", kind: "end_state", check: (w) => w.held?.replies.includes(ANSWER) === true && w.held.children[0]?.status === "running" },
  { name: "the handoff turn comes after the answer, once", kind: "end_state", check: (w) => at(w, (r) => r === ANSWER) === 1 && at(w, (r) => r.includes(PROBE_TITLE)) === 2 && w.replies("c1").length === 3 },
  { name: "the mailbox holds the question and the handoff, each completed by its own turn", kind: "end_state", check: (w) => {
    const m = w.mailbox("c1");
    const q = m[1];
    const h = m.find((x) => x.kind === "internal_handoff");
    return m.length === 3 && q?.kind === "user" && q.state === "completed" && h?.state === "completed" && !!q.turnId && !!h.turnId && q.turnId !== h.turnId && q.ordinal < h.ordinal;
  } },
  { name: "the thread draws 391. as text in the reply's bubble, at desktop and phone width", kind: "end_state", check: async (w) => asText(await w.threadDom("c1")) && asText(await w.threadDom("c1", true)) },
  { name: "the child's run is unaffected by the question: it read both pages and handed off", kind: "end_state", check: (w) => w.children("c1").length === 1 && w.children("c1")[0]!.status === "done" && w.pagesRead().filter((u) => u === PROBE || u === PROBE_2).length === 2 },
  { name: "a message while no turn runs starts its own turn; the rendering grader reads the DOM", kind: "required_fact", check: (w) => w.mailbox("c1").filter((x) => x.kind === "user").every((x) => x.state === "completed") },
  { name: "question_queued", kind: "minefield", check: (w) => at(w, (r) => r === ANSWER) > at(w, (r) => r.includes(PROBE_TITLE)) },
  { name: "handoff_in_answer", kind: "minefield", check: (w) => w.replies("c1").some((r) => r.includes("391") && r.includes(PROBE_TITLE)) },
  { name: "question_lost", kind: "minefield", check: (w) => !w.replies("c1").includes(ANSWER) },
  { name: "number_as_marker", kind: "minefield", check: async (w) => !asText(await w.threadDom("c1")) || !asText(await w.threadDom("c1", true)) },
];

export const task = defineTask<P3World>({
  id: "T-P3-05",
  cluster: "P3",
  clauses: ["B-P3-05"],
  priority: "must-have",
  tier: 1,
  setup: { seed: 305, records: ["chat:c1", "the two probe pages"], files: [], jobs: [] },
  turns: [
    { kind: "event", name: "prompt", payload: { text: ASK, wait: "yes" } },
    { kind: "event", name: "midchild", payload: { text: QUESTION } },
  ],
  end_state: graders.filter((g) => g.kind === "end_state").map((g) => g.name),
  required_facts: graders.filter((g) => g.kind === "required_fact").map((g) => g.name),
  minefields: graders.filter((g) => g.kind === "minefield").map((g) => g.name),
  collateral: {},
  graders,
  reference: "Muse answered in 3.4 s and drew the answer as <ol start=\"391\"> with an empty item (B-P3-05).",
});

export default task;
