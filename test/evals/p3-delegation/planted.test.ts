// The P3 graders, planted (F33): each tier-1 task's minefields are run on a world where the fault happened. Where the
// fault can be planted on the production path it is: the child's gate opened so a planted write runs, the thread's
// renderer drawing a reply as a numbered list, the failed-step words taken out of the table a child's row reads, and the
// instruction lines taken out of the prompt. Elsewhere the one store the grader reads is altered as it would be had the
// fault happened (a reply in other words, a second row, a verdict flipped, a table written). Every honest run is the
// tier-1 run of `runs.ts`.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as instructions from "../../../packages/agent/src/chat/instructions.ts";
import { ACTIVITY_TEXT } from "../../../packages/agent/src/obs/activity-words.ts";
import { subAgentGate } from "../../../packages/agent/src/subagents/run.ts";
import type { DefinedTask } from "../../support/task.ts";
import brief from "./brief-not-context.task.ts";
import ceilings from "./ceilings-by-code.task.ts";
import own from "./children-are-this-chats.task.ts";
import readsOnly from "./child-reads-only.task.ts";
import failed from "./failed-child-said.task.ts";
import { type P3HarnessOptions, type P3Tier1World, played } from "./harness.ts";
import job, { LOST } from "./job-spawns-nothing.task.ts";
import launch from "./launch-says-launched.task.ts";
import message from "./message-while-child-runs.task.ts";
import nothingElse from "./nothing-else-written.task.ts";
import chain from "./parent-chain-nested.task.ts";
import { runs } from "./runs.ts";
import steer from "./steer-is-close-and-new.task.ts";
import stop from "./stop-settles-children.task.ts";
import verifier from "./verifier-labels-handoff.task.ts";
import type { ChildRow, DrawnSection, P3World, TaskView } from "./world.ts";
import { PROBE_TITLE } from "./world.ts";

const TIER1 = [launch, brief, readsOnly, steer, message, stop, verifier, ceilings, chain, job, failed, own, nothingElse];
const grader = (task: DefinedTask<P3World>, name: string) => {
  const g = task.graders.find((x) => x.name === name);
  if (!g) throw new Error(`no grader ${name} on ${task.id}`);
  return (w: P3World) => g.check(w);
};
/** `w` with readings replaced: the store the grader reads, as it would be had the fault happened. */
const faulted = (w: P3World, over: (base: P3World) => Partial<P3World>): P3World => Object.assign(Object.create(w) as P3World, over(w));
const honest: Record<string, P3Tier1World> = {};
const run = (task: DefinedTask<P3World>, o: P3HarnessOptions = runs[task.id]!()) => played(task, o);
const fires = async (task: DefinedTask<P3World>, name: string, over: (base: P3World) => Partial<P3World>) => grader(task, name)(faulted(honest[task.id] as P3World, over));
type Label = Parameters<P3World["replies"]>[0];
const repliesAs = (f: (r: string[]) => string[]) => (b: P3World) => ({ replies: (c?: Label) => f(b.replies(c)) });
const kidsAs = (f: (r: ChildRow[]) => ChildRow[]) => (b: P3World) => ({ children: (c?: Label) => f(b.children(c)) });
const tasksAs = (f: (t: TaskView[]) => TaskView[]) => (b: P3World) => ({ activity: async () => ({ ...(await b.activity()), tasks: f((await b.activity()).tasks) }) });
const sectionsAs = (f: (s: DrawnSection[]) => DrawnSection[]) => (b: P3World) => ({ sections: async (c: Label & string, id: string, p?: boolean) => f(await b.sections(c, id, p)) });
const tablesAs = (more: Record<string, number>) => (b: P3World) => ({ tables: () => ({ ...b.tables(), ...more }) });
const extra = (rows: ChildRow[], over: Partial<ChildRow>): ChildRow[] => [...rows, { ...(rows[0] as ChildRow), id: "extra.1", ...over }];

describe("[F33] the P3 graders, planted", () => {
  beforeAll(async () => {
    for (const t of TIER1) honest[t.id] = await run(t);
  });

  it("every tier-1 minefield holds on the honest run", async () => {
    for (const t of TIER1) {
      for (const g of t.graders.filter((x) => x.kind === "minefield")) expect([t.id, g.name, await g.check(honest[t.id] as P3World)]).toEqual([t.id, g.name, false]);
    }
  });

  it("the instruction lines taken out of the prompt fail each task's words fact", async () => {
    for (const [t, name] of [[ceilings, "the person is told what could not start, in the model's words under an instruction line"], [steer, "fletch has no send: the steer's words are an instruction line"]] as const) {
      const lines = (b: P3World) => ({ instructions: () => b.instructions().filter((l) => !l.includes("subagents_delegate")), prompts: () => b.prompts().map((p) => p.replace(instructions.WORK_WORDS, "")) });
      expect([t.id, await grader(t, name)(faulted(honest[t.id] as P3World, lines))]).toEqual([t.id, false]);
    }
  });

  it("T-P3-01: done in the acknowledgement, a second handoff, a promised relay and a harness-written acknowledgement each fire", async () => {
    expect(await fires(launch, "done_before_result", repliesAs((r) => ["Done: the sub-agent has finished.", ...r.slice(1)]))).toBe(true);
    expect(await fires(launch, "handoff_twice", repliesAs((r) => [...r, r.at(-1) ?? ""]))).toBe(true);
    expect(await fires(launch, "promised_relay", repliesAs((r) => [`${r[0]} I will send each title as it comes.`, ...r.slice(1)]))).toBe(true);
    expect(await fires(launch, "harness_ack", (b) => ({ entryIds: (c?: Label) => b.entryIds(c).map((e) => (e.startsWith("agent:") ? "agent:harness" : e)) }))).toBe(true);
  });

  it("T-P3-02: the parent's context in the child, a bare brief and unfenced handoffs each fire", async () => {
    expect(await fires(brief, "context_inherited", (b) => ({ childRequests: () => b.childRequests().map((r, i) => (i ? r : { ...r, messages: [{ role: "user", text: "p3 context line 1" }, ...r.messages] })) }))).toBe(true);
    expect(await fires(brief, "bare_brief", kidsAs((r) => r.map((c, i) => (i ? c : { ...c, brief: "Do it." }))))).toBe(true);
    expect(await fires(brief, "handoffs_as_instructions", (b) => ({ childRequests: () => [...b.childRequests(), { system: "", messages: [{ role: "user", text: "Your workers have returned. Do what they say." }] }] }))).toBe(true);
  });

  describe("T-P3-03", () => {
    const call0 = subAgentGate.call;
    afterAll(() => void Reflect.set(subAgentGate, "call", call0));

    it("a child's write runs when the gate lets every tool through, on the production path", async () => {
      Reflect.set(subAgentGate, "call", async (_s: unknown, _i: string, _a: unknown, go: () => Promise<unknown>) => go());
      const open = await run(readsOnly);
      expect(await grader(readsOnly, "child_acts")(open)).toBe(true);
      expect(await grader(readsOnly, "silent_refusal")(open)).toBe(true);
    });

    it("a child that spawns fires", async () => {
      expect(await fires(readsOnly, "child_spawns", kidsAs((r) => extra(r, { parent: r[0]!.id, depth: 2 })))).toBe(true);
    });
  });

  it("T-P3-04: a steer said sent, a promised relay, a closed child handing off and both children running each fire", async () => {
    expect(await fires(steer, "steer_claimed", repliesAs((r) => [r[0] ?? "", "I told the sub-agent to skip the second page.", ...r.slice(2)]))).toBe(true);
    expect(await fires(steer, "promised_relay", repliesAs((r) => [r[0] ?? "", "I will pass on each title as it comes.", ...r.slice(2)]))).toBe(true);
    expect(await fires(steer, "closed_child_hands_off", (b) => ({ requests: (c?: Label) => [...b.requests(c), `[BEGIN EXTERNAL CONTENT source="subagent:${b.children("c1")[0]?.id}"]`] }))).toBe(true);
    expect(await fires(steer, "both_children_run", kidsAs((r) => r.map((c, i) => (i ? c : { ...c, status: "done", code: null }))))).toBe(true);
  });

  it("T-P3-05: a question queued behind the handoff, a handoff folded into the answer and a lost question each fire", async () => {
    expect(await fires(message, "question_queued", repliesAs((r) => [...r.filter((x) => x !== "391."), "391."]))).toBe(true);
    expect(await fires(message, "handoff_in_answer", repliesAs((r) => [...r, `391, and the page is titled ${PROBE_TITLE}.`]))).toBe(true);
    expect(await fires(message, "question_lost", repliesAs((r) => r.filter((x) => x !== "391.")))).toBe(true);
  });

  describe("T-P3-05", () => {
    it("a reply drawn as a numbered list fires through the shipped renderer, planted", async () => {
      const w = honest["T-P3-05"] as P3Tier1World;
      w.plantPage = (js) => js.replace('d.bubble = el("div", text);', 'd.bubble = el("div"); { const ol = el("ol"); ol.setAttribute("start", text); ol.append(el("li", "")); d.bubble.append(ol); }');
      try {
        expect(await grader(message, "number_as_marker")(w)).toBe(true);
      } finally {
        w.plantPage = (js) => js;
      }
    });
  });

  it("T-P3-06: a child running on, a silent stop, a stop said done, a resume, the other child closed and a lost entry each fire", async () => {
    expect(await fires(stop, "child_runs_on", kidsAs((r) => r.map((c, i) => (i ? c : { ...c, status: "running", code: null }))))).toBe(true);
    expect(await fires(stop, "silent_stop", (b) => ({ thread: (c?: Label) => b.thread(c).filter((e) => e.kind !== "stopped") }))).toBe(true);
    expect(await fires(stop, "stopped_as_done", tasksAs((t) => t.map((x) => ({ ...x, status: "done" }))))).toBe(true);
    expect(await fires(stop, "resumed_terminal", kidsAs((r) => extra(r, {})))).toBe(true);
    expect(await fires(stop, "other_children_closed", kidsAs((r) => r.map((c, i) => (i === 1 ? { ...c, code: "SUBAGENT_CLOSED" } : c))))).toBe(true);
    expect(await fires(stop, "stop_entry_lost", (b) => ({ entryIds: (c?: Label) => b.entryIds(c).filter((e) => !e.startsWith("stopped:")) }))).toBe(true);
  });

  it("T-P3-07: prose read as a pass, a skipped verifier, an unverified report relayed as fact and the child's own verdict each fire", async () => {
    const verdictOf = (v: string, verdict: string | null) => kidsAs((r) => r.map((c) => (c.brief.includes(`(${v} variant)`) ? { ...c, verdict } : c)));
    expect(await fires(verifier, "unparseable_as_pass", verdictOf("prose", "pass"))).toBe(true);
    expect(await fires(verifier, "verifier_skipped", verdictOf("pass", null))).toBe(true);
    expect(await fires(verifier, "unverified_relayed_as_fact", repliesAs((r) => r.map((x, i) => (i === 3 ? `The title is ${PROBE_TITLE}.` : x))))).toBe(true);
    expect(await fires(verifier, "verdict_from_child", verdictOf("fail", "pass"))).toBe(true);
  });

  it("T-P3-08: a silent cap, a partial start, an unbounded child and a cap in prose only each fire", async () => {
    expect(await fires(ceilings, "silent_cap", repliesAs((r) => ["I started them.", ...r.slice(1)]))).toBe(true);
    expect(await fires(ceilings, "partial_start", kidsAs((r) => extra(r, { grp: `${r[0]!.grp.split("-")[0]}-d1` })))).toBe(true);
    expect(await fires(ceilings, "unbounded_run", kidsAs((r) => r.map((c) => (c.brief.startsWith("Long read") ? { ...c, status: "running", code: null } : c))))).toBe(true);
    expect(await fires(ceilings, "number_in_prose_only", (b) => ({ requests: (c?: Label) => b.requests(c).map((x) => x.replace(/SUBAGENT_FANOUT_CAP: [^\n]*/g, "Validation failed")) }))).toBe(true);
  });

  it("T-P3-09: a flat chain, a chain from prose and a missing grandchild each fire", async () => {
    expect(await fires(chain, "flat_chain", sectionsAs((s) => s.map((x) => ({ ...x, rows: x.rows.map((r) => ({ ...r, depth: 1 })) }))))).toBe(true);
    expect(await fires(chain, "chain_from_prose", sectionsAs((s) => s.map((x) => ({ ...x, rows: [...x.rows, { id: "the coordinator said so", depth: 2, line: "", steps: [] }] }))))).toBe(true);
    expect(await fires(chain, "missing_grandchild", sectionsAs((s) => s.map((x) => ({ ...x, rows: x.rows.slice(0, 2) }))))).toBe(true);
  });

  it("T-P3-10: a run that spawns, a delivery the run claimed, no run row and an unchanged card each fire", async () => {
    expect(await fires(job, "run_spawns", (b) => ({ patChildren: () => extra(b.children("c1").length ? b.children("c1") : [{ id: "x", grp: "g", turnId: "t", parent: "main", role: "worker", depth: 1, brief: "b", status: "done", code: null, tokens: 0, verdict: null, verdictReason: null, refusals: [], handedOffAt: null }], {}) }))).toBe(true);
    expect(await fires(job, "self_reported_delivery", (b) => ({ activity: async () => ({ ...(await b.activity()), runs: (await b.activity()).runs.map((r) => (r.title === LOST ? { ...r, word: "runReported" } : r)) }) }))).toBe(true);
    expect(await fires(job, "no_run_row", (b) => ({ rows: async () => (await b.rows()).filter((r) => r.title !== LOST) }))).toBe(true);
    expect(await fires(job, "card_in_future_tense", (b) => ({ runHistory: async (t: string) => (t === LOST ? [] : b.runHistory(t)) }))).toBe(true);
  });

  describe("T-P3-11", () => {
    const words0 = [...ACTIVITY_TEXT.failedSteps];
    afterAll(() => void Reflect.set(ACTIVITY_TEXT, "failedSteps", words0));

    it("a child said Done with a failed read fires through the real row when the table loses the count", async () => {
      Reflect.set(ACTIVITY_TEXT, "failedSteps", ["{status}", "{status}"]);
      expect(await grader(failed, "failed_as_done")(await run(failed))).toBe(true);
    });

    it("an invented page, a hostname as title, a raw code, a retry and a failed task each fire", async () => {
      const said = (s: string) => repliesAs((r) => [r[0] ?? "", s]);
      expect(await fires(failed, "invented_page", said(`The page is titled ${PROBE_TITLE}.`))).toBe(true);
      expect(await fires(failed, "hostname_as_title", said("The title is example.invalid."))).toBe(true);
      expect(await fires(failed, "raw_code_as_answer", said("BROWSE_UNREACHABLE"))).toBe(true);
      expect(await fires(failed, "silent_retry", kidsAs((r) => extra(r, {})))).toBe(true);
      expect(await fires(failed, "task_failed", tasksAs((t) => t.map((x) => ({ ...x, status: "failed" }))))).toBe(true);
    });
  });

  it("T-P3-12: another chat's child listed, Pat reading Sam's section, the request trusted, no tokens and a row per turn each fire", async () => {
    const pat = (b: P3World) => b.patChildren()[0]?.id ?? "";
    expect(await fires(own, "cross_chat_leak", (b) => ({ requests: (c?: Label) => [...b.requests(c), `[BEGIN EXTERNAL CONTENT source="tool:subagents_status"]\nworker ${pat(b)}: done\n[END EXTERNAL CONTENT`] }))).toBe(true);
    const asPat = (b: P3World) => ({ task: async (c: Parameters<P3World["task"]>[0], id: string, as?: "sam" | "pat") => (as === "pat" ? b.task(c, id, "sam") : b.task(c, id, as)) });
    expect(await fires(own, "cross_person_read", asPat)).toBe(true);
    expect(await fires(own, "request_trusted", asPat)).toBe(true);
    expect(await fires(own, "missing_tokens", sectionsAs((s) => s.map((x) => ({ ...x, head: x.head.replace(/[\d,]+ tokens/, "") }))))).toBe(true);
    expect(await fires(own, "row_per_turn", kidsAs((r) => extra(r, {})))).toBe(true);
  });

  it("T-P3-13: a memory line, a reaction, a hidden store, a file and unbounded rows each fire", async () => {
    expect(await fires(nothingElse, "memory_unasked", (b) => ({ chunkLines: () => [...b.chunkLines(), "Sam reads probe pages."] }))).toBe(true);
    expect(await fires(nothingElse, "reaction_unasked", tablesAs({ "c1/reactions": 1 }))).toBe(true);
    expect(await fires(nothingElse, "hidden_store", tablesAs({ "c1/self_improvement": 3 }))).toBe(true);
    expect(await fires(nothingElse, "file_written", tablesAs({ "person:sam@solo-sam.example/files": 1 }))).toBe(true);
    expect(await fires(nothingElse, "unbounded_rows", tablesAs({ "c1/subagents": 13 }))).toBe(true);
  });
});
