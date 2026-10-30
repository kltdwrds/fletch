// F1: how a deploy reaches models. A self-host deploy (spec section 2, "Assumed") sends every route to
// Workers AI over the AI binding with no key and no AI Gateway option; a gateway is used only when the
// deploy sets `AI_GATEWAY_ID`, and a gateway provider (BYOK through that gateway: OpenRouter, or Meta's
// Model API as the custom provider `meta`) only when it also sets `CHAT_PROVIDER`. Every claim runs the production engine, adapter and Ledger over the
// scripted fake, with the vars the agent's base config ships (`pnpm self-host` adds a model var only when asked).
import { describe, expect, it } from "vitest";
import { experimental_readRawConfig } from "wrangler";
import { ChatEngine, type EngineCtx } from "../../packages/agent/src/chat/engine.ts";
import { admitPolicy, isPriced } from "../../packages/agent/src/ledger/budget.ts";
import { embed } from "../../packages/agent/src/model/adapter.ts";
import { acceptsImages, type ChatRoute, DEFAULT_TIER, hedgeFor, modelConfig, modelFor, MUSE_SPARK_CONTRIBUTOR, providerOf, ROUTES, routeModel, SELF_HOST_MODELS } from "../../packages/agent/src/model/routes.ts";
import { providerName, requestBody } from "../../packages/agent/src/model/transport.ts";
import { Ledger } from "../../packages/agent/src/objects/ledger.ts";
import { FakeModel } from "../support/fake-model.ts";
import { harnessNamespace, ObjectHarness } from "../support/object-harness.ts";
import people from "../fixtures/people.json" with { type: "json" };

const sam = people.people.find((p) => p.id === "sam-solo")!;
const T0 = Date.UTC(2026, 9, 20, 9, 0, 0);

/** The vars a deploy ships, read from packages/agent/wrangler.jsonc with wrangler's own reader, as scripts/preview-plan.mjs does. */
const TEMPLATE_VARS = experimental_readRawConfig({ config: "packages/agent/wrangler.jsonc" }).rawConfig.vars as Record<string, string>;
const SELF_HOST_VARS: Record<string, string> = { ...TEMPLATE_VARS, TENANT_ID: "base", OWNER_EMAIL: sam.email };

/** One chat turn through the production engine and Ledger, on an env with `vars`. */
async function turn(vars: Record<string, string>) {
  const fake = new FakeModel([{ text: "Hello." }]);
  const ledgers = harnessNamespace((name) => new ObjectHarness(name, (ctx, env) => new Ledger(ctx as DurableObjectState, env as Env), { QYVR_ENV: vars.QYVR_ENV }));
  const env = { ...vars, AI: fake.binding, LEDGER: ledgers.binding };
  const chat = new ObjectHarness("chat-sam", (ctx, e) => new ChatEngine(ctx as EngineCtx, e as Env), env, (c) => {
    c.now = () => T0;
    c.wait = async () => {};
  });
  const result = await chat.instance.send({ person: sam.email, text: "Hi" });
  return { fake, result };
}

describe("[F1] a self-host deploy's models", () => {
  it("the base config sets no gateway and no chat provider, so its config is Workers AI with no gateway", () => {
    expect(TEMPLATE_VARS).not.toHaveProperty("AI_GATEWAY_ID");
    expect(TEMPLATE_VARS).not.toHaveProperty("CHAT_PROVIDER");
    expect(modelConfig(SELF_HOST_VARS)).toEqual(SELF_HOST_MODELS);
    expect(SELF_HOST_MODELS).toEqual({ gatewayId: null, chatProvider: "workers-ai", hedge: true });
  });

  it("no route names a gateway provider's model and none hedges", () => {
    for (const route of Object.keys(ROUTES) as ChatRoute[]) {
      expect(providerOf(routeModel(route, SELF_HOST_MODELS)), route).toBe("workers-ai");
      expect(modelFor(route, SELF_HOST_MODELS).provider, route).toBe("cloudflare-workers-ai");
      expect(hedgeFor(route, SELF_HOST_MODELS), route).toBeUndefined();
    }
  });

  it("a chat turn calls Workers AI's GLM over the binding with no gateway option and no gateway passthrough", async () => {
    const { fake, result } = await turn(SELF_HOST_VARS);
    expect(result).toMatchObject({ status: "done" });
    expect(fake.requests).toHaveLength(1);
    expect(fake.requests[0]?.model).toBe("@cf/zai-org/glm-5.3-flash");
    expect(fake.requests[0]?.passthrough).toBeUndefined();
    expect(fake.requests[0]?.options).not.toHaveProperty("gateway");
  });

  it("an embedding call carries no gateway option", async () => {
    const fake = new FakeModel([]);
    const out = await embed({ ai: fake.binding as unknown as Ai, ledger: { record: async () => {} }, now: () => T0, models: modelConfig(SELF_HOST_VARS) }, { tenant: "base", person: sam.email, runId: "r" }, ["hello"]);
    expect(out).toMatchObject({ ok: true });
    expect(fake.embeddingRequests[0]?.options).not.toHaveProperty("gateway");
  });

  it("every default route's model is priced and in the default tier, so turn one is never refused MODEL_UNPRICED", () => {
    for (const route of ["chat", "compaction", "job", "subagent", "verifier", "caption"] as const) {
      const model = routeModel(route, SELF_HOST_MODELS);
      expect(isPriced(model), `${route}: ${model}`).toBe(true);
      expect(admitPolicy({ modelTier: DEFAULT_TIER, disabled: [] }, { person: sam.email, runId: "r", model })).toEqual({ ok: true });
    }
  });
});

describe("[F1] a deploy that configures a gateway", () => {
  it("with AI_GATEWAY_ID set, the chat turn stays on Workers AI and carries that gateway with logs off", async () => {
    const { fake, result } = await turn({ ...SELF_HOST_VARS, AI_GATEWAY_ID: "my-gateway" });
    expect(result).toMatchObject({ status: "done" });
    expect(fake.requests[0]?.model).toBe("@cf/zai-org/glm-5.3-flash");
    expect(fake.requests[0]?.options.gateway).toEqual({ id: "my-gateway", collectLog: false });
  });

  it("with AI_GATEWAY_ID and CHAT_PROVIDER=openrouter, chat goes to OpenRouter through that gateway, hedged to Workers AI", async () => {
    const vars = { ...SELF_HOST_VARS, AI_GATEWAY_ID: "my-gateway", CHAT_PROVIDER: "openrouter" };
    const { fake, result } = await turn(vars);
    expect(result).toMatchObject({ status: "done" });
    expect(fake.requests[0]?.model).toBe("z-ai/glm-5.3-flash");
    expect(fake.requests[0]?.passthrough).toMatchObject({ gatewayId: "my-gateway", provider: "openrouter", endpoint: "v1/chat/completions" });
    expect(hedgeFor("chat", modelConfig(vars))?.model).toBe("@cf/zai-org/glm-5.3-flash");
    // Every other route stays on Workers AI.
    expect(routeModel("job", modelConfig(vars))).toBe("@cf/zai-org/glm-5.3-flash");
  });

  it("CHAT_PROVIDER=openrouter without a gateway keeps chat on Workers AI: OpenRouter's key lives only in a gateway", async () => {
    expect(modelConfig({ CHAT_PROVIDER: "openrouter" })).toEqual(SELF_HOST_MODELS);
    const { fake } = await turn({ ...SELF_HOST_VARS, CHAT_PROVIDER: "openrouter" });
    expect(fake.requests[0]?.model).toBe("@cf/zai-org/glm-5.3-flash");
    expect(fake.requests[0]?.options).not.toHaveProperty("gateway");
  });

  it("CHAT_PROVIDER=meta puts chat on Muse Spark 1.3 Contributor as the gateway's custom provider: priced, in the default tier, taking images, hedged to Workers AI", async () => {
    const vars = { ...SELF_HOST_VARS, AI_GATEWAY_ID: "my-gateway", CHAT_PROVIDER: "meta" };
    const config = modelConfig(vars);
    expect(config).toEqual({ gatewayId: "my-gateway", chatProvider: "meta", hedge: true });
    expect(routeModel("chat", config)).toBe("muse-spark-1.3-contributor");
    const { fake, result } = await turn(vars);
    expect(result).toMatchObject({ status: "done" });
    expect(fake.requests[0]?.model).toBe("muse-spark-1.3-contributor");
    // The custom provider's path: `custom-<slug>/<path>`, the path appended to the base URL https://api.meta.ai/v1,
    // with no provider key of its own (the gateway's stored key serves it) and the gateway's log collection off.
    expect(fake.requests[0]?.passthrough).toMatchObject({ gatewayId: "my-gateway", provider: "custom-meta", endpoint: "chat/completions" });
    expect(fake.requests[0]?.passthrough?.headers).not.toHaveProperty("authorization");
    expect(fake.requests[0]?.options.gateway).toEqual({ id: "my-gateway", collectLog: false });
    expect(modelFor("chat", config)).toMatchObject({ provider: "meta", baseUrl: "binding:AI/gateway/meta", input: ["text", "image"] });
    expect(isPriced(MUSE_SPARK_CONTRIBUTOR)).toBe(true);
    expect(admitPolicy({ modelTier: DEFAULT_TIER, disabled: [] }, { person: sam.email, runId: "r", model: MUSE_SPARK_CONTRIBUTOR })).toEqual({ ok: true });
    expect(acceptsImages("chat", config)).toBe(true);
    expect(hedgeFor("chat", config)?.model).toBe("@cf/zai-org/glm-5.3-flash");
    // Every other route stays on Workers AI.
    expect(routeModel("subagent", config)).toBe("@cf/zai-org/glm-5.3-flash");
  });

  it("Meta's request is Chat Completions with the flat reasoning_effort and usage in the stream, and nothing OpenRouter-shaped", () => {
    const body = requestBody("chat", MUSE_SPARK_CONTRIBUTOR, { messages: [], tools: [], maxTokens: 100 });
    expect(body).toEqual({ model: MUSE_SPARK_CONTRIBUTOR, messages: [], stream: true, stream_options: { include_usage: true }, max_tokens: 100, reasoning_effort: "low" });
    expect(body).not.toHaveProperty("provider");
    expect(body).not.toHaveProperty("tool_choice");
    expect(providerName(MUSE_SPARK_CONTRIBUTOR, undefined)).toBe("meta");
  });

  it("a CHAT_PROVIDER this file does not know, or one without a gateway, keeps chat on Workers AI", () => {
    expect(modelConfig({ AI_GATEWAY_ID: "g", CHAT_PROVIDER: "openai" })).toEqual({ gatewayId: "g", chatProvider: "workers-ai", hedge: true });
    expect(modelConfig({ CHAT_PROVIDER: "meta" })).toEqual(SELF_HOST_MODELS);
  });

  it("CHAT_HEDGE=off drops the hedge: the configured model answers alone, and nothing changes on Workers AI", () => {
    const off = modelConfig({ AI_GATEWAY_ID: "g", CHAT_PROVIDER: "meta", CHAT_HEDGE: "off" });
    expect(off.hedge).toBe(false);
    expect(hedgeFor("chat", off)).toBeUndefined();
    expect(routeModel("chat", off)).toBe(MUSE_SPARK_CONTRIBUTOR);
    expect(hedgeFor("chat", modelConfig({ AI_GATEWAY_ID: "g", CHAT_PROVIDER: "openrouter", CHAT_HEDGE: "ON" }))?.model).toBe("@cf/zai-org/glm-5.3-flash");
    expect(modelConfig({ CHAT_HEDGE: "off" })).toEqual({ ...SELF_HOST_MODELS, hedge: false });
  });
});
