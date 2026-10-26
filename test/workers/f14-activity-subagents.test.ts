// F14: sub-agent nesting. A delegation is a launch step in the parent's timeline and a `SUBAGENT 01` section of the
// task's answer, built from the parent chat's own `subagents` rows in the sub-agent world (the real engine, host, store,
// facets' `runSubAgent` and verifier); Sam owns the chat and Pat, the second member of solo-sam, is refused. The
// model is the scripted fake. D-0011 (the facet's transcript read) is proposed, not accepted, so no facet is read:
// every row's steps answer SUBAGENT_STEPS_UNAVAILABLE. The two tests under "the child's own steps" state the part's
// transcript claims and fail until Kyle accepts D-0011 (docs/plan/QUESTIONS.md, Q8): the part is BLOCKED, not done.
import { describe, expect, it } from "vitest";
import { chatTask, type TaskResult } from "../../packages/agent/src/chat/activity.ts";
import type { StepRecord } from "../../packages/agent/src/chat/activity-steps.ts";
import { SUBAGENT_STEPS_UNAVAILABLE, type SubAgentRows, VERIFIER_CONTRACT } from "../../packages/agent/src/chat/activity-subagents.ts";
import { groupIdOf } from "../../packages/agent/src/chat/outbox.ts";
import { renderHandoff, type SubAgentTransport } from "../../packages/agent/src/subagents/host.ts";
import people from "../fixtures/people.json" with { type: "json" };
import { ada, type SubAgentWorld, subagentWorld, verdict } from "./support/subagent-world.ts";

const pat = people.people.find((p) => p.id === "pat-solo") as (typeof people.people)[number];
const load = { toolCall: { id: "l1", name: "tool_search", arguments: { load: ["subagents"] } } };
const delegate = (tasks: Array<{ role: string; brief: string }>, id = "d1") => ({ toolCall: { id, name: "subagents_delegate", arguments: { tasks } } });
const BRIEF = "Read Sam's notes for the launch date.";
/** One worker: it reads the notes and answers; the verifier passes it; the main agent reports. */
const ONE_WORKER = [
  load,
  delegate([{ role: "worker", brief: BRIEF }]),
  { text: "A worker is on it." },
  { toolCall: { id: "w1", name: "notes_read", arguments: {} } },
  { text: "The launch is Thursday." },
  verdict("pass", "names the launch date from the notes"),
  { text: "Your worker found the launch is Thursday." },
];
/** The facet runs its reads for real, then the run ends failed with a code: a child that failed partway. */
const failing = (real: SubAgentTransport): SubAgentTransport => ({
  run: async (i) => {
    await real.run(i);
    return { status: "failed", code: "SUBAGENT_MODEL_FAILED", detail: "the model stopped", tokens: 0 };
  },
});
type Ok = Extract<TaskResult, { ok: true }>;

async function read(w: SubAgentWorld, as = ada.email, store: SubAgentRows = w.chat.instance.store): Promise<TaskResult> {
  const id = w.chat.instance.engine.tasksFor(ada.email)?.[0]?.id as string;
  return chatTask(w.chat.instance.engine, as, id, store);
}
async function task(w: SubAgentWorld): Promise<Ok> {
  const r = await read(w);
  expect(r.ok).toBe(true);
  return r as Ok;
}
const launchOf = (t: Ok) => t.steps.find((s) => s.kind === "launch") as StepRecord;

describe("[F14] sub-agent sections from the parent's rows", () => {
  it("after a delegation the task's first section is 01 and its launch step names the role, the brief, the spawn status and that results are not back", async () => {
    const w = subagentWorld({ script: ONE_WORKER });
    await w.say("When is the launch? Delegate it.");
    const t = await task(w);
    const launch = launchOf(t);
    const grp = groupIdOf(launch.turnId, launch.callId);
    expect(t.subagents).toHaveLength(1);
    expect(t.subagents[0]).toMatchObject({ n: "01", grp, launchStep: launch.n });
    expect(t.subagents[0]?.rows).toEqual([
      { id: `${grp}.1`, role: "worker", depth: 1, parent: "main", brief: BRIEF, status: "queued", code: null, verdict: null, verdictReason: null, steps: { ok: false, code: SUBAGENT_STEPS_UNAVAILABLE } },
    ]);
    expect(launch.detail.prose).toBe(`Started 1 sub-agent on parts of this task. Sub-agent 1 is a worker with the brief "${BRIEF}". It is queued, and its results are not back yet. ${VERIFIER_CONTRACT}`);
    // The briefs stay blocks as F13 drew them; no verdict step before the handoff.
    expect(launch.detail.blocks.map((b) => [b.label, b.text])).toEqual([["Brief 1 (worker)", BRIEF]]);
    expect(t.steps.some((s) => s.kind === "verdict")).toBe(false);
    // The read reached no facet: nothing ran.
    expect(w.runs).toHaveLength(0);
  });

  it("after the handoff the parent timeline holds the verdict step with the stored verdict and reason, and the chat's handoff carries the same", async () => {
    const w = subagentWorld({ script: ONE_WORKER });
    await w.say("When is the launch? Delegate it.");
    w.clock.now += 60_000;
    await w.settle();
    const row = w.rows()[0];
    expect(row).toMatchObject({ status: "done", verdict: "pass", verdictReason: "names the launch date from the notes" });
    const t = await task(w);
    const launch = launchOf(t);
    const v = t.steps.find((s) => s.kind === "verdict") as StepRecord;
    expect(v).toMatchObject({ title: "Sub-agent 01 returned: pass", state: "done", code: null, turnId: launch.turnId, callId: "" });
    expect(v.detail.prose).toBe(row?.verdictReason);
    expect(v.startedAt).toBe(w.chat.instance.store.handedOffAt(t.subagents[0]?.grp as string));
    // In timeline order: after the launch step, before the summary; numbered in place.
    expect(t.steps.map((s) => s.kind)).toEqual(["load", "launch", "verdict", "summary"]);
    expect(t.steps.map((s) => s.n)).toEqual([1, 2, 3, 4]);
    expect(t.subagents[0]).toMatchObject({ launchStep: 2, rows: [{ status: "done", verdict: "pass", verdictReason: row?.verdictReason }] });
    expect(launch.detail.prose).toContain("It is done, and its results are back.");
    // Both places, one stored value: the handoff entered the chat with the row's verdict and reason.
    expect(w.transcript().some((b) => b.includes(renderHandoff(row as NonNullable<typeof row>).split("\n")[0] as string))).toBe(true);
    expect(w.transcript().some((b) => b.includes("verifier: pass (names the launch date from the notes)"))).toBe(true);
  });

  it("a child that failed shows its code at the section head and in the verdict step", async () => {
    const w = subagentWorld({
      script: ONE_WORKER.slice(0, 5).concat([{ text: "The worker failed." }]),
      transport: failing,
    });
    await w.say("When is the launch? Delegate it.");
    await w.settle();
    const t = await task(w);
    expect(t.subagents[0]?.rows[0]).toMatchObject({ status: "failed", code: "SUBAGENT_MODEL_FAILED", verdict: null, steps: { ok: false, code: SUBAGENT_STEPS_UNAVAILABLE } });
    expect(t.steps.find((s) => s.kind === "verdict")).toMatchObject({ title: "Sub-agent 01 returned: failed (SUBAGENT_MODEL_FAILED)", state: "failed", code: "SUBAGENT_MODEL_FAILED" });
    expect(launchOf(t).detail.prose).toContain("It is failed (SUBAGENT_MODEL_FAILED), and its results are not back yet.");
  });

  it("a second delegation in the task is 02, in creation order", async () => {
    const w = subagentWorld({ script: [load, delegate([{ role: "worker", brief: "Find the date." }], "d1"), delegate([{ role: "worker", brief: "Find the budget." }], "d2"), { text: "Two delegations started." }] });
    await w.say("Date and budget, separately.");
    const t = await task(w);
    expect(t.subagents.map((s) => [s.n, s.rows.map((r) => r.brief)])).toEqual([
      ["01", ["Find the date."]],
      ["02", ["Find the budget."]],
    ]);
    expect(t.subagents.map((s) => s.launchStep)).toEqual(t.steps.filter((s) => s.kind === "launch").map((s) => s.n));
  });

  it("a coordinator's workers nest under it by depth", async () => {
    const w = subagentWorld({
      script: [
        load,
        delegate([{ role: "coordinator", brief: "Find the launch date and the budget." }]),
        { text: "A coordinator is on it." },
        { toolCall: { id: "c1", name: "subagents_delegate", arguments: { briefs: ["Find the launch date.", "Find the budget."] } } },
        { text: "Waiting on my workers." },
        { text: "Launch Thursday." },
        { text: "Budget 120." },
        { text: "Launch is Thursday and the budget is 120." },
        verdict("pass"),
        { text: "Launch Thursday, budget 120." },
      ],
    });
    await w.say("Launch date and budget, please; split it up.");
    await w.settle();
    const t = await task(w);
    expect(t.subagents).toHaveLength(1);
    const [coord, ...workers] = t.subagents[0]?.rows ?? [];
    expect([coord?.role, coord?.depth, coord?.parent]).toEqual(["coordinator", 1, "main"]);
    expect(workers.map((r) => [r.role, r.depth, r.parent, r.brief])).toEqual([
      ["worker", 2, coord?.id, "Find the launch date."],
      ["worker", 2, coord?.id, "Find the budget."],
    ]);
    // The verdict is the coordinator's: the verifier checks only what returns to the main agent.
    expect(t.steps.find((s) => s.kind === "verdict")?.title).toBe("Sub-agent 01 returned: pass");
  });

  it("Pat's read of Sam's task answers CHAT_NOT_OWNER and reads neither the rows nor a facet", async () => {
    const w = subagentWorld({ script: ONE_WORKER });
    await w.say("When is the launch? Delegate it.");
    await w.settle();
    const runs = w.runs.length;
    const touched: string[] = [];
    const real = w.chat.instance.store;
    const spy: SubAgentRows = {
      group: (g) => {
        touched.push(g);
        return real.group(g);
      },
      handedOffAt: (g) => {
        touched.push(g);
        return real.handedOffAt(g);
      },
    };
    expect(await read(w, pat.email, spy)).toEqual({ ok: false, code: "CHAT_NOT_OWNER" });
    expect(touched).toEqual([]);
    expect(w.runs).toHaveLength(runs);
    // Planted: the same spy for the owner is read, so an empty `touched` above is the owner check, not a dead spy.
    expect((await read(w, ada.email, spy)).ok).toBe(true);
    expect(touched.length).toBeGreaterThan(0);
  });

  it("a child's steps are refused by name, never an empty list, while its facet is not read", async () => {
    const w = subagentWorld({ script: ONE_WORKER });
    await w.say("When is the launch? Delegate it.");
    await w.settle();
    const t = await task(w);
    for (const r of t.subagents.flatMap((s) => s.rows)) {
      expect(Array.isArray(r.steps)).toBe(false);
      expect(r.steps).toEqual({ ok: false, code: SUBAGENT_STEPS_UNAVAILABLE });
    }
  });
});

// The transcript half: these state the part's claims on a child's own steps and fail until D-0011 is accepted.
describe("[F14] the child's own steps (waits on D-0011)", () => {
  it("the child's setup steps are its reads in order, then Handed off with its text", async () => {
    const w = subagentWorld({ script: ONE_WORKER });
    await w.say("When is the launch? Delegate it.");
    await w.settle();
    const steps = (await task(w)).subagents[0]?.rows[0]?.steps;
    expect(Array.isArray(steps)).toBe(true);
    expect((steps as StepRecord[]).map((s) => [s.tool, s.title, s.state])).toEqual([
      ["notes_read", "Called notes read", "done"],
      ["", "Handed off", "done"],
    ]);
    expect((steps as StepRecord[]).at(-1)?.detail.prose).toBe("The launch is Thursday.");
  });

  it("a child that failed shows its steps up to the failure", async () => {
    const w = subagentWorld({
      script: ONE_WORKER.slice(0, 5).concat([{ text: "The worker failed." }]),
      transport: failing,
    });
    await w.say("When is the launch? Delegate it.");
    await w.settle();
    const steps = (await task(w)).subagents[0]?.rows[0]?.steps;
    expect(Array.isArray(steps)).toBe(true);
    expect((steps as StepRecord[]).map((s) => s.tool)).toEqual(["notes_read"]);
  });
});
