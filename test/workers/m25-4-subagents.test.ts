// M25.4: closing sub-agents and the no-progress kill rule (SUB-2). A parent closes children it started, and everything
// below them; a child closed while it runs returns nothing; Bo cannot close Ada's. A child that asks for no new tool call
// for SUBAGENT_STALL_STEPS steps in a row is ended with SUBAGENT_NO_PROGRESS, and one that keeps making new calls is not.
import { describe, expect, it } from "vitest";
import { SUBAGENT_CLOSED } from "../../packages/agent/src/subagents/host.ts";
import { SUBAGENT_STALL_STEPS } from "../../packages/agent/src/subagents/run.ts";
import { ada, subagentWorld, type SubAgentWorld, verdict } from "./support/subagent-world.ts";

const load = { toolCall: { id: "l1", name: "tool_search", arguments: { load: ["subagents"] } } };
const delegate = (tasks: Array<{ role: string; brief: string }>, id = "d1") => ({ toolCall: { id, name: "subagents_delegate", arguments: { tasks } } });
const close = (ids: string[], id = "x1") => ({ toolCall: { id, name: "subagents_close", arguments: { ids } } });
const notes = (n: number | string) => ({ toolCall: { id: `n${n}`, name: "notes_read", arguments: { n } } });

describe("[M25.4] subagents_close", () => {
  it("the main agent closes children before they run: each ends SUBAGENT_CLOSED, none runs, and the handoff says so once", async () => {
    const w = subagentWorld({ script: [load, delegate([{ role: "worker", brief: "Read the notes." }, { role: "worker", brief: "Read the budget." }]), { text: "Started two." }] });
    await w.say("Delegate two reads.");
    const ids = w.rows().map((r) => r.id);
    expect(ids).toHaveLength(2);
    w.fake.enqueue(load, close(ids), { text: "Closed both." });
    await w.say("Never mind, stop them.");
    expect(w.rows()).toMatchObject([{ status: "failed", code: SUBAGENT_CLOSED }, { status: "failed", code: SUBAGENT_CLOSED }]);
    expect(w.toolResults().some((t) => t.includes(`closed ${ids.join(", ")}`))).toBe(true);
    w.fake.enqueue({ text: "They were closed before they started." });
    await w.settle();
    expect(w.runs).toHaveLength(0);
    expect(w.transcript().filter((t) => t.includes("SUBAGENT_CLOSED")).length).toBeGreaterThan(0);
    expect(w.chat.instance.store.handedOffAt(w.chat.instance.store.list()[0]?.grp as string)).not.toBeNull();
  });

  it("a child closed while it runs returns nothing: no result, no verifier call, and it stays closed", async () => {
    const ref: { w?: SubAgentWorld } = {};
    const w = subagentWorld({
      transport: (real) => ({
        run: async (input) => {
          const r = await real.run(input);
          expect(await ref.w?.chat.instance.host.close(ada.email, [input.id])).toMatchObject({ ok: true, closed: [input.id] });
          return r;
        },
      }),
      script: [load, delegate([{ role: "worker", brief: "Read the notes." }]), { text: "Started." }, { text: "Notes: launch Thursday." }, { text: "The worker was closed." }],
    });
    ref.w = w;
    await w.say("Delegate a read.");
    await w.settle();
    expect(w.rows()).toMatchObject([{ status: "failed", code: SUBAGENT_CLOSED, result: null, verdict: null }]);
    // Three chat requests, the worker's one, then the main agent's handoff turn: no verifier request in between.
    expect(w.fake.requests).toHaveLength(5);
  });

  it("closing a coordinator closes the workers it started, and they never run", async () => {
    const w = subagentWorld({
      script: [
        load,
        delegate([{ role: "coordinator", brief: "Find the launch date and the budget." }]),
        { text: "Started." },
        // The coordinator asks for two workers and waits.
        { toolCall: { id: "c1", name: "subagents_delegate", arguments: { briefs: ["Find the launch date.", "Find the budget."] } } },
        { text: "Waiting on my workers." },
        { text: "The coordinator was closed." },
      ],
    });
    await w.say("Split it up.");
    await w.alarm();
    const coordinator = w.rows().find((r) => r.role === "coordinator");
    expect(coordinator).toMatchObject({ status: "waiting" });
    expect(w.rows().filter((r) => r.parent === coordinator?.id)).toMatchObject([{ status: "queued" }, { status: "queued" }]);
    expect(await w.chat.instance.host.close(ada.email, [coordinator?.id as string])).toMatchObject({ ok: true, settled: [] });
    expect(w.rows()).toMatchObject([{ status: "failed", code: SUBAGENT_CLOSED }, { status: "failed", code: SUBAGENT_CLOSED }, { status: "failed", code: SUBAGENT_CLOSED }]);
    await w.settle();
    expect(w.runs.map((r) => r.id)).toEqual([coordinator?.id]);
  });

  it("a child that already finished is left as it is, and reported as settled", async () => {
    const w = subagentWorld({ script: [load, delegate([{ role: "worker", brief: "Read the notes." }]), { text: "Started." }, { text: "Notes: Thursday." }, verdict("pass"), { text: "Thursday." }] });
    await w.say("Delegate a read.");
    await w.settle();
    const [row] = w.rows();
    expect(await w.chat.instance.host.close(ada.email, [row?.id as string])).toEqual({ ok: true, closed: [], settled: [row?.id] });
    expect(w.rows()).toMatchObject([{ status: "done", code: null, result: "Notes: Thursday.", verdict: "pass" }]);
  });
});

describe("[M25.4] the no-progress kill rule", () => {
  it(`a child that repeats the same tool call ${SUBAGENT_STALL_STEPS} steps in a row is ended with SUBAGENT_NO_PROGRESS, and the parent is told`, async () => {
    const w = subagentWorld({
      script: [
        load,
        delegate([{ role: "worker", brief: "Read the notes." }]),
        { text: "Started." },
        // One new call, then the same call again and again.
        notes(1), notes(1), notes(1), notes(1),
        { text: "The worker made no progress." },
      ],
    });
    await w.say("Delegate a read.");
    await w.settle();
    expect(w.rows()).toMatchObject([{ status: "failed", code: "SUBAGENT_NO_PROGRESS" }]);
    expect(w.transcript().some((t) => t.includes("SUBAGENT_NO_PROGRESS"))).toBe(true);
    // Three chat requests, four worker steps (the fourth is the third stalled one, so the worker took no fifth), then the
    // main agent's handoff turn; a failed child has no verifier call.
    expect(w.fake.requests).toHaveLength(8);
  });

  it("a child that keeps asking for new calls is not killed (planted twin: the rule fires on repeats only)", async () => {
    const w = subagentWorld({
      script: [load, delegate([{ role: "worker", brief: "Read the notes." }]), { text: "Started." }, notes(1), notes(2), notes(3), notes(4), notes(5), { text: "Read five times; launch is Thursday." }, verdict("pass"), { text: "Launch is Thursday." }],
    });
    await w.say("Delegate a read.");
    await w.settle();
    expect(w.rows()).toMatchObject([{ status: "done", verdict: "pass" }]);
  });
});
