// The P5 graders, planted (F31): each tier-1 task's minefields are run on a world where the fault happened. Where the
// fault can be planted on the production path it is: the failed-step words taken out of the table the row and the pill
// read, the instruction lines taken out of the prompt, a reply that says done or a raw code, a second model pass, and
// Pat, the second member, reading Sam's task. Elsewhere the one store the grader reads is altered as it would be had the
// fault happened (a second row, a retitled task, a summary in the model's words, a step drawn as markup, a run said
// reported with no delivery). Every honest run is the tier-1 run of `runs.ts`.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as instructions from "../../../packages/agent/src/chat/instructions.ts";
import { ACTIVITY_TEXT } from "../../../packages/agent/src/obs/activity-words.ts";
import type { DefinedTask } from "../../support/task.ts";
import audit from "./audit-from-records.task.ts";
import runInActivity, { LOST } from "./background-run-in-activity.task.ts";
import failedRead from "./failed-read-told-plainly.task.ts";
import { type P5HarnessOptions, type P5Tier1World, played } from "./harness.ts";
import partial from "./partial-failure-status.task.ts";
import words from "./record-words-from-code.task.ts";
import request, { ASK } from "./request-shows-as-task.task.ts";
import { ACK, BRIEF, COUNTED, delegate, held, load, routed, runs } from "./runs.ts";
import section from "./subagent-section.task.ts";
import summary from "./summary-is-code.task.ts";
import drawer from "./task-drawer-detail.task.ts";
import thread from "./thread-stays-conversation.task.ts";
import usage from "./usage-per-task-and-day.task.ts";
import type { P5World, StepView, TaskDetail, TaskView } from "./world.ts";

const grader = (task: DefinedTask<P5World>, name: string) => {
  const g = task.graders.find((x) => x.name === name);
  if (!g) throw new Error(`no grader ${name} on ${task.id}`);
  return (w: P5World) => g.check(w);
};
/** `w` with readings replaced: the store the grader reads, as it would be had the fault happened. */
const faulted = (w: P5World, over: (base: P5World) => Partial<P5World>): P5World => Object.assign(Object.create(w) as P5World, over(w));
const honest: Record<string, P5Tier1World> = {};
const run = (task: DefinedTask<P5World>, o: P5HarnessOptions = runs[task.id]!()) => played(task, o);
const fires = async (task: DefinedTask<P5World>, name: string, over: (base: P5World) => Partial<P5World>) => grader(task, name)(faulted(honest[task.id] as P5World, over));
/** The Activity list with `f` applied to its tasks. */
const tasksAs = (f: (t: TaskView[]) => TaskView[]) => (b: P5World) => ({ activity: async () => ({ ...(await b.activity()), tasks: f((await b.activity()).tasks) }) });
/** The drawer route's answer with `f` applied. */
const detailAs = (f: (d: TaskDetail) => TaskDetail) => (b: P5World) => ({ task: async (c: Parameters<P5World["task"]>[0], id: string, as?: "sam" | "pat") => f(await b.task(c, id, as)) });
const stepsAs = (f: (s: StepView[]) => StepView[]) => detailAs((d) => ({ ...d, steps: f(d.steps) }));
const summaryText = (f: (s: StepView) => StepView) => stepsAs((s) => s.map((x) => (x.kind === "summary" ? f(x) : x)));

describe("[F31] the P5 graders, planted", () => {
  beforeAll(async () => {
    for (const t of [request, drawer, thread, words, summary, failedRead, partial, section, runInActivity, audit, usage]) honest[t.id] = await run(t);
  });

  it("every tier-1 minefield holds on the honest run", async () => {
    for (const t of [request, drawer, thread, words, summary, failedRead, partial, section, runInActivity, audit, usage]) {
      for (const g of t.graders.filter((x) => x.kind === "minefield")) expect([t.id, g.name, await g.check(honest[t.id] as P5World)]).toEqual([t.id, g.name, false]);
    }
  });

  it("T-P5-01: a row per turn or per resume, a title from the model, an ungated turn left out, a chat dropped and a live rewrite each fire", async () => {
    const dup = (chat: string) => tasksAs((t) => [...t, { ...(t.find((x) => x.chat === chat) as TaskView), id: "second-row" }]);
    expect(await fires(request, "row_per_turn", dup("c1"))).toBe(true);
    expect(await fires(request, "row_per_resume", dup("c2"))).toBe(true);
    expect(await fires(request, "title_from_model", tasksAs((t) => t.map((x, i) => (i === 2 ? { ...x, title: "I wrote the page's title" } : x))))).toBe(true);
    expect(await fires(request, "gated_only", tasksAs((t) => t.filter((x) => x.chat === "c2")))).toBe(true);
    expect(await fires(request, "silent_unread", tasksAs((t) => t.filter((x) => x.chat === "c1")))).toBe(true);
    expect(await fires(request, "live_rewrite", (b) => tasksAs((t) => t.map((x) => ({ ...x, summary: b.replies("c1")[0] ?? "" })))(b))).toBe(true);
  });

  it("T-P5-02: a step titled by prose, a clipped phone detail, markup drawn and a refusal drawn empty each fire", async () => {
    expect(await fires(drawer, "model_prose_step", (b) => stepsAs((s) => s.map((x, i) => (i === 1 ? { ...x, title: b.replies()[0] ?? "" } : x)))(b))).toBe(true);
    const phone = (f: (d: NonNullable<Awaited<ReturnType<P5World["drawer"]>>>) => object) => (b: P5World) => ({ drawer: async (c: "c1" | "c2", id: string, p?: boolean) => {
      const d = await b.drawer(c, id, p);
      return d && p ? ({ ...d, ...f(d) } as typeof d) : d;
    } });
    expect(await fires(drawer, "summary_clipped", phone(() => ({ stacked: false })))).toBe(true);
    expect(await fires(drawer, "markup_executed", (b) => ({ drawer: async (c: "c1" | "c2", id: string, p?: boolean) => {
      const d = await b.drawer(c, id, p);
      return d && { ...d, details: Object.fromEntries(Object.entries(d.details).map(([k, v]) => [k, { ...v, plain: false }])) };
    } }))).toBe(true);
    expect(await fires(drawer, "empty_on_error", detailAs((d) => (d.ok ? d : { ok: true, steps: [], subagents: [], usage: null })))).toBe(true);
  });

  it("T-P5-02: Pat's read of Sam's task is refused on the production path, never drawn empty", async () => {
    const w = honest["T-P5-02"] as P5Tier1World;
    const id = (await w.activity()).tasks[0]!.id;
    expect(await w.task("c1", id, "pat")).toMatchObject({ ok: false, code: "CHAT_NOT_OWNER" });
  });

  it("T-P5-03: narrated calls, no Stop, a silent running turn and a stop left running each fire", async () => {
    expect(await fires(thread, "narrated_calls", (b) => ({ thread: (c?: "c1" | "c2") => [...b.thread(c), { kind: "note", text: "Read the page `https://example.com/p5-probe`" }] }))).toBe(true);
    expect(await fires(thread, "no_stop", (b) => ({ during: { ...(b.during as NonNullable<P5World["during"]>), stop: false } }))).toBe(true);
    expect(await fires(thread, "silent_minutes", (b) => ({ during: { ...(b.during as NonNullable<P5World["during"]>), stop: false, status: "waiting" } }))).toBe(true);
    expect(await fires(thread, "stop_not_settled", tasksAs((t) => t.map((x, i) => (i === 0 ? { ...x, status: "running" } : x))))).toBe(true);
  });

  it("T-P5-04: a fabricated summary, the prior turn's title, a second model pass and a rewritten title each fire", async () => {
    expect(await fires(words, "fabricated_summary", tasksAs((t) => t.map((x) => (x.chat === "c1" ? { ...x, summary: "Read 1 page with two links" } : x))))).toBe(true);
    expect(await fires(words, "prior_turn_title", tasksAs((t) => t.map((x, i) => (i === 1 ? { ...x, title: ASK } : x))))).toBe(true);
    expect(await fires(words, "title_rewrite", tasksAs((t) => t.map((x) => (x.chat === "c1" ? { ...x, title: "What day is the offsite?" } : x))))).toBe(true);
    expect(await fires(words, "summary_by_model", (b) => ({ prompts: () => [...b.prompts(), "Summarise what the task did."] }))).toBe(true);
  });

  it("T-P5-05: a paraphrased reply, a count from the claim and a summary while running each fire", async () => {
    expect(await fires(summary, "paraphrased_reply", summaryText((s) => ({ ...s, detail: { ...s.detail, blocks: [{ label: s.detail.blocks[0]?.label ?? "", text: "It read the pages." }] } })))).toBe(true);
    expect(await fires(summary, "count_from_claim", summaryText((s) => ({ ...s, detail: { ...s.detail, prose: "Read 2; wrote 1 (p5-probe.md)" } })))).toBe(true);
    expect(await fires(summary, "summary_on_running", (b) => ({ during: { ...(b.during as NonNullable<P5World["during"]>), summaryStep: true } }))).toBe(true);
  });

  it("T-P5-06: an invented page, the host as a title, a raw code, an empty success and an unmarked cache each fire", async () => {
    const said = (text: string) => () => ({ replies: () => [text] });
    expect(await fires(failedRead, "invented_page", said("The page says The p5 probe page."))).toBe(true);
    expect(await fires(failedRead, "hostname_as_title", said("It is titled example.invalid."))).toBe(true);
    expect(await fires(failedRead, "empty_success", (b) => ({ results: () => b.results().map((r) => ({ ...r, isError: false, text: "" })) }))).toBe(true);
    expect(await fires(failedRead, "cached_unmarked", () => ({ pagesRead: () => [] }))).toBe(true);
    // A reply carrying the raw code, on the production path.
    const raw = await run(failedRead, { script: [...runs["T-P5-06"]!().script.slice(0, 2), { text: "BROWSE_UNREACHABLE: nothing came back." }] });
    expect(await grader(failedRead, "raw_code")(raw)).toBe(true);
  });

  it("T-P5-06: the instruction lines taken out of the prompt fail the required fact", async () => {
    const w = honest["T-P5-06"] as P5Tier1World;
    const g = grader(failedRead, "the reply is the model's under an instruction line");
    expect(await g(w)).toBe(true);
    expect(await g(faulted(w, (b) => ({ prompts: () => b.prompts().map((p) => p.replace(instructions.WORK_WORDS, "")) })))).toBe(false);
  });

  describe("T-P5-07", () => {
    const words0 = [...ACTIVITY_TEXT.failedSteps];
    afterAll(() => void Reflect.set(ACTIVITY_TEXT, "failedSteps", words0));

    it("a task said Complete with failed steps fires through the real row and pill when the table loses the count", async () => {
      Reflect.set(ACTIVITY_TEXT, "failedSteps", ["{status}", "{status}"]);
      // The words are said when the row is read, so the table stays planted while the grader reads it.
      expect(await grader(partial, "complete_without_mark")(await run(partial))).toBe(true);
    });

    it("a whole task failed, two words for one state and a wrong count each fire", async () => {
      expect(await fires(partial, "whole_task_failed", tasksAs((t) => t.map((x) => (x.failed ? { ...x, status: "failed", code: "BROWSE_UNREACHABLE" } : x))))).toBe(true);
      expect(await fires(partial, "two_words_one_state", (b) => ({ drawer: async (c: "c1" | "c2", id: string, p?: boolean) => {
        const d = await b.drawer(c, id, p);
        return d && { ...d, details: Object.fromEntries(Object.entries(d.details).map(([k, v]) => [k, { ...v, text: `${v.text}\nCompleted` }])) };
      } }))).toBe(true);
      expect(await fires(partial, "count_wrong", tasksAs((t) => t.map((x) => (x.failed ? { ...x, failed: 2 } : x))))).toBe(true);
    });
  });

  it("T-P5-08: done before the result, the child as prose, no section, a child left running, a refusal drawn empty and a reply that disagrees each fire", async () => {
    const rowsAs = (steps: StepView[] | { code: string }) => detailAs((d) => ({ ...d, subagents: d.subagents.map((s) => ({ ...s, rows: s.rows.map((r) => ({ ...r, steps })) })) }));
    expect(await fires(section, "child_steps_as_prose", rowsAs({ code: "SUBAGENT_STEPS_UNAVAILABLE" }))).toBe(true);
    expect(await fires(section, "hidden_child", detailAs((d) => ({ ...d, subagents: [] })))).toBe(true);
    expect(await fires(section, "child_runs_on", (b) => ({ subagents: (c?: "c1" | "c2") => b.subagents(c).map((s) => ({ ...s, status: "running" })) }))).toBe(true);
    expect(await fires(section, "empty_on_refusal", rowsAs([]))).toBe(true);
    expect(await fires(section, "reply_disagrees", (b) => ({ replies: (c?: "c1" | "c2") => [...b.replies(c), "The sub-agent counted 3 sentences."] }))).toBe(true);
    // An acknowledgement that says done, on the production path.
    const done = await run(section, { script: routed([load("subagents"), delegate([BRIEF]), { text: "Done — a sub-agent is on it." }, { text: COUNTED }, load("subagents"), delegate([BRIEF], "d2"), held({ text: ACK }), { text: "" }], { spare: 8 }) });
    expect(await grader(section, "done_before_result")(done)).toBe(true);
  });

  it("T-P5-09: a run said reported with no delivery, a run with no row, a silent run that posts and two words each fire", async () => {
    expect(await fires(runInActivity, "succeeded_undelivered", (b) => ({ activity: async () => ({ ...(await b.activity()), runs: (await b.activity()).runs.map((r) => (r.title === LOST ? { ...r, word: "runReported" } : r)) }) }))).toBe(true);
    expect(await fires(runInActivity, "run_invisible", (b) => ({ rows: async () => (await b.rows()).filter((r) => r.title !== LOST) }))).toBe(true);
    expect(await fires(runInActivity, "silent_message", (b) => ({ notices: (c?: "c1" | "c2") => [...b.notices(c), "Nothing changed on the p5 probe page."] }))).toBe(true);
    expect(await fires(runInActivity, "two_words", (b) => ({ runHistory: async (t: string) => (t === LOST ? [" reported · scheduled"] : b.runHistory(t)) }))).toBe(true);
  });

  it("T-P5-10: a write with no step, an audit from recollection, a hidden store and content in the journal each fire", async () => {
    expect(await fires(audit, "undercount", stepsAs((s) => s.filter((x) => x.tool !== "memory_write")))).toBe(true);
    expect(await fires(audit, "from_recollection", (b) => ({ subagents: (c?: "c1" | "c2") => b.subagents(c).slice(0, 1) }))).toBe(true);
    expect(await fires(audit, "hidden_store", (b) => ({ tables: () => ({ ...b.tables(), "c1/self_improvement": 3 }) }))).toBe(true);
    expect(await fires(audit, "content_in_journal", (b) => ({ journal: async () => (await b.journal()).concat({ kind: "mail.send", outcome: "DONE", fields: ["kind", "text"] }) }))).toBe(true);
  });

  it("T-P5-11: a figure with no number, a row with no model, tokens with no money, a task with no usage and a cost under a message each fire", async () => {
    expect(await fires(usage, "percentage_only", (b) => ({ dayUsage: async () => ({ ...(await b.dayUsage()), tokens: Number.NaN }) }))).toBe(true);
    expect(await fires(usage, "no_model", (b) => ({ ledgerRows: async () => (await b.ledgerRows()).map((r, i) => (i ? r : { ...r, model: "" })) }))).toBe(true);
    expect(await fires(usage, "cost_hidden", (b) => ({ dayUsage: async () => ({ ...(await b.dayUsage()), costMicros: 0 }) }))).toBe(true);
    expect(await fires(usage, "task_without_usage", detailAs((d) => ({ ...d, usage: null })))).toBe(true);
    expect(await fires(usage, "cost_per_message", (b) => ({ thread: (c?: "c1" | "c2") => [...b.thread(c), { kind: "note", text: "3 model calls · $0.01" }] }))).toBe(true);
  });
});
