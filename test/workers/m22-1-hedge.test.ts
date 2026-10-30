// M22.1: the chat route on OpenRouter's GLM 5.3 Flash with Workers AI as the hedge. Every claim runs
// on the production adapter, engine and Ledger over the scripted fake, with the test owning the
// clock: the hedge delay and the bounds pass only when the test fires their timers. Races are
// decided by `hold` steps, which give nothing until the test releases them, so which leg's first
// token arrives first is the test's choice, including both in the same tick (the hostile race).
// Two members, Ada and Bo of solo-sam, wherever a claim involves more than one person.
import { type AssistantMessage, type AssistantMessageEvent, normalizeContext } from "@earendil-works/pi-ai";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { matchSecret } from "../../scripts/lib/secret-patterns.ts";
import { ChatEngine, type EngineCtx } from "../../packages/agent/src/chat/engine.ts";
import { ASKING, CHAT_TASK, REQUEST_TASK } from "../../packages/agent/src/chat/instructions.ts";
import { ownerOnly } from "../../packages/agent/src/chat/protocol.ts";
import { type Directory, route } from "../../packages/agent/src/http/routes.ts";
import type { Admission, LedgerSink, ModelCallRow } from "../../packages/agent/src/ledger/types.ts";
import { createStreamFn } from "../../packages/agent/src/model/adapter.ts";
import { HEDGE_LOST } from "../../packages/agent/src/model/hedge.ts";
import { CALL_BOUNDS, GLM_OPENROUTER, GLM_WORKERS_AI, HEDGES, MODEL_TIERS, modelConfig, modelFor, OPENROUTER_PROVIDER } from "../../packages/agent/src/model/routes.ts";
import { Ledger } from "../../packages/agent/src/objects/ledger.ts";
import { FAKE_OPENROUTER_HOST, FakeModel, type FakeRequest, type FakeStep } from "../support/fake-model.ts";
import { harnessNamespace, ObjectHarness } from "../support/object-harness.ts";
import { ada } from "./support/authority-world.ts";

const T0 = Date.UTC(2026, 9, 15, 23, 0, 0);
const HEDGE = HEDGES.chat as { model: string; delayMs: number };
const BOUNDS = CALL_BOUNDS.chat as { firstTokenMs: number; totalMs: number };
const ROOT = join(import.meta.dirname, "../..");
/** A deploy configured as qyvr-co's (gateway `qyvr`, chat on OpenRouter): the only one that hedges. */
const VARS = { AI_GATEWAY_ID: "qyvr", CHAT_PROVIDER: "openrouter" };
const MODELS = modelConfig(VARS);

/** Timers the test fires; a cancelled one never fires. */
function clock() {
  const list: Array<{ f: () => void; ms: number; cancelled?: boolean }> = [];
  const live = () => list.filter((t) => !t.cancelled);
  return {
    live,
    schedule: (f: () => void, ms: number) => {
      const t: { f: () => void; ms: number; cancelled?: boolean } = { f, ms };
      list.push(t);
      return () => {
        t.cancelled = true;
      };
    },
    async fire(ms: number) {
      for (let i = 0; i < 50 && !live().some((t) => t.ms === ms); i++) await new Promise((r) => setImmediate(r));
      const t = live().find((x) => x.ms === ms);
      if (!t) throw new Error(`no live timer of ${ms} ms`);
      t.cancelled = true;
      t.f();
    },
  };
}

const settle = async () => {
  for (let i = 0; i < 30; i++) await new Promise((r) => setImmediate(r));
};

/** The adapter alone on the chat route, with a Ledger that records rows and counts admissions. */
async function call(script: FakeStep[], person = ada.email) {
  const fake = new FakeModel(script);
  const bounds = clock();
  const rows: ModelCallRow[] = [];
  const admissions: Admission[] = [];
  const ledger: LedgerSink = {
    record: async (r) => void rows.push(r),
    admit: async (a) => {
      admissions.push(a);
      return { ok: true };
    },
  };
  const streamFn = createStreamFn({ ai: fake.binding as unknown as Ai, ledger, wait: async () => {}, now: () => T0, schedule: bounds.schedule, models: MODELS }, { tenant: ada.company, person, runId: `run-${person}`, route: "chat" });
  const stream = await streamFn(modelFor("chat", MODELS), normalizeContext({ messages: [{ role: "user", content: "hello", timestamp: T0 }] }), {});
  const events: AssistantMessageEvent[] = [];
  const result = (async (): Promise<AssistantMessage> => {
    for await (const e of stream) events.push(e);
    return stream.result();
  })();
  return { fake, bounds, rows, admissions, events, result };
}

const signalOf = (r: FakeRequest | undefined) => r?.options.signal as AbortSignal;
const byAttempt = (rows: ModelCallRow[]) => [...rows].sort((a, b) => a.attempt - b.attempt);
const textOf = (events: AssistantMessageEvent[]) => events.filter((e) => e.type === "text_delta").map((e) => (e as { delta: string }).delta).join("");

describe("[M22.1] the primary is chosen", () => {
  it("a chat call goes to OpenRouter's GLM through gateway qyvr's provider path with the stored key: latency-sorted, parameters required, low effort, no key on the request", async () => {
    const c = await call([{ text: "Hello Ada.", usage: { prompt: 900, completion: 12, cost: 0.000142 } }]);
    const message = await c.result;
    expect(message.stopReason).toBe("stop");
    expect(textOf(c.events)).toBe("Hello Ada.");
    expect(c.fake.requests).toHaveLength(1);
    const r = c.fake.requests[0] as (typeof c.fake.requests)[number];
    expect(r.model).toBe(GLM_OPENROUTER);
    expect(r.passthrough).toEqual({ gatewayId: "qyvr", provider: "openrouter", endpoint: "v1/chat/completions", headers: { "content-type": "application/json", "cf-aig-collect-log": "false" } });
    // No provider key and no gateway token travel with the request: the gateway uses the stored BYOK key.
    expect(Object.keys(r.passthrough?.headers ?? {}).map((k) => k.toLowerCase())).not.toContain("authorization");
    expect(Object.keys(r.passthrough?.headers ?? {}).map((k) => k.toLowerCase())).not.toContain("cf-aig-authorization");
    expect(r.options.gateway).toEqual({ id: "qyvr", collectLog: false });
    expect(r.inputs).toMatchObject({ model: GLM_OPENROUTER, stream: true, provider: { sort: "latency", require_parameters: true }, reasoning: { effort: "low" } });
    expect(OPENROUTER_PROVIDER).toEqual({ sort: "latency", require_parameters: true });
    expect(r.inputs).not.toHaveProperty("reasoning_effort");
    // The hedge never started: its timer was cancelled at the primary's first token.
    expect(c.bounds.live()).toEqual([]);
    // The row names the host and model that served it and the provider's own cost.
    expect(c.rows).toEqual([expect.objectContaining({ route: "chat", model: GLM_OPENROUTER, provider: `openrouter/${FAKE_OPENROUTER_HOST}`, attempt: 1, status: "ok", costMicros: 142, inputTokens: 900, outputTokens: 12 })]);
  });

  it("the Ledger keeps the provider's cost where given and prices from the table where not, and names the provider on each row", async () => {
    const h = new ObjectHarness("ledger-m22-1", (ctx, env) => new Ledger(ctx as DurableObjectState, env as Env), { TENANT_ID: "solo-sam", QYVR_ENV: "test" });
    const base = { tenant: "solo-sam", person: ada.email, runId: "r", route: "chat" as const, attempt: 1, status: "ok" as const, code: null, httpStatus: 200, inputTokens: 1_000_000, outputTokens: 0, reasoningTokens: 0, cachedTokens: 0, at: T0, startedAt: T0, firstTokenAt: T0, finishedAt: T0 };
    await h.instance.record({ ...base, model: GLM_OPENROUTER, provider: "openrouter/Baseten", costMicros: 123 });
    await h.instance.record({ ...base, model: GLM_OPENROUTER, provider: "openrouter" });
    await h.instance.record({ ...base, model: GLM_WORKERS_AI, provider: "workers-ai", attempt: 2 });
    expect((await h.instance.modelCalls()).map((r) => [r.model, r.provider, r.costMicros])).toEqual([
      [GLM_OPENROUTER, "openrouter/Baseten", 123],
      [GLM_OPENROUTER, "openrouter", 150_000],
      [GLM_WORKERS_AI, "workers-ai", 150_000],
    ]);
  });

  it("every tier that admits the primary admits its hedge, so the one admission covers both legs", () => {
    for (const [tier, models] of Object.entries(MODEL_TIERS)) {
      if ((models as readonly string[]).includes(GLM_OPENROUTER)) expect((models as readonly string[]).includes(HEDGE.model), tier).toBe(true);
    }
    expect(HEDGE).toEqual({ model: GLM_WORKERS_AI, delayMs: 5_000 });
  });
});

describe("[M22.1] the hedge starts on a 408, 429 or 5xx, or a slow first token", () => {
  for (const status of [408, 429, 500, 503]) {
    it(`a ${status} from the primary sends the same request to Workers AI at once, with its spelling of low effort`, async () => {
      const c = await call([{ status }, { text: "Hello from the hedge." }]);
      const message = await c.result;
      expect(message.stopReason).toBe("stop");
      expect(message.model).toBe(GLM_WORKERS_AI);
      expect(textOf(c.events)).toBe("Hello from the hedge.");
      expect(c.fake.requests.map((r) => [r.model, r.passthrough?.provider ?? "binding"])).toEqual([[GLM_OPENROUTER, "openrouter"], [GLM_WORKERS_AI, "binding"]]);
      const hedged = c.fake.requests[1] as (typeof c.fake.requests)[number];
      expect(hedged.inputs).toMatchObject({ reasoning_effort: "low", stream: true });
      expect(hedged.inputs).not.toHaveProperty("provider");
      expect(hedged.inputs).not.toHaveProperty("reasoning");
      expect(hedged.inputs.messages).toEqual(c.fake.requests[0]?.inputs.messages);
      expect(hedged.options).toMatchObject({ gateway: { id: "qyvr", collectLog: false }, returnRawResponse: true });
      expect(byAttempt(c.rows).map((r) => [r.attempt, r.model, r.provider, r.status, r.httpStatus])).toEqual([
        [1, GLM_OPENROUTER, "openrouter", status === 429 ? "rate_limited" : "http_error", status],
        [2, GLM_WORKERS_AI, "workers-ai", "ok", 200],
      ]);
      // The hedge did not wait for its timer: nothing is left armed.
      expect(c.bounds.live()).toEqual([]);
    });
  }

  it("a 400 is the request's fault: no hedge, the step fails with its code", async () => {
    const c = await call([{ status: 400 }]);
    expect((await c.result).errorMessage).toMatch(/^MODEL_HTTP_400: /);
    expect(c.fake.requests).toHaveLength(1);
    expect(c.rows.map((r) => r.status)).toEqual(["http_error"]);
    expect(c.bounds.live()).toEqual([]);
  });

  it("no first token within the hedge delay starts the hedge; its first token wins and the slow primary is aborted as lost", async () => {
    const c = await call([{ silent: true }, { text: "Hello from the hedge." }]);
    await settle();
    expect(c.fake.requests).toHaveLength(1);
    await c.bounds.fire(HEDGE.delayMs);
    const message = await c.result;
    expect(message.stopReason).toBe("stop");
    expect(textOf(c.events)).toBe("Hello from the hedge.");
    expect(c.fake.requests.map((r) => r.model)).toEqual([GLM_OPENROUTER, GLM_WORKERS_AI]);
    expect(signalOf(c.fake.requests[0]).aborted).toBe(true);
    expect(byAttempt(c.rows).map((r) => [r.attempt, r.status, r.code])).toEqual([[1, "aborted", HEDGE_LOST], [2, "ok", null]]);
    expect(c.bounds.live()).toEqual([]);
  });

  it("the hedge is told apart from a retry: a primary that answers before the delay never starts it", async () => {
    const c = await call([{ hold: "p", step: { text: "Hi." } }]);
    await c.fake.reached("p");
    expect(c.bounds.live().map((t) => t.ms).sort((a, b) => a - b)).toEqual([HEDGE.delayMs, BOUNDS.firstTokenMs, BOUNDS.totalMs]);
    c.fake.release("p");
    expect((await c.result).stopReason).toBe("stop");
    expect(c.fake.requests).toHaveLength(1);
    expect(c.bounds.live()).toEqual([]);
  });
});

describe("[M22.1] whichever stream gives its first token first wins, and the other is aborted", () => {
  const race = async (first: "p" | "h" | "both") => {
    const c = await call([{ hold: "p", step: { reasoning: "Primary thinks.", text: "From the primary." } }, { hold: "h", step: { reasoning: "Hedge thinks.", text: "From the hedge." } }]);
    await c.fake.reached("p");
    await c.bounds.fire(HEDGE.delayMs);
    await c.fake.reached("h");
    if (first === "p") c.fake.release("p");
    if (first === "h") c.fake.release("h");
    if (first === "both") {
      // The hostile race: both legs stream in the same tick.
      c.fake.release("p");
      c.fake.release("h");
    }
    await settle();
    // The loser's body was aborted; releasing it now delivers nothing.
    if (first === "p") c.fake.release("h");
    if (first === "h") c.fake.release("p");
    return { c, message: await c.result };
  };

  it("the primary first: its stream is the turn's, the hedge is aborted, each its own row", async () => {
    const { c, message } = await race("p");
    expect(textOf(c.events)).toBe("From the primary.");
    expect(message.content).toEqual([{ type: "thinking", thinking: "Primary thinks." }, { type: "text", text: "From the primary." }]);
    expect(signalOf(c.fake.requests[1]).aborted).toBe(true);
    expect(byAttempt(c.rows).map((r) => [r.attempt, r.model, r.status, r.code])).toEqual([[1, GLM_OPENROUTER, "ok", null], [2, GLM_WORKERS_AI, "aborted", HEDGE_LOST]]);
  });

  it("the hedge first: its stream is the turn's, the primary is aborted, each its own row", async () => {
    const { c, message } = await race("h");
    expect(textOf(c.events)).toBe("From the hedge.");
    expect(message.model).toBe(GLM_WORKERS_AI);
    expect(signalOf(c.fake.requests[0]).aborted).toBe(true);
    expect(byAttempt(c.rows).map((r) => [r.attempt, r.model, r.status, r.code])).toEqual([[1, GLM_OPENROUTER, "aborted", HEDGE_LOST], [2, GLM_WORKERS_AI, "ok", null]]);
  });

  it("both in the same tick: exactly one leg's events reach the turn, never doubled or interleaved", async () => {
    const { c, message } = await race("both");
    const text = textOf(c.events);
    const thinking = c.events.filter((e) => e.type === "thinking_delta").map((e) => (e as { delta: string }).delta).join("");
    const won = text === "From the primary." ? "primary" : text === "From the hedge." ? "hedge" : "neither";
    expect(won).not.toBe("neither");
    expect(thinking).toBe(won === "primary" ? "Primary thinks." : "Hedge thinks.");
    expect(c.events.filter((e) => e.type === "start")).toHaveLength(1);
    expect(c.events.filter((e) => e.type === "done")).toHaveLength(1);
    expect(c.events.filter((e) => e.type === "text_start")).toHaveLength(1);
    expect(c.events.filter((e) => e.type === "thinking_start")).toHaveLength(1);
    expect(message.content.map((b) => b.type)).toEqual(["thinking", "text"]);
    expect(byAttempt(c.rows).map((r) => r.status).sort()).toEqual(["aborted", "ok"]);
  });

  it("on the page: one turn's frames, from one leg, and the reasoning drawn once", async () => {
    const w = world([{ hold: "p", step: { text: "Primary." } }, { hold: "h", step: { reasoningDetails: [{ type: "reasoning.text", text: "Hedge reasons." }], text: "Hedge." } }]);
    const sock = w.socketOf(ada.email);
    const turn = w.chat.instance.send({ person: ada.email, text: "hello" });
    await w.fake.reached("p");
    await w.bounds.fire(HEDGE.delayMs);
    await w.fake.reached("h");
    w.fake.release("h");
    await settle();
    w.fake.release("p");
    expect(await turn).toMatchObject({ status: "done" });
    expect(sock.frames.filter((f) => f.type === "delta").map((f) => f.text).join("")).toBe("Hedge.");
    expect(sock.frames.filter((f) => f.type === "reasoning").map((f) => f.text).join("")).toBe("Hedge reasons.");
    expect(sock.frames.filter((f) => f.type === "turn_done")).toHaveLength(1);
  });
});

describe("[M22.1] two Ledger rows and one budget admission", () => {
  it("a hedged step is admitted once, however many attempts it makes; both attempts are rows with their own tokens", async () => {
    const c = await call([{ status: 503 }, { text: "Hi.", usage: { prompt: 40, completion: 3 } }]);
    await c.result;
    expect(c.admissions).toEqual([{ person: ada.email, runId: `run-${ada.email}`, model: GLM_OPENROUTER }]);
    expect(byAttempt(c.rows).map((r) => [r.attempt, r.status, r.inputTokens, r.outputTokens])).toEqual([[1, "http_error", 0, 0], [2, "ok", 40, 3]]);
  });

  it("a refused admission reaches neither model and is one refused row", async () => {
    const fake = new FakeModel([]);
    const rows: ModelCallRow[] = [];
    let asked = 0;
    const ledger: LedgerSink = {
      record: async (r) => void rows.push(r),
      admit: async () => {
        asked++;
        return { ok: false, code: "BUDGET_PERSON_EXHAUSTED", reason: "spent" };
      },
    };
    const streamFn = createStreamFn({ ai: fake.binding as unknown as Ai, ledger, wait: async () => {}, now: () => T0, schedule: clock().schedule, models: MODELS }, { tenant: ada.company, person: ada.email, runId: "r", route: "chat" });
    const message = await (await streamFn(modelFor("chat", MODELS), normalizeContext({ messages: [{ role: "user", content: "hi", timestamp: T0 }] }), {})).result();
    expect(message.errorMessage).toMatch(/^BUDGET_PERSON_EXHAUSTED: /);
    expect(asked).toBe(1);
    expect(fake.requests).toHaveLength(0);
    expect(rows.map((r) => [r.status, r.code, r.startedAt])).toEqual([["refused", "BUDGET_PERSON_EXHAUSTED", null]]);
  });

  it("on the production Ledger: the turn's two rows sit under its run id, and a third step is still admitted against the day's spend", async () => {
    const w = world([{ status: 429 }, { text: "Hello Ada.", usage: { prompt: 100, completion: 5 } }]);
    const r = await w.chat.instance.send({ person: ada.email, text: "hello" });
    if (r.status !== "done") throw new Error("the turn failed");
    const calls = await w.calls();
    expect(calls.map((x) => [x.runId === r.turnId, x.attempt, x.model, x.status])).toEqual([[true, 1, GLM_OPENROUTER, "rate_limited"], [true, 2, GLM_WORKERS_AI, "ok"]]);
    expect(calls.reduce((n, x) => n + x.inputTokens + x.outputTokens, 0)).toBe(105);
  });
});

describe("[M22.1] reasoning stays visible", () => {
  it("OpenRouter's reasoning_details text and summary items are drawn as thinking; an encrypted item is flagged, never shown", async () => {
    const c = await call([{ reasoningDetails: [{ type: "reasoning.text", text: "Ada asked hello. " }, { type: "reasoning.summary", summary: "Greet her back." }], text: "Hello Ada." }]);
    const message = await c.result;
    expect(message.content).toEqual([{ type: "thinking", thinking: "Ada asked hello. Greet her back." }, { type: "text", text: "Hello Ada." }]);
    expect((message as { reasoningWithheld?: boolean }).reasoningWithheld).toBeUndefined();

    const hidden = await call([{ reasoningDetails: [{ type: "reasoning.encrypted", data: "gAAAAB-opaque" }], text: "Hello Bo." }], ada.email);
    const m = await hidden.result;
    expect(m.content).toEqual([{ type: "text", text: "Hello Bo." }]);
    expect((m as { reasoningWithheld?: boolean }).reasoningWithheld).toBe(true);
    expect(JSON.stringify(m.content)).not.toContain("opaque");
  });

  it("the page gets the reasoning as its own frames and the history keeps it as a thinking entry", async () => {
    const w = world([{ reasoningDetails: [{ type: "reasoning.summary", summary: "A greeting." }], text: "Hello Ada." }]);
    const sock = w.socketOf(ada.email);
    expect(await w.chat.instance.send({ person: ada.email, text: "hello" })).toMatchObject({ status: "done" });
    expect(sock.frames.filter((f) => f.type === "reasoning").map((f) => f.text).join("")).toBe("A greeting.");
    expect(w.chat.instance.history().entries.filter((e) => e.kind === "thinking").map((e) => e.text)).toEqual(["A greeting."]);
  });
});

describe("[M22.1] if both fail, the turn fails in words", () => {

  it("neither leg gives a token within its bound: both are aborted with their code and the step fails once", async () => {
    const c = await call([{ silent: true }, { silent: true }]);
    await c.bounds.fire(HEDGE.delayMs);
    await c.bounds.fire(BOUNDS.firstTokenMs);
    await c.bounds.fire(BOUNDS.firstTokenMs);
    const message = await c.result;
    expect(message.errorMessage).toMatch(/^MODEL_FIRST_TOKEN_TIMEOUT: /);
    expect(c.events.filter((e) => e.type === "error")).toHaveLength(1);
    expect(byAttempt(c.rows).map((r) => [r.attempt, r.status, r.code])).toEqual([[1, "failed", "MODEL_FIRST_TOKEN_TIMEOUT"], [2, "failed", "MODEL_FIRST_TOKEN_TIMEOUT"]]);
    expect(c.bounds.live()).toEqual([]);
  });

  it("the winner breaking after its first token is the step's failure; nothing is retried behind it", async () => {
    const c = await call([{ checkpoint: "mid", step: { text: "A long answer that breaks." } }]);
    await c.fake.reached("mid");
    await settle();
    c.fake.drop("mid");
    const message = await c.result;
    expect(message.errorMessage).toMatch(/^MODEL_STREAM_DROPPED: /);
    expect(c.fake.requests).toHaveLength(1);
    expect(c.rows.map((r) => [r.status, r.firstTokenAt !== null])).toEqual([["dropped", true]]);
  });
});

describe("[M22.1] asking, one question at a time (B8, B10)", () => {
  it("every chat turn's task block tells the model to ask one question and nothing before it, and to act on a single reading", async () => {
    const w = world([{ text: "Which meeting, evt-1 or evt-2?" }]);
    await w.chat.instance.send({ person: ada.email, text: "Move my meeting." });
    const system = (w.fake.requests[0]?.inputs.messages ?? []).filter((m) => m.role === "system").map((m) => String(m.content)).join("\n");
    expect(CHAT_TASK).toContain(ASKING);
    expect(system).toContain(ASKING);
    expect(ASKING).toMatch(/exactly one clarifying question/);
    expect(ASKING).toMatch(/the one whose answer most changes what you would do/);
    expect(ASKING).toMatch(/do not call tools to gather options/);
    expect(ASKING).toMatch(/do not describe what you are about to do/);
    expect(ASKING).toMatch(/one plausible reading, act on it without asking/);
    // How to ask, never what is allowed: no grant, permission or approval moves into the prompt.
    expect(ASKING).not.toMatch(/grant|permi|allow|approv|may /i);
    // A colleague's request chat keeps its own task block.
    expect(REQUEST_TASK).not.toContain(ASKING);
  });
});

describe("[M22.1] no tenant config or bundle holds a token", () => {

  it("the agent's source, which is all its bundle is built from, holds no credential, no provider key read and no gateway token header", () => {
    const findings = sourceFindings(agentSources());
    expect(findings).toEqual([]);
    // The check is real: a planted key, a key read from the environment and a token header are each found.
    expect(sourceFindings([{ path: "planted.ts", text: `const k = "sk-or-v1-${"b2".repeat(32)}";` }])).toEqual(["planted.ts: openai-style-key"]);
    expect(sourceFindings([{ path: "planted.ts", text: ["headers: { authorization: `Bearer $", "{env.OPENROUTER_API_KEY}` }"].join("") }])).toEqual(["planted.ts: reads a provider key from the environment", "planted.ts: sets a provider authorization header"]);
    expect(sourceFindings([{ path: "planted.ts", text: `{ "cf-aig-authorization": token }` }])).toEqual(["planted.ts: sends a gateway token"]);
  });
});

/** Ada's chat over the production engine and Ledger, frames to the owner's connections only. */
function world(script: FakeStep[]) {
  const fake = new FakeModel(script);
  const bounds = clock();
  const ledgers = harnessNamespace((name) => new ObjectHarness(name, (ctx, env) => new Ledger(ctx as DurableObjectState, env as Env), {}, (l) => {
    l.now = () => T0;
  }));
  const env = { TENANT_ID: ada.company, QYVR_ENV: "test", ...VARS, AI: fake.binding, LEDGER: ledgers.binding };
  const conns: Array<{ state: { person: string }; frames: Array<Record<string, unknown>>; send(d: string): void }> = [];
  const chatOf = (name: string, owner: string) => {
    const h: ObjectHarness<ChatEngine> = new ObjectHarness(name, (ctx, e) => new ChatEngine(ctx as EngineCtx, e as Env, { sockets: () => ownerOnly(conns, h.instance.owner()) }), env, (c) => {
      c.now = () => T0;
      c.wait = async () => {};
      c.schedule = bounds.schedule;
    });
    h.instance.claim(owner);
    return h;
  };
  const chat = chatOf("chat-ada", ada.email);
  const socketOf = (person: string) => {
    const c = { state: { person }, frames: [] as Array<Record<string, unknown>>, send: (d: string) => void c.frames.push(JSON.parse(d)) };
    conns.push(c);
    return c;
  };
  const calls = () => ledgers.harness(ada.company).instance.modelCalls({ person: ada.email });
  // The agent script's own route for `/ledger/calls`, with the person the session named.
  const dir = { ledger: () => ({ modelCalls: (filter: { runId?: string; person?: string }) => ledgers.harness(ada.company).instance.modelCalls(filter) }) } as unknown as Directory;
  const http = (person: string, path: string) => route(new Request(`https://${ada.company}.qyvr-staging.dev${path}`), env as unknown as Env, { tenant: ada.company, person }, dir);
  return { fake, bounds, chat, chatOf, socketOf, calls, http };
}

function agentSources(dir = join(ROOT, "packages/agent/src")): Array<{ path: string; text: string }> {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return agentSources(path);
    return name.endsWith(".ts") ? [{ path: path.slice(ROOT.length + 1), text: readFileSync(path, "utf8") }] : [];
  });
}

/** Credentials in the agent's own source, or code that would put one on a model request. */
function sourceFindings(files: Array<{ path: string; text: string }>): string[] {
  const out: string[] = [];
  for (const f of files) {
    const shape = matchSecret(f.text);
    if (shape) out.push(`${f.path}: ${shape}`);
    if (/env\.[A-Z_]*(OPENROUTER|ANTHROPIC|OPENAI|PROVIDER)[A-Z_]*(KEY|TOKEN)/.test(f.text)) out.push(`${f.path}: reads a provider key from the environment`);
    if (/["']?authorization["']?\s*:\s*`?Bearer/i.test(f.text)) out.push(`${f.path}: sets a provider authorization header`);
    if (/cf-aig-authorization/i.test(f.text)) out.push(`${f.path}: sends a gateway token`);
  }
  return out;
}
