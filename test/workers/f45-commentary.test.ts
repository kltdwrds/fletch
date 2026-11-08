// F45: the lead-in is commentary (B-P2-03, P2 delta 2). Words beside a tool call, in a step that neither pauses on a card
// nor ends the turn, reach the person nowhere (no `delta` frame, no history `agent` entry, not in the `named` frame, not
// in `replyChars`, never Activity's summary quote), and the stored row keeps them with a mark, so the model's next step
// is sent them. A paused step's words and an ending step's words stay the reply. Hermetic: the production chat engine
// and turn loop over the scripted fake. Each guard is planted through the rule's own module (`commentary.ts`), mocked
// to remove the rule (`off`), to widen it to every step (`all`) or to drop the words it marks (`strip`).
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TurnContext } from "../../packages/agent/src/chat/gate.ts";
import { EffectBuffer } from "../../packages/agent/src/chat/tools.ts";
import { runTurnLoop, type Step, type StreamFrame } from "../../packages/agent/src/chat/turn.ts";
import { assemble } from "../../packages/agent/src/context/assemble.ts";
import { createStreamFn } from "../../packages/agent/src/model/adapter.ts";
import { modelFor } from "../../packages/agent/src/model/routes.ts";
import { subagentsNamespace } from "../../packages/agent/src/subagents/tools.ts";
import { type P2Tier1World, p2Harness } from "../evals/p2-loop/harness.ts";
import reply from "../evals/p2-loop/reply-after-last-tool.task.ts";
import { P15Tier1World, sam } from "../evals/p15-approvals/harness.ts";
import { FakeModel, type FakeStep } from "../support/fake-model.ts";
import { Seeded } from "../support/seeded.ts";

const rule = vi.hoisted(() => ({ mode: "real" as "real" | "off" | "all" | "strip" }));
vi.mock("../../packages/agent/src/chat/commentary.ts", async (original) => {
  const real = await original<typeof import("../../packages/agent/src/chat/commentary.ts")>();
  return {
    ...real,
    isCommentaryStep: (...a: Parameters<typeof real.isCommentaryStep>) => (rule.mode === "off" ? false : rule.mode === "all" ? true : real.isCommentaryStep(...a)),
    markCommentary: (m: Parameters<typeof real.markCommentary>[0]) => {
      if (rule.mode === "strip") for (const c of m.content) if (c.type === "text") c.text = "";
      real.markCommentary(m);
    },
  };
});
afterEach(() => {
  rule.mode = "real";
});

const LEAD = "Let me look at that first.";
const REPLY = "Step 1 holds 4 files.";
const lookup = (n: number, text?: string): FakeStep => ({ toolCall: { name: "steps_lookup", arguments: { n } }, ...(text ? { text } : {}) });

/** Sam's prompt played through the P2 harness (the production `ChatEngine`) with `script`. */
async function played(script: FakeStep[]): Promise<P2Tier1World> {
  const h = p2Harness({ fixtures: ["steps"], script });
  const rng = new Seeded(reply.setup.seed);
  const world = await h.setup(rng, reply);
  for (const t of reply.turns) await h.play(world, t, rng);
  return world;
}

/** What reached Sam of the turn: the streamed words, the history's agent entries, the `named` frame's, the turn's char count. */
function reached(w: P2Tier1World) {
  const frames = w.frames();
  const named = frames.find((f) => f.type === "named") as { messages?: Array<{ who: string; text: string }> } | undefined;
  return {
    streamed: frames.filter((f) => f.type === "delta" || f.type === "message").map((f) => String(f.text)).join(""),
    entries: w.entries().filter((e) => e.kind === "agent").map((e) => e.text),
    named: (named?.messages ?? []).filter((m) => m.who === "agent").map((m) => m.text),
    chars: (frames.find((f) => f.type === "turn_done") as { chars?: number } | undefined)?.chars,
  };
}

/** The assistant rows as stored: their words and whether they carry the commentary mark. */
const stored = (w: P2Tier1World) =>
  w.transcript().map((b) => JSON.parse(b) as { role: string; commentary?: boolean; content: unknown }).filter((m) => m.role === "assistant").map((m) => ({ commentary: m.commentary === true, text: (m.content as Array<{ type: string; text?: string }>).map((c) => (c.type === "text" ? (c.text ?? "") : "")).join("") }));

/** The model's second request: does its assistant message carry `text`? */
const sentAgain = (w: P2Tier1World, text: string) => (w.requests()[1]?.messages ?? []).some((m) => m.role === "assistant" && m.text.includes(text));

/** The Activity summary of Sam's one task, as the page is sent it. */
async function summary(w: P2Tier1World): Promise<string> {
  const list = (await w.w.http(sam.email, "GET", "/app/activity")).body as { tasks: Array<{ id: string; chatId: string }> };
  const t = list.tasks[0] as { id: string; chatId: string };
  const detail = (await w.w.http(sam.email, "GET", `/app/activity/${t.chatId}/${t.id}`)).body as { steps: Array<{ kind: string }> };
  return JSON.stringify(detail.steps.find((s) => s.kind === "summary") ?? null);
}

describe("[F45] a lead-in beside a call in a step that continues is commentary", () => {
  it("reaches no frame, no history entry, no named frame and no char count; the row keeps it marked and the model is sent it", async () => {
    const w = await played([lookup(1, LEAD), { text: REPLY }]);
    expect(reached(w)).toEqual({ streamed: REPLY, entries: [REPLY], named: [REPLY], chars: REPLY.length });
    expect(stored(w)).toEqual([{ commentary: true, text: LEAD }, { commentary: false, text: REPLY }]);
    expect(sentAgain(w, LEAD)).toBe(true);
    // A reload draws the same: the mark is on the stored row, not in memory.
    expect(w.reload().filter((e) => e.kind === "agent").map((e) => e.text)).toEqual([REPLY]);
  });

  it("planted: with the rule removed the lead-in is streamed, an entry, named and counted", async () => {
    rule.mode = "off";
    const w = await played([lookup(1, LEAD), { text: REPLY }]);
    expect(reached(w)).toEqual({ streamed: LEAD + REPLY, entries: [LEAD, REPLY], named: [LEAD, REPLY], chars: LEAD.length + REPLY.length });
    expect(stored(w).map((r) => r.commentary)).toEqual([false, false]);
  });

  it("planted: a rule that drops the words it marks changes what the model is sent", async () => {
    rule.mode = "strip";
    const w = await played([lookup(1, LEAD), { text: REPLY }]);
    expect(sentAgain(w, LEAD)).toBe(false);
  });

  it("Activity's summary never quotes it when the last step has no words; with the rule removed it does", async () => {
    const script = [lookup(1, LEAD), lookup(2), { text: "" }];
    expect(await summary(await played(script))).not.toContain(LEAD);
    rule.mode = "off";
    expect(await summary(await played(script))).toContain(LEAD);
  });
});

describe("[F45] a paused step's words and an ending step's words stay the reply", () => {
  const HOST = "httpbin.test";
  const share = { toolCall: { id: "s1", name: "share_post", arguments: { host: HOST, text: "p15 probe" } }, text: "That post waits for your decision." };
  async function paused() {
    const w = new P15Tier1World({ script: [share], sites: {} });
    await w.open("c1");
    await w.chat().send({ person: sam.email, text: `post p15 probe to ${HOST}` });
    await w.chat().settled();
    return w;
  }

  it("words beside a card call that pauses are streamed and drawn; a rule that took them for commentary drops them", async () => {
    const w = await paused();
    expect(w.entries().filter((e) => e.kind === "agent").map((e) => e.text)).toEqual([share.text]);
    expect(w.frames().filter((f) => f.type === "delta").map((f) => f.text)).toEqual([share.text]);
    rule.mode = "all";
    const planted = await paused();
    expect(planted.entries().filter((e) => e.kind === "agent").map((e) => e.text)).not.toContain(share.text);
  });

  const LAUNCH = "I started a sub-agent to read the page; I will tell you its title when it reports back.";
  const delegate = { name: "subagents_delegate", arguments: { tasks: [{ role: "worker", brief: "Read the page and report its title." }] } };
  function loop(script: FakeStep[]) {
    const fake = new FakeModel(script);
    const effects = new EffectBuffer();
    const ns = subagentsNamespace({ open: () => 0, status: () => [], close: async () => ({ ok: true, closed: [], settled: [] }) as never }, { effects, context: { counterpart: { kind: "own-agent" } } as TurnContext, latched: () => false, person: "sam-solo" });
    const search = { name: "tool_search", label: "load", description: "d", parameters: Type.Object({}), execute: async () => ({ content: [{ type: "text", text: "loaded" }], details: {} }) } as unknown as AgentTool<never>;
    const tools = [ns.tools.find((t) => t.name === "subagents_delegate") as unknown as AgentTool<never>, search];
    const streamFn = createStreamFn({ ai: fake.binding as unknown as Ai, ledger: { record: async () => {} }, wait: async () => {}, now: () => 0 }, { tenant: "solo-sam", person: "sam-solo", runId: "run-1", route: "chat" });
    const messages = assemble({ platform: "P", task: "T", standingFiles: [], memory: [], skills: [], envelope: { now: 0, timeZone: "Europe/London", surface: "chat", modelId: "m", owner: "sam-solo" }, tools, transcript: [{ role: "user", content: "Have a sub-agent read the page.", timestamp: 0 }] });
    const steps: Step[] = [];
    const frames: StreamFrame[] = [];
    const run = () => runTurnLoop({ turnId: "turn-1", model: modelFor("chat"), streamFn, tools, effects, messages, barrier: (s) => void steps.push(s), afterBarrier: async () => {}, onFrame: (f) => void frames.push(f), maxSteps: 8 });
    return { fake, steps, frames, run };
  }
  const words = (frames: StreamFrame[]) => frames.flatMap((f) => (f.type === "delta" ? [f.text] : []));

  it("words beside a launch that ends the turn are its reply, streamed once; a rule that took them for commentary drops them", async () => {
    const a = loop([{ toolCall: delegate, text: LAUNCH }, { text: "Launched again." }]);
    expect(await a.run()).toMatchObject({ status: "done", steps: 1 });
    expect(words(a.frames)).toEqual([LAUNCH]);
    rule.mode = "all";
    const b = loop([{ toolCall: delegate, text: LAUNCH }, { text: "Launched again." }]);
    await b.run();
    expect(words(b.frames)).toEqual([]);
  });

  it("saidBefore counts only a reply: a lead-in beside tool_search does not end the launch after it; with the rule removed it does", async () => {
    const script: FakeStep[] = [{ toolCall: { name: "tool_search", arguments: {} }, text: LEAD }, { toolCall: delegate }, { text: LAUNCH }];
    const a = loop(script);
    expect(await a.run()).toMatchObject({ status: "done", steps: 3 });
    expect(words(a.frames)).toEqual([LAUNCH]);
    rule.mode = "off";
    const b = loop(script);
    expect(await b.run()).toMatchObject({ status: "done", steps: 2 });
    expect(words(b.frames)).toEqual([LEAD]);
  });
});
