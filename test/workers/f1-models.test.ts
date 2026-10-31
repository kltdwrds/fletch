// F1, D-0020: how a deploy reaches models. The agent's own `packages/agent/wrangler.jsonc` ships
// `AI_GATEWAY_ID=qyvr` and `CHAT_PROVIDER=meta`, so a deploy that keeps its vars runs chat on Meta's Muse Spark
// (BYOK through that gateway, as its custom provider `meta`) and every other route on Workers AI through the same
// gateway; `CHAT_PROVIDER=workers-ai` is the alternative, GLM 5.3 Flash. With neither var every route goes to
// Workers AI over the AI binding with no key and no AI Gateway option. There is no other provider and no
// fallback model, and vars that name what the deploy cannot reach fail every model call by name. Every claim
// runs the production engine, adapter and Ledger over the scripted fake.
import { normalizeContext } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import { experimental_readRawConfig } from "wrangler";
import { ChatEngine, type EngineCtx } from "../../packages/agent/src/chat/engine.ts";
import { admitPolicy, costMicros, isPriced } from "../../packages/agent/src/ledger/budget.ts";
import type { ModelCallRow } from "../../packages/agent/src/ledger/types.ts";
import { createStreamFn, embed } from "../../packages/agent/src/model/adapter.ts";
import { acceptsImages, CALL_BOUNDS, type ChatRoute, DEFAULT_TIER, GLM_WORKERS_AI, MODEL_TIERS, modelConfig, modelFor, MUSE_SPARK_CONTRIBUTOR, NO_VARS_MODELS, ROUTES, routeModel } from "../../packages/agent/src/model/routes.ts";
import { providerName, requestBody } from "../../packages/agent/src/model/transport.ts";
import { Ledger } from "../../packages/agent/src/objects/ledger.ts";
import { FakeModel, type FakeStep } from "../support/fake-model.ts";
import { harnessNamespace, ObjectHarness } from "../support/object-harness.ts";
import people from "../fixtures/people.json" with { type: "json" };

const sam = people.people.find((p) => p.id === "sam-solo")!;
const T0 = Date.UTC(2026, 9, 20, 9, 0, 0);

/** The vars the agent's base config ships, read with wrangler's own reader, as scripts/preview-plan.mjs does. */
const BASE_VARS = experimental_readRawConfig({ config: "packages/agent/wrangler.jsonc" }).rawConfig.vars as Record<string, string>;
/** A deploy of the base config as it ships: its own tenant and owner, the model vars untouched. */
const DEPLOY_VARS: Record<string, string> = { ...BASE_VARS, TENANT_ID: "base", OWNER_EMAIL: sam.email };
/** The same deploy with neither model var: Workers AI over the binding, no gateway. */
const { AI_GATEWAY_ID: _gateway, CHAT_PROVIDER: _provider, ...NO_MODEL_VARS } = DEPLOY_VARS;
const META_VARS = { ...DEPLOY_VARS, AI_GATEWAY_ID: "my-gateway", CHAT_PROVIDER: "meta" };

/** One chat turn through the production engine and Ledger, on an env with `vars`. */
async function turn(vars: Record<string, string>, script: FakeStep[] = [{ text: "Hello." }], fetch?: (input: string, init: RequestInit) => Promise<Response>) {
  const fake = new FakeModel(script);
  const ledgers = harnessNamespace((name) => new ObjectHarness(name, (ctx, env) => new Ledger(ctx as DurableObjectState, env as Env), { QYVR_ENV: vars.QYVR_ENV }));
  const env = { ...vars, AI: fetch ? { ...fake.binding, fetch } : fake.binding, LEDGER: ledgers.binding };
  const chat = new ObjectHarness("chat-sam", (ctx, e) => new ChatEngine(ctx as EngineCtx, e as Env), env, (c) => {
    c.now = () => T0;
    c.wait = async () => {};
  });
  const result = await chat.instance.send({ person: sam.email, text: "Hi" });
  return { fake, result, calls: () => ledgers.harness("base").instance.modelCalls() };
}

const embedOn = async (vars: Record<string, string>) => {
  const fake = new FakeModel([]);
  const rows: ModelCallRow[] = [];
  const out = await embed({ ai: fake.binding as unknown as Ai, ledger: { record: async (r) => void rows.push(r) }, now: () => T0, models: modelConfig(vars) }, { tenant: "base", person: sam.email, runId: "r" }, ["hello"]);
  return { fake, out, rows };
};

describe("[F1] the base config's models: Muse Spark for chat through the gateway qyvr", () => {
  it("the agent's config names the gateway qyvr and the chat provider meta, so chat is Muse Spark 1.3 Contributor and nothing falls back", () => {
    expect(BASE_VARS).toMatchObject({ AI_GATEWAY_ID: "qyvr", CHAT_PROVIDER: "meta" });
    const config = modelConfig(DEPLOY_VARS);
    expect(config).toEqual({ gatewayId: "qyvr", chatProvider: "meta" });
    expect(routeModel("chat", config)).toBe(MUSE_SPARK_CONTRIBUTOR);
    for (const route of ["compaction", "job", "subagent", "verifier", "caption"] as const) expect(routeModel(route, config), route).toBe(GLM_WORKERS_AI);
  });

  it("a chat turn on the shipped vars calls Muse Spark through the gateway qyvr's custom provider, and the Ledger row names Meta", async () => {
    const { fake, result, calls } = await turn(DEPLOY_VARS);
    expect(result).toMatchObject({ status: "done" });
    expect(fake.requests).toHaveLength(1);
    expect(fake.requests[0]?.model).toBe(MUSE_SPARK_CONTRIBUTOR);
    expect(fake.requests[0]?.passthrough).toMatchObject({ gatewayId: "qyvr", provider: "custom-meta", endpoint: "chat/completions" });
    expect((await calls()).map((r) => [r.model, r.provider, r.status])).toEqual([[MUSE_SPARK_CONTRIBUTOR, "meta", "ok"]]);
  });

  it("CHAT_PROVIDER=workers-ai over the shipped vars is the alternative: chat on GLM over the binding, still through the gateway", async () => {
    const vars = { ...DEPLOY_VARS, CHAT_PROVIDER: "workers-ai" };
    expect(modelConfig(vars)).toEqual({ gatewayId: "qyvr", chatProvider: "workers-ai" });
    const { fake, result, calls } = await turn(vars);
    expect(result).toMatchObject({ status: "done" });
    expect(fake.requests[0]?.model).toBe(GLM_WORKERS_AI);
    expect(fake.requests[0]?.passthrough).toBeUndefined();
    expect(fake.requests[0]?.options.gateway).toEqual({ id: "qyvr", collectLog: false });
    expect((await calls()).map((r) => [r.model, r.provider])).toEqual([[GLM_WORKERS_AI, "workers-ai"]]);
  });

  it("every route's model under the shipped vars and with neither var is priced and in the default tier, so turn one is never refused MODEL_UNPRICED", () => {
    for (const config of [modelConfig(DEPLOY_VARS), NO_VARS_MODELS]) {
      for (const route of ["chat", "compaction", "job", "subagent", "verifier", "caption"] as const) {
        const model = routeModel(route, config);
        expect(isPriced(model), `${route}: ${model}`).toBe(true);
        expect(admitPolicy({ modelTier: DEFAULT_TIER, disabled: [] }, { person: sam.email, runId: "r", model })).toEqual({ ok: true });
      }
    }
  });

  it("Meta's documented stream, usage null on every delta and the totals on a last chunk with no choices, writes those totals to the Ledger row", async () => {
    // The shape of Meta's Chat Completions stream with `stream_options.include_usage` as its reference documents it
    // (dev.meta.ai, read 2026-10-30): planted from the documentation, not a recording of a live call.
    const head = { id: "chatcmpl-doc", object: "chat.completion.chunk", created: 1_761_800_000, model: MUSE_SPARK_CONTRIBUTOR };
    const chunks = [
      { ...head, choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }], usage: null },
      { ...head, choices: [{ index: 0, delta: { content: "Hello" }, finish_reason: null }], usage: null },
      { ...head, choices: [{ index: 0, delta: { content: "." }, finish_reason: null }], usage: null },
      { ...head, choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: null },
      { ...head, choices: [], usage: { prompt_tokens: 1_234, completion_tokens: 56, total_tokens: 1_290 } },
    ];
    const body = `${chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("")}data: [DONE]\n\n`;
    const asked: string[] = [];
    const planted = async (input: string) => {
      asked.push(input);
      return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
    };
    const { result, calls } = await turn(DEPLOY_VARS, [], planted);
    expect(result).toMatchObject({ status: "done" });
    expect(asked).toEqual(["https://workers-binding.ai/ai-gateway/gateways/qyvr/custom-meta/chat/completions"]);
    const rows = await calls();
    expect(rows.map((r) => [r.provider, r.model, r.status, r.inputTokens, r.outputTokens])).toEqual([["meta", MUSE_SPARK_CONTRIBUTOR, "ok", 1_234, 56]]);
  });
});

describe("[F1] a deploy with neither model var", () => {
  it("is Workers AI with no gateway", () => {
    expect(NO_MODEL_VARS).not.toHaveProperty("AI_GATEWAY_ID");
    expect(NO_MODEL_VARS).not.toHaveProperty("CHAT_PROVIDER");
    expect(modelConfig(NO_MODEL_VARS)).toEqual(NO_VARS_MODELS);
    expect(NO_VARS_MODELS).toEqual({ gatewayId: null, chatProvider: "workers-ai" });
  });

  it("every route is Workers AI's, and every route's model is in the default tier", () => {
    for (const route of Object.keys(ROUTES) as ChatRoute[]) {
      expect(providerName(routeModel(route, NO_VARS_MODELS)), route).toBe("workers-ai");
      expect(modelFor(route, NO_VARS_MODELS).provider, route).toBe("cloudflare-workers-ai");
      expect(MODEL_TIERS.standard, route).toContain(ROUTES[route]);
    }
  });

  it("a chat turn calls Workers AI's GLM over the binding with no gateway option and no gateway passthrough", async () => {
    const { fake, result } = await turn(NO_MODEL_VARS);
    expect(result).toMatchObject({ status: "done" });
    expect(fake.requests).toHaveLength(1);
    expect(fake.requests[0]?.model).toBe(GLM_WORKERS_AI);
    expect(fake.requests[0]?.passthrough).toBeUndefined();
    expect(fake.requests[0]?.options).not.toHaveProperty("gateway");
  });

  it("an embedding call carries no gateway option", async () => {
    const { fake, out } = await embedOn(NO_MODEL_VARS);
    expect(out).toMatchObject({ ok: true });
    expect(fake.embeddingRequests[0]?.options).not.toHaveProperty("gateway");
  });
});

describe("[F1] a deploy that configures a gateway", () => {
  it("with AI_GATEWAY_ID alone, chat and embeddings stay on Workers AI and carry that gateway with logs off", async () => {
    const vars = { ...NO_MODEL_VARS, AI_GATEWAY_ID: "my-gateway" };
    const { fake, result } = await turn(vars);
    expect(result).toMatchObject({ status: "done" });
    expect(fake.requests[0]?.model).toBe(GLM_WORKERS_AI);
    expect(fake.requests[0]?.passthrough).toBeUndefined();
    expect(fake.requests[0]?.options.gateway).toEqual({ id: "my-gateway", collectLog: false });
    const embedded = await embedOn(vars);
    expect(embedded.fake.embeddingRequests[0]?.options.gateway).toEqual({ id: "my-gateway", collectLog: false });
  });

  it("CHAT_PROVIDER=meta puts chat on Muse Spark 1.3 Contributor as the gateway's custom provider: no key on the request, priced, in the default tier, taking images", async () => {
    const config = modelConfig(META_VARS);
    expect(config).toEqual({ gatewayId: "my-gateway", chatProvider: "meta" });
    const { fake, result, calls } = await turn(META_VARS, [{ text: "Hello.", usage: { prompt: 1_000, completion: 20, cached: 100 } }]);
    expect(result).toMatchObject({ status: "done" });
    const sent = fake.requests[0];
    expect(sent?.model).toBe(MUSE_SPARK_CONTRIBUTOR);
    // The custom provider's path: `custom-<slug>/<path>`, the path appended to the base URL https://api.meta.ai/v1,
    // with no provider key of its own (the gateway's stored key serves it) and the gateway's log collection off.
    expect(sent?.passthrough).toMatchObject({ gatewayId: "my-gateway", provider: "custom-meta", endpoint: "chat/completions" });
    expect(sent?.passthrough?.headers).not.toHaveProperty("authorization");
    expect(sent?.passthrough?.headers["cf-aig-collect-log"]).toBe("false");
    expect(sent?.inputs).toEqual({ model: MUSE_SPARK_CONTRIBUTOR, messages: expect.any(Array), tools: expect.any(Array), stream: true, stream_options: { include_usage: true }, reasoning_effort: "low" });
    expect(modelFor("chat", config)).toMatchObject({ provider: "meta", baseUrl: "binding:AI/gateway/meta", input: ["text", "image"] });
    expect(providerName(MUSE_SPARK_CONTRIBUTOR)).toBe("meta");
    expect(acceptsImages("chat", config)).toBe(true);
    expect(MODEL_TIERS.standard).toContain(MUSE_SPARK_CONTRIBUTOR);
    expect(admitPolicy({ modelTier: DEFAULT_TIER, disabled: [] }, { person: sam.email, runId: "r", model: MUSE_SPARK_CONTRIBUTOR })).toEqual({ ok: true });
    // The Ledger's row names Meta and is priced from Meta's own prices, never the unpriced fallback.
    const rows = await calls();
    expect(rows.map((r) => [r.model, r.provider, r.status])).toEqual([[MUSE_SPARK_CONTRIBUTOR, "meta", "ok"]]);
    expect(isPriced(MUSE_SPARK_CONTRIBUTOR)).toBe(true);
    expect(rows[0]?.costMicros).toBe(costMicros(MUSE_SPARK_CONTRIBUTOR, { input: 1_000, output: 20, cached: 100 }).micros);
    // Every other route stays on Workers AI.
    expect(routeModel("subagent", config)).toBe(GLM_WORKERS_AI);
    expect(routeModel("job", config)).toBe(GLM_WORKERS_AI);
  });

  it("Meta's request is Chat Completions with the flat reasoning_effort and usage in the stream, and nothing else", () => {
    expect(requestBody("chat", MUSE_SPARK_CONTRIBUTOR, { messages: [], tools: [] })).toEqual({ model: MUSE_SPARK_CONTRIBUTOR, messages: [], stream: true, stream_options: { include_usage: true }, reasoning_effort: "low" });
    const tools = [{ type: "function" as const, function: { name: "t", description: "d", parameters: {} } }];
    expect(requestBody("chat", MUSE_SPARK_CONTRIBUTOR, { messages: [], tools })).toEqual({ model: MUSE_SPARK_CONTRIBUTOR, messages: [], tools, stream: true, stream_options: { include_usage: true }, reasoning_effort: "low" });
    // Workers AI's body is the same without the model and the stream options.
    expect(requestBody("chat", GLM_WORKERS_AI, { messages: [], tools: [] })).toEqual({ messages: [], stream: true, reasoning_effort: "low" });
  });

  it("CHAT_PROVIDER is read trimmed and in any case", () => {
    expect(modelConfig({ AI_GATEWAY_ID: " g ", CHAT_PROVIDER: " Meta " })).toEqual({ gatewayId: "g", chatProvider: "meta" });
    expect(modelConfig({ AI_GATEWAY_ID: "g", CHAT_PROVIDER: "Workers-AI" })).toEqual({ gatewayId: "g", chatProvider: "workers-ai" });
    expect(modelConfig({ CHAT_PROVIDER: "  " })).toEqual(NO_VARS_MODELS);
  });

  it("a Muse answer whose model is named by a dated id is priced as the model asked for, not the unpriced fallback", async () => {
    const usage = { prompt: 2_000, completion: 50 };
    const { result, calls } = await turn(META_VARS, [{ text: "Hello.", usage, servedAs: "muse-spark-1.3-contributor-2026" }]);
    expect(result).toMatchObject({ status: "done" });
    const rows = await calls();
    expect(rows.map((r) => [r.model, r.provider])).toEqual([["muse-spark-1.3-contributor-2026", "meta"]]);
    expect(rows[0]?.costMicros).toBe(costMicros(MUSE_SPARK_CONTRIBUTOR, { input: 2_000, output: 50, cached: 0 }).micros);
  });

  it("the fake names a served id from every step shape that streams a whole answer, held and paused ones included", async () => {
    const served = "muse-spark-1.3-contributor-2026";
    const steps: FakeStep[] = [
      { toolCall: { name: "t", arguments: {} }, servedAs: served },
      { rawToolCall: { name: "t", arguments: "{}" }, servedAs: served },
      { toolCalls: [{ name: "t", arguments: {} }], servedAs: served },
      { hold: "h", step: { text: "held", servedAs: served } },
      { checkpoint: "c", step: { text: "paused", servedAs: served } },
    ];
    const fake = new FakeModel(steps);
    const ask = () => fake.binding.run(MUSE_SPARK_CONTRIBUTOR, { messages: [], stream: true }, { returnRawResponse: true });
    const body = (res: Response) => res.text();
    for (let i = 0; i < 3; i++) expect(await body(await ask())).toContain(`"model":"${served}"`);
    const held = ask();
    await fake.reached("h");
    fake.release("h");
    expect(await body(await held)).toContain(`"model":"${served}"`);
    const paused = await ask();
    await fake.reached("c");
    fake.release("c");
    expect(await body(paused)).toContain(`"model":"${served}"`);
  });
});

describe("[F1] model vars this deploy cannot serve are refused by name (D-0001)", () => {
  it("CHAT_PROVIDER=meta without AI_GATEWAY_ID fails the chat turn with MODEL_CONFIG_INVALID naming AI_GATEWAY_ID, and no model is called", async () => {
    const { fake, result, calls } = await turn({ ...NO_MODEL_VARS, CHAT_PROVIDER: "meta" });
    expect(result).toMatchObject({ status: "failed", code: "MODEL_CONFIG_INVALID" });
    expect((result as { detail: string }).detail).toContain("AI_GATEWAY_ID");
    expect(fake.requests).toHaveLength(0);
    // The row names what the vars asked for, Muse on Meta, not the Workers AI model the faulted config falls back to.
    expect((await calls()).map((r) => [r.status, r.code, r.startedAt, r.model, r.provider])).toEqual([["refused", "MODEL_CONFIG_INVALID", null, MUSE_SPARK_CONTRIBUTOR, "meta"]]);
  });

  it("a CHAT_PROVIDER this deploy does not know fails with MODEL_CONFIG_INVALID naming the var and the value, even with a gateway", async () => {
    const { fake, result, calls } = await turn({ ...DEPLOY_VARS, CHAT_PROVIDER: "openrouter" });
    expect(result).toMatchObject({ status: "failed", code: "MODEL_CONFIG_INVALID" });
    expect((result as { detail: string }).detail).toMatch(/CHAT_PROVIDER.*openrouter/);
    expect(fake.requests).toHaveLength(0);
    expect((await calls()).map((r) => [r.status, r.code, r.model, r.provider])).toEqual([["refused", "MODEL_CONFIG_INVALID", "unknown", "openrouter"]]);
  });

  it("a caller that hands the adapter Meta without a gateway is refused MODEL_CONFIG_INVALID before any network, and its row says so", async () => {
    const skipped = { gatewayId: null, chatProvider: "meta" } as const;
    const fake = new FakeModel([{ text: "never" }]);
    const rows: ModelCallRow[] = [];
    const chat = createStreamFn({ ai: fake.binding as unknown as Ai, ledger: { record: async (r) => void rows.push(r) }, wait: async () => {}, now: () => T0, models: skipped }, { tenant: "base", person: sam.email, runId: "c", route: "chat" });
    const message = await (await chat(modelFor("chat", skipped), normalizeContext({ messages: [{ role: "user", content: "hi", timestamp: T0 }] }), {})).result();
    expect(message.errorMessage).toMatch(/^MODEL_CONFIG_INVALID: Meta is reached only through an AI Gateway/);
    expect(fake.requests).toHaveLength(0);
    expect(rows.map((r) => [r.status, r.code, r.model, r.provider, r.startedAt])).toEqual([["refused", "MODEL_CONFIG_INVALID", MUSE_SPARK_CONTRIBUTOR, "meta", null]]);
  });

  it("the fault holds every route, embeddings included: none falls back to Workers AI", async () => {
    const bad = { ...NO_MODEL_VARS, CHAT_PROVIDER: "meta" };
    expect(modelConfig(bad)).toMatchObject({ chatProvider: "workers-ai", fault: { code: "MODEL_CONFIG_INVALID" } });
    const embedded = await embedOn(bad);
    expect(embedded.out).toMatchObject({ ok: false, code: "MODEL_CONFIG_INVALID" });
    expect(embedded.fake.embeddingRequests).toHaveLength(0);
    expect(embedded.rows.map((r) => [r.route, r.status, r.code])).toEqual([["embedding", "refused", "MODEL_CONFIG_INVALID"]]);
    const fake = new FakeModel([{ text: "never" }]);
    const jobRows: ModelCallRow[] = [];
    const job = createStreamFn({ ai: fake.binding as unknown as Ai, ledger: { record: async (r) => void jobRows.push(r) }, wait: async () => {}, now: () => T0, models: modelConfig(bad) }, { tenant: "base", person: sam.email, runId: "j", route: "job" });
    const message = await (await job(modelFor("job", modelConfig(bad)), normalizeContext({ messages: [{ role: "user", content: "hi", timestamp: T0 }] }), {})).result();
    expect(message.errorMessage).toMatch(/^MODEL_CONFIG_INVALID: /);
    expect(fake.requests).toHaveLength(0);
    // A job's row names the job route's own model: the vars asked nothing else for it.
    expect(jobRows.map((r) => [r.status, r.model, r.provider])).toEqual([["refused", GLM_WORKERS_AI, "workers-ai"]]);
  });
});

describe("[F1] with no fallback model, the chat route's total bound holds the whole call (D-0020)", () => {
  /** A chat call on `vars` whose clock moves only by the adapter's Retry-After waits (each `overrun` ms longer than asked); the test fires the bounds. */
  function chatCall(vars: Record<string, string>, script: FakeStep[], overrun = 0) {
    const fake = new FakeModel(script);
    const clock = { t: T0 };
    const timers: Array<{ f: () => void; ms: number; cancelled?: boolean }> = [];
    const schedule = (f: () => void, ms: number) => {
      const t: { f: () => void; ms: number; cancelled?: boolean } = { f, ms };
      timers.push(t);
      return () => {
        t.cancelled = true;
      };
    };
    const rows: ModelCallRow[] = [];
    const config = modelConfig(vars);
    const streamFn = createStreamFn(
      { ai: fake.binding as unknown as Ai, ledger: { record: async (r) => void rows.push(r) }, wait: async (ms) => {
        clock.t += ms + overrun;
      }, now: () => clock.t, schedule, models: config },
      { tenant: "base", person: sam.email, runId: "r", route: "chat" },
    );
    const result = (async () => (await streamFn(modelFor("chat", config), normalizeContext({ messages: [{ role: "user", content: "hi", timestamp: T0 }] }), {})).result())();
    const live = () => timers.filter((t) => !t.cancelled);
    return { fake, clock, rows, result, live };
  }
  const BOUNDS = CALL_BOUNDS.chat as { firstTokenMs: number; totalMs: number };

  it("on Meta, a run of 429s fails MODEL_RATE_LIMITED once the next Retry-After would pass the bound, not after the retries run out", async () => {
    const c = chatCall(META_VARS, [{ status: 429, retryAfter: 60 }, { status: 429, retryAfter: 60 }, { status: 429, retryAfter: 60 }, { text: "too late" }]);
    const message = await c.result;
    expect(message.errorMessage).toMatch(/^MODEL_RATE_LIMITED: .*would pass the call's 180000 ms bound/);
    expect(c.fake.requests).toHaveLength(3);
    expect(c.clock.t - T0).toBe(120_000);
    expect(c.clock.t - T0).toBeLessThan(BOUNDS.totalMs);
    expect(c.rows.map((r) => [r.attempt, r.status])).toEqual([[1, "rate_limited"], [2, "rate_limited"], [3, "rate_limited"]]);
  });

  it("on Workers AI, an attempt after a Retry-After wait gets only what is left of the bound", async () => {
    const c = chatCall(NO_MODEL_VARS, [{ status: 429, retryAfter: 50 }, { silent: true }]);
    await c.fake.requested(2);
    expect(c.fake.requests).toHaveLength(2);
    expect(c.live().map((t) => t.ms)).toEqual([BOUNDS.firstTokenMs, BOUNDS.totalMs - 50_000]);
    c.live().find((t) => t.ms === BOUNDS.totalMs - 50_000)?.f();
    const message = await c.result;
    expect(message.errorMessage).toMatch(/^MODEL_CALL_TIMEOUT: /);
    expect(c.rows.map((r) => [r.attempt, r.status, r.code])).toEqual([[1, "rate_limited", "MODEL_RATE_LIMITED"], [2, "failed", "MODEL_CALL_TIMEOUT"]]);
  });

  it("a wait that overran the Retry-After past the bound ends the call MODEL_CALL_TIMEOUT before another attempt is sent", async () => {
    // The 50 s wait asked for takes 190 s (an evicted isolate, a slow alarm): no time is left, so no second request.
    const c = chatCall(NO_MODEL_VARS, [{ status: 429, retryAfter: 50 }, { text: "too late" }], 140_000);
    const message = await c.result;
    expect(message.errorMessage).toMatch(/^MODEL_CALL_TIMEOUT: the call did not finish within 180000 ms/);
    expect(c.fake.requests).toHaveLength(1);
    expect(c.rows.map((r) => [r.attempt, r.status, r.code, r.startedAt])).toEqual([[1, "rate_limited", "MODEL_RATE_LIMITED", T0], [2, "failed", "MODEL_CALL_TIMEOUT", null]]);
  });
});
