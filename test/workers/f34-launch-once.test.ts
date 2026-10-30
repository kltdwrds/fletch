// F34: the launch reply is said once. On a slot the real model wrote its launch words beside `subagents_delegate` and
// again after it returned (T-P3-14); the turn loop now ends a step that said its words beside tools whose results all
// carry `endsTurnIfSaid`, as the delegate tool's does. Hermetic: the production turn loop over the scripted fake, with
// the production `subagents` namespace.
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import type { TurnContext } from "../../packages/agent/src/chat/gate.ts";
import { EffectBuffer } from "../../packages/agent/src/chat/tools.ts";
import { runTurnLoop, type Step } from "../../packages/agent/src/chat/turn.ts";
import { assemble } from "../../packages/agent/src/context/assemble.ts";
import { createStreamFn } from "../../packages/agent/src/model/adapter.ts";
import { modelFor } from "../../packages/agent/src/model/routes.ts";
import { subagentsNamespace } from "../../packages/agent/src/subagents/tools.ts";
import { FakeModel, type FakeStep } from "../support/fake-model.ts";

const T0 = Date.UTC(2026, 9, 30, 9, 0, 0);
const LAUNCH = "I started a sub-agent to read the page; I will tell you its title when it reports back.";

function loop(script: FakeStep[], tool?: AgentTool<never>) {
  const fake = new FakeModel(script);
  const effects = new EffectBuffer();
  const ns = subagentsNamespace({ open: () => 0, status: () => [], close: async () => ({ ok: true, closed: [], settled: [] }) as never }, { effects, context: { counterpart: { kind: "own-agent" } } as TurnContext, latched: () => false, person: "sam-solo" });
  const delegate = (tool ?? ns.tools.find((t) => t.name === "subagents_delegate")) as unknown as AgentTool<never>;
  const streamFn = createStreamFn({ ai: fake.binding as unknown as Ai, ledger: { record: async () => {} }, wait: async () => {}, now: () => T0 }, { tenant: "solo-sam", person: "sam-solo", runId: "run-1", route: "chat" });
  const steps: Step[] = [];
  const user = { role: "user" as const, content: "Have a sub-agent read the page and tell me its title.", timestamp: T0 };
  const messages = assemble({ platform: "P", task: "T", standingFiles: [], memory: [], skills: [], envelope: { now: T0, timeZone: "Europe/London", surface: "chat", modelId: "m", owner: "sam-solo" }, tools: [delegate], transcript: [user] });
  const run = () => runTurnLoop({ turnId: "turn-1", model: modelFor("chat"), streamFn, tools: [delegate], effects, messages, barrier: (s) => void steps.push(s), afterBarrier: async () => {}, onFrame: () => {}, maxSteps: 8 });
  return { fake, steps, run };
}

const call = { name: "subagents_delegate", arguments: { tasks: [{ role: "worker", brief: "Read the page and report its title." }] } };

describe("[F34] the launch reply is said once", () => {
  it("a launch said beside subagents_delegate ends the turn at that step: the model is not asked again", async () => {
    const { fake, steps, run } = loop([{ toolCall: call, text: LAUNCH }, { text: "Launched again." }]);
    expect(await run()).toMatchObject({ status: "done", steps: 1 });
    expect(steps.map((s) => s.final)).toEqual([true]);
    expect(steps[0]?.effects.map((e) => e.kind)).toEqual(["delegate"]);
    expect(fake.requests.length).toBe(1);
  });

  it("a delegate call with no words beside it continues, so the reply is written once after the call", async () => {
    const { fake, steps, run } = loop([{ toolCall: call }, { text: LAUNCH }]);
    expect(await run()).toMatchObject({ status: "done", steps: 2 });
    expect(steps.map((s) => s.final)).toEqual([false, true]);
    expect(fake.requests.length).toBe(2);
  });

  it("planted: words beside a tool whose result does not ask it, or a refused delegation, never end the turn", async () => {
    const plain = { name: "subagents_delegate", label: "plain", description: "d", parameters: Type.Object({}), execute: async () => ({ content: [{ type: "text", text: "ok" }], details: {} }) } as unknown as AgentTool<never>;
    const a = loop([{ toolCall: call, text: LAUNCH }, { text: "after" }], plain);
    expect(await a.run()).toMatchObject({ status: "done", steps: 2 });
    const refused = loop([{ toolCall: { name: "subagents_delegate", arguments: { tasks: Array.from({ length: 9 }, () => ({ role: "worker", brief: "b" })) } }, text: LAUNCH }, { text: "I could not start nine." }]);
    expect(await refused.run()).toMatchObject({ status: "done", steps: 2 });
  });
});
