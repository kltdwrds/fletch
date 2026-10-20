// M7.2's sub-agents, hermetic: fan-out as facets of the chat driven by its alarm (the transport the
// staging spike settled, DECISIONS-LOG M7.2), the depth cap decided in code from the parent's
// record, the worker's spawn refused with a reason code at the tool and again at the parent,
// sub-agents bound to observation, the verifier on the cheap route, and recovery that never runs a
// sub-agent twice. Each guard has a test that plants the violation on the production path.
import { describe, expect, it } from "vitest";
import { ownTask } from "../../packages/agent/src/chat/gate.ts";
import { EffectBuffer } from "../../packages/agent/src/chat/tools.ts";
import { MAX_DEPTH, MAX_FANOUT, spawnDecision } from "../../packages/agent/src/subagents/depth.ts";
import { parseVerdict } from "../../packages/agent/src/subagents/verifier.ts";
import { subagentsNamespace } from "../../packages/agent/src/subagents/tools.ts";
import { ada, subagentWorld, verdict } from "./support/subagent-world.ts";

const load = { toolCall: { id: "l1", name: "tool_search", arguments: { load: ["subagents"] } } };
const delegate = (tasks: Array<{ role: string; brief: string }>, id = "d1") => ({ toolCall: { id, name: "subagents_delegate", arguments: { tasks } } });

describe("[M7.2] sub-agents: the depth cap", () => {
  it("a worker attempting to spawn is rejected with a reason code, at its tool and at the parent", async () => {
    const w = subagentWorld({
      script: [
        load,
        delegate([{ role: "worker", brief: "Read Ada's notes for the launch date." }]),
        { text: "Started a worker; I'll report when it returns." },
        // The worker's run: it asks for its own sub-agent, is refused, and reports.
        { toolCall: { id: "w1", name: "subagents_delegate", arguments: { briefs: ["a worker's own helper"] } } },
        { toolCall: { id: "w2", name: "notes_read", arguments: {} } },
        { text: "The launch is Thursday." },
        verdict("pass"),
        { text: "Your worker found the launch is Thursday." },
      ],
    });
    expect((await w.say("When is the launch? Delegate it.")).status).toBe("done");
    await w.settle();
    expect(w.toolResults().some((t) => t.includes("SUBAGENT_WORKER_CANNOT_SPAWN: a worker returns its result to its parent"))).toBe(true);
    // One sub-agent only: the worker's request started nothing.
    expect(w.rows()).toMatchObject([{ role: "worker", depth: 1, status: "done", verdict: "pass", result: "The launch is Thursday." }]);
    expect(w.runs).toHaveLength(1);
  });

  it("the parent refuses a worker's spawn from its own record, whatever the facet returns (planted)", async () => {
    // The facet claims spawns as if it had ignored its own check; the parent decides from the stored row.
    const w = subagentWorld({
      transport: (real) => ({
        run: async (input) => {
          const r = await real.run(input);
          return r.status === "done" ? { ...r, spawns: [{ role: "worker", brief: "smuggled helper" }] } : r;
        },
      }),
      script: [load, delegate([{ role: "worker", brief: "Read the notes." }]), { text: "Started." }, { text: "Notes read: launch Thursday." }, verdict("pass"), { text: "Launch is Thursday." }],
    });
    await w.say("Delegate a notes read.");
    await w.settle();
    expect(w.rows()).toHaveLength(1);
    expect(w.rows()[0]).toMatchObject({ role: "worker", status: "done", refusals: ["SUBAGENT_WORKER_CANNOT_SPAWN"] });
    expect(w.transcript().some((t) => t.includes("refused: SUBAGENT_WORKER_CANNOT_SPAWN"))).toBe(true);
  });

  it("a coordinator fans out to workers at depth 2 and takes their handoffs in its next round", async () => {
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
    const rows = w.rows();
    expect(rows.map((r) => [r.role, r.depth, r.status])).toEqual([
      ["coordinator", 1, "done"],
      ["worker", MAX_DEPTH, "done"],
      ["worker", MAX_DEPTH, "done"],
    ]);
    expect(rows[0]?.result).toBe("Launch is Thursday and the budget is 120.");
    // The coordinator's second round saw both handoffs, fenced with their sub-agent labels.
    const round2 = w.runs.filter((r) => r.role === "coordinator")[1];
    expect(round2?.handoffs).toContain('source="subagent:');
    expect(round2?.handoffs).toContain("Budget 120.");
  });

  it("decides the cap from the parent's record: no coordinator below a coordinator, no fan-out past the cap", () => {
    expect(spawnDecision({ role: "main", depth: 0 }, [{ role: "coordinator", brief: "b" }], 0)).toEqual({ ok: true, depth: 1 });
    expect(spawnDecision({ role: "coordinator", depth: 1 }, [{ role: "worker", brief: "b" }], 0)).toEqual({ ok: true, depth: 2 });
    expect(spawnDecision({ role: "coordinator", depth: 1 }, [{ role: "coordinator", brief: "b" }], 0)).toMatchObject({ ok: false, code: "SUBAGENT_DEPTH_CAP" });
    expect(spawnDecision({ role: "worker", depth: 2 }, [{ role: "worker", brief: "b" }], 0)).toMatchObject({ ok: false, code: "SUBAGENT_WORKER_CANNOT_SPAWN" });
    expect(spawnDecision({ role: "main", depth: 0 }, Array.from({ length: MAX_FANOUT + 1 }, () => ({ role: "worker" as const, brief: "b" })), 0)).toMatchObject({ ok: false, code: "SUBAGENT_FANOUT_CAP" });
    expect(spawnDecision({ role: "main", depth: 0 }, [{ role: "worker", brief: "b" }], 12)).toMatchObject({ ok: false, code: "SUBAGENT_OPEN_CAP" });
  });
});

describe("[M7.2] sub-agents: authority is inherited", () => {
  it("a sub-agent's action and write are refused with a code and nothing runs", async () => {
    const w = subagentWorld({
      script: [
        load,
        delegate([{ role: "worker", brief: "Tell Bo the launch date." }]),
        { text: "Started." },
        { toolCall: { id: "m1", name: "mail_send", arguments: { to: ada.email } } },
        { toolCall: { id: "m2", name: "drafts_save", arguments: { text: "launch Thursday" } } },
        { text: "I could not send or save; the launch is Thursday." },
        verdict("pass"),
        { text: "The worker could not send; the launch is Thursday." },
      ],
    });
    await w.say("Delegate telling Bo the launch date.");
    await w.settle();
    expect(w.performed).toEqual([]);
    expect(new Set(w.toolResults().filter((t) => t.includes("SUBAGENT_ACTION_REFUSED"))).size).toBe(2);
  });

  it("only the person's own, unlatched task delegates", async () => {
    const view = { open: () => 0, status: () => [], close: async () => ({ ok: true as const, closed: [], settled: [] }) };
    const run = async (context: Parameters<typeof subagentsNamespace>[1]["context"], latched: boolean) => {
      const effects = new EffectBuffer();
      const spec = subagentsNamespace(view, { effects, context, latched: () => latched, person: ada.email }).tools[0];
      const out = await spec?.execute("x1", { tasks: [{ role: "worker", brief: "b" }] } as never);
      return { text: out?.content.map((c) => ("text" in c ? c.text : "")).join(""), queued: effects.size };
    };
    expect(await run({ counterpart: { kind: "person", id: other.email }, origin: other.email, hops: 0 }, false)).toMatchObject({ queued: 0, text: expect.stringContaining("SUBAGENT_OWN_TASK_ONLY") });
    expect(await run(ownTask(ada.email), true)).toMatchObject({ queued: 0, text: expect.stringContaining("LATCH_NO_FORWARDING") });
    expect(await run(ownTask(ada.email), false)).toMatchObject({ queued: 1 });
  });
});

describe("[M7.2] sub-agents: transport and verifier", () => {
  it("starts nothing before the step's barrier, and a delegation re-released after a crash starts once", async () => {
    const w = subagentWorld({ script: [load, delegate([{ role: "worker", brief: "Read the notes." }]), { text: "Started." }] });
    await w.say("Delegate a notes read.");
    expect(w.rows()).toHaveLength(1);
    expect(w.arms()).toBe(1);
    // The same delegation handed to the host again (a re-flush) adds nothing.
    const again = await w.chat.instance.host.delegate({ grp: w.rows()[0]?.grp as string, turnId: "t", person: ada.email, requests: [{ role: "worker", brief: "Read the notes." }] });
    expect(again).toEqual({ ok: true, duplicate: true });
    expect(w.rows()).toHaveLength(1);
    expect(w.runs).toHaveLength(0);
  });

  it("a sub-agent cut off mid-run fails honestly as interrupted and is never run twice", async () => {
    let calls = 0;
    const w = subagentWorld({
      transport: () => ({
        run: () => {
          calls++;
          return new Promise(() => {});
        },
      }),
      script: [load, delegate([{ role: "worker", brief: "Read the notes." }]), { text: "Started." }, { text: "Your worker was interrupted before it returned anything." }],
    });
    await w.say("Delegate a notes read.");
    void w.alarm();
    await Promise.resolve();
    expect(w.rows()[0]?.status).toBe("running");
    w.chat.evict();
    await w.settle();
    expect(calls).toBe(1);
    expect(w.rows()[0]).toMatchObject({ status: "failed", code: "SUBAGENT_INTERRUPTED", verdict: null });
    expect(w.transcript().filter((t) => t.includes("Your sub-agents have returned"))).toHaveLength(1);
  });

  it("an alarm during a running step does nothing, and the running step re-arms itself for the handoff", async () => {
    let release: (v: unknown) => void = () => {};
    let calls = 0;
    const w = subagentWorld({
      transport: () => ({
        run: () => {
          calls++;
          return new Promise((resolve) => {
            release = resolve as (v: unknown) => void;
          });
        },
      }),
      script: [load, delegate([{ role: "worker", brief: "Read the notes." }]), { text: "Started." }, verdict("pass"), { text: "Launch Thursday." }],
    });
    await w.say("Delegate a notes read.");
    const first = w.alarm();
    await Promise.resolve();
    await w.alarm();
    expect(w.rows()[0]?.status).toBe("running");
    expect(calls).toBe(1);
    const armsBefore = w.arms();
    release({ status: "done", text: "Launch Thursday.", spawns: [], tokens: 10, steps: 1 });
    await first;
    // The step that ran the worker armed the next one itself: the handoff is due.
    expect(w.arms()).toBe(armsBefore + 1);
    await w.settle();
    expect(w.transcript().filter((t) => t.includes("Your sub-agents have returned"))).toHaveLength(1);
  });

  it("an unreadable verdict labels the handoff unverified, never a pass", async () => {
    expect(parseVerdict('{"verdict":"pass","reason":"ok"}')).toEqual({ verdict: "pass", reason: "ok" });
    expect(parseVerdict("Looks fine to me.")).toEqual({ error: "no JSON object in the answer" });
    expect(parseVerdict('{"verdict":"maybe"}')).toMatchObject({ error: expect.stringContaining("not pass or fail") });
    const w = subagentWorld({ script: [load, delegate([{ role: "worker", brief: "Read the notes." }]), { text: "Started." }, { text: "Launch Thursday." }, { text: "Looks fine to me." }, { text: "The worker says Thursday; unverified." }] });
    await w.say("Delegate a notes read.");
    await w.settle();
    expect(w.rows()[0]).toMatchObject({ verdict: "unverified", verdictReason: "VERIFIER_UNPARSEABLE: no JSON object in the answer" });
    expect(w.transcript().some((t) => t.includes("verifier: unverified (VERIFIER_UNPARSEABLE"))).toBe(true);
  });

  it("writes a Ledger row per sub-agent and verifier call, on the subagent and verifier routes, attributed to the person", async () => {
    const w = subagentWorld({ script: [load, delegate([{ role: "worker", brief: "Read the notes." }]), { text: "Started." }, { text: "Launch Thursday." }, verdict("pass"), { text: "Thursday." }] });
    await w.say("Delegate a notes read.");
    await w.settle();
    const calls = await w.ledger().modelCalls({ person: ada.email });
    const id = w.rows()[0]?.id as string;
    expect(calls.filter((c) => c.runId === `subagent:${id}`).map((c) => c.route)).toEqual(["subagent"]);
    expect(calls.filter((c) => c.runId === `verifier:${id}`).map((c) => c.route)).toEqual(["verifier"]);
    expect(w.fake.requests.find((r) => r.inputs.messages.some((m) => String(m.content).includes("You check one sub-agent's handoff")))?.inputs.max_tokens).toBe(2048);
  });
});

/** A former member's label: rows and files keyed by a person who is not on the roster (fletch's fixtures hold one person). */
const other = { ...ada, id: "former-member", email: "former-member", name: "Pat" };
