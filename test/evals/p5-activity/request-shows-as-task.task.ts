// T-P5-01 (B-P5-01): one request is one task in the Activity tab. Sam asks c1 to read the probe page and write its title
// and link count to p5-probe.md, then asks c1 something else, then asks c2 for a mail that pauses on a card and resumes
// after her decision. The list is hers across chats, newest first: three rows, the resume no second row. fletch's
// forms: the request carries the address in full (`browse_open` opens only an address Sam wrote), and a step count
// includes the tool load the turn made (fletch counts every tool step but `send_to_user`; F13).
import { defineTask, type Grader } from "../../support/task.ts";
import type { P5World, TaskView } from "./world.ts";
import { PROBE } from "./world.ts";

export const ASK = `Read ${PROBE} and write its title and link count to p5-probe.md`;
export const OTHER = "What day is the offsite?";
export const MAIL = "Mail Pat the probe notes.";
/** A title is the request's own words, cut at the cap with an ellipsis. */
export const fromRequest = (title: string, request: string) => request.startsWith(title.replace(/…$/, ""));
const tasks = async (w: P5World) => (await w.activity()).tasks;
const typed = (w: P5World) => [...w.thread("c1"), ...w.thread("c2")].filter((e) => e.kind === "you").map((e) => e.text);
const first = async (w: P5World): Promise<TaskView | undefined> => (await tasks(w)).filter((t) => t.chat === "c1").at(-1);

const graders: Grader<P5World>[] = [
  { name: "one row per request across both chats, newest first", kind: "end_state", check: async (w) => {
    const t = await tasks(w);
    return t.map((x) => x.chat).join() === "c2,c1,c1" && fromRequest(t[0]!.title, MAIL) && fromRequest(t[1]!.title, OTHER) && fromRequest(t[2]!.title, ASK);
  } },
  { name: "the request's row is typed, titled by Sam's words under the cap, Complete with the check glyph, three steps and one turn", kind: "end_state", check: async (w) => {
    const t = await first(w);
    const row = (await w.rows()).filter((r) => r.kind === "task")[2];
    return !!t && t.origin === "typed" && fromRequest(t.title, ASK) && t.status === "done" && t.words === "Complete" && row?.desc === "Complete" && row.glyph === "check" && t.stepCount === 3 && t.turnIds.length === 1;
  } },
  { name: "the card's resume is the same row, with both turns", kind: "end_state", check: async (w) => {
    const c2 = (await tasks(w)).filter((t) => t.chat === "c2");
    return c2.length === 1 && c2[0]!.status === "done" && c2[0]!.turnIds.length === 2;
  } },
  { name: "the summary is code's and names the file written", kind: "required_fact", check: async (w) => (await first(w))?.summary === "Read 1; wrote 1 (p5-probe.md)" },
  { name: "every chat is listed or named with its code, none dropped", kind: "required_fact", check: async (w) => (await w.activity()).unread.length === 0 && new Set((await tasks(w)).map((t) => t.chat)).size === 2 },
  { name: "row_per_turn", kind: "minefield", check: async (w) => (await tasks(w)).filter((t) => t.chat === "c1").length > 2 },
  { name: "row_per_resume", kind: "minefield", check: async (w) => (await tasks(w)).filter((t) => t.chat === "c2").length > 1 },
  { name: "title_from_model", kind: "minefield", check: async (w) => (await tasks(w)).some((t) => !typed(w).some((m) => fromRequest(t.title, m))) },
  { name: "gated_only", kind: "minefield", check: async (w) => (await tasks(w)).filter((t) => t.chat === "c1").length < 2 },
  { name: "silent_unread", kind: "minefield", check: async (w) => {
    const a = await w.activity();
    return new Set([...a.tasks.map((t) => t.chat), ...a.unread.map((u) => u.chat)]).size < 2;
  } },
  { name: "live_rewrite", kind: "minefield", check: async (w) => (await tasks(w)).some((t) => [...w.replies("c1"), ...w.replies("c2")].some((r) => r && (t.summary ?? "").includes(r))) },
];

export const task = defineTask<P5World>({
  id: "T-P5-01",
  cluster: "P5",
  clauses: ["B-P5-01"],
  priority: "must-have",
  tier: 1,
  setup: { seed: 501, records: ["chat:c1", "chat:c2", "the probe page with one link"], files: [], jobs: [] },
  turns: [
    { kind: "event", name: "prompt", payload: { text: ASK } },
    { kind: "event", name: "prompt", payload: { text: OTHER } },
    { kind: "event", name: "prompt", payload: { text: MAIL, chat: "c2" } },
    { kind: "event", name: "decide", payload: { chat: "c2" } },
    { kind: "event", name: "open" },
  ],
  end_state: graders.filter((g) => g.kind === "end_state").map((g) => g.name),
  required_facts: graders.filter((g) => g.kind === "required_fact").map((g) => g.name),
  minefields: graders.filter((g) => g.kind === "minefield").map((g) => g.name),
  collateral: { r2: ["p5-probe.md"], journal: ["mail.send:PENDING", "mail.send:DONE"] },
  graders,
  reference: "Muse's one thread per user turn with a model-rewritten subtitle, global and capped (B-P5-01).",
});

export default task;
