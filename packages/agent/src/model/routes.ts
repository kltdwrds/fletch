// Model routes (open-decisions.md D1): every route defaults to GLM 5.3 Flash on Workers AI, reached
// over the `AI` binding with no key; DeepSeek V4 Pro serves UAT and smoke. The sub-agent and verifier
// routes (M7.2) are D1's cheap model too, the verifier under a tight ceiling.
//
// How a deploy reaches models is its own configuration (`modelConfig`), never a hardcoded gateway: a
// self-host deploy (spec section 2, "Assumed") sends every route to Workers AI over the binding and no
// gateway option at all. Setting the `AI_GATEWAY_ID` var routes every call through that AI Gateway, and
// `CHAT_PROVIDER` with a gateway id moves the chat route's primary to that provider's one model, served
// with the BYOK key stored in the gateway for it, with Workers AI as its hedge (M22.1, D1 amended
// 2026-10-15): `openrouter` is GLM 5.3 Flash on OpenRouter; `meta` is Muse Spark 1.3 Contributor on Meta's
// own Model API, reached as the gateway's custom provider `meta` (2026-10-30, for the parity loop's tier-2
// runs). `CHAT_HEDGE = "off"` drops the hedge, so an eval of the configured model is answered by it alone.
import type { Model } from "@earendil-works/pi-ai";

/** GLM 5.3 Flash on Workers AI: every route's model by default, and the chat route's hedge under a gateway provider. */
export const GLM_WORKERS_AI = "@cf/zai-org/glm-5.3-flash";
/** GLM 5.3 Flash on OpenRouter (D1 amended): the chat route's primary under `CHAT_PROVIDER = "openrouter"`. */
export const GLM_OPENROUTER = "z-ai/glm-5.3-flash";
/**
 * Muse Spark 1.3 Contributor on Meta's Model API (dev.meta.ai, 2026-10-30): the model Muse runs, at
 * Contributor prices, in exchange for Meta training on what is sent. For the parity loop's evals, which
 * carry only `test/fixtures/people.json` identities, never a deploy whose owner has not agreed to that.
 * Meta redacts the reasoning text for API keys, so a turn on it shows no thinking.
 */
export const MUSE_SPARK_CONTRIBUTOR = "muse-spark-1.3-contributor";

/** Where the chat route's primary runs: Workers AI over the binding, or a provider the gateway holds a key for. */
export type ChatProvider = "workers-ai" | "openrouter" | "meta";
/** The one model each gateway provider serves; the chat route calls it under that `CHAT_PROVIDER`. */
export const PROVIDER_MODELS: Readonly<Record<Exclude<ChatProvider, "workers-ai">, string>> = Object.freeze({ openrouter: GLM_OPENROUTER, meta: MUSE_SPARK_CONTRIBUTOR });

/** How this deploy reaches models, read from its vars by `modelConfig`. */
export interface ModelConfig {
  /** The AI Gateway every call goes through; null sends no gateway option. */
  gatewayId: string | null;
  /** The chat route's primary: Workers AI, or a provider through the gateway's stored BYOK key. */
  chatProvider: ChatProvider;
  /** Whether the chat route races its hedge; off, the primary answers alone and its failure is the step's. */
  hedge: boolean;
}
/** A self-host deploy's models (spec section 2): Workers AI over the binding, no gateway, no key. */
export const SELF_HOST_MODELS: ModelConfig = Object.freeze({ gatewayId: null, chatProvider: "workers-ai", hedge: true });

/** The vars `modelConfig` reads; all optional, so a deploy that sets none is a self-host one. */
export interface ModelVars {
  AI_GATEWAY_ID?: string;
  CHAT_PROVIDER?: string;
  CHAT_HEDGE?: string;
}
/**
 * A deploy's model configuration from its vars. A gateway provider is reached only through a gateway (its
 * key is stored there, never in the Worker), so `CHAT_PROVIDER` without `AI_GATEWAY_ID` keeps the chat
 * route on Workers AI, as does a value this file does not know: a typo never sends a request anywhere.
 */
export function modelConfig(env: ModelVars): ModelConfig {
  const gatewayId = env.AI_GATEWAY_ID?.trim() || null;
  const named = env.CHAT_PROVIDER?.trim().toLowerCase() ?? "";
  const chatProvider: ChatProvider = gatewayId && Object.hasOwn(PROVIDER_MODELS, named) ? (named as ChatProvider) : "workers-ai";
  const hedge = env.CHAT_HEDGE?.trim().toLowerCase() !== "off";
  return { gatewayId, chatProvider, hedge };
}

/** Each route's model on a self-host deploy; `routeModel` applies a deploy's configuration. */
export const ROUTES = {
  chat: GLM_WORKERS_AI,
  compaction: GLM_WORKERS_AI,
  job: GLM_WORKERS_AI,
  subagent: GLM_WORKERS_AI,
  verifier: GLM_WORKERS_AI,
  /** The caption step (M24.3): words for an image the asking route's model cannot be shown. */
  caption: GLM_WORKERS_AI,
  smoke: "@cf/deepseek-ai/deepseek-v4-pro-0813",
} as const;
/** A generation route; `Route` adds the embedding route, which has no chat model and no tier. */
export type ChatRoute = keyof typeof ROUTES;
export type Route = ChatRoute | "embedding";

/** The model `route` calls under `config`: the configured provider's model for chat, else the route's own. */
export function routeModel(route: ChatRoute, config: ModelConfig = SELF_HOST_MODELS): string {
  return route === "chat" && config.chatProvider !== "workers-ai" ? PROVIDER_MODELS[config.chatProvider] : ROUTES[route];
}

/**
 * Embeddings for semantic memory search (D1, M12.2): bge-base on Workers AI into Vectorize, with `cls`
 * pooling for index and query alike (the model's own advice; the two poolings do not compare).
 */
export const EMBEDDING_MODEL = "@cf/baai/bge-base-en-v1.5";
export const EMBEDDING_DIMENSIONS = 768;
export const EMBEDDING_POOLING = "cls";

/**
 * The provider that serves a model (M22.1): a gateway provider's model is reached as a universal request
 * through the configured gateway, never over a key in tenant code; any other model id is Workers AI's.
 */
export function providerOf(model: string): ChatProvider {
  for (const [provider, m] of Object.entries(PROVIDER_MODELS)) if (m === model) return provider as ChatProvider;
  return "workers-ai";
}
/** pi's provider name for a model's host, as its messages and Ledger rows carry it. */
export const piProvider = (model: string): string => (providerOf(model) === "workers-ai" ? "cloudflare-workers-ai" : providerOf(model));
/**
 * OpenRouter's provider routing for the chat route (D1 amended): the fastest host first, and only
 * hosts that honour every parameter sent (`tools`, `reasoning`), so a host that would drop either is
 * never chosen. No `only` or `order` list: the M22.1 spike saw no host misbehave (DECISIONS-LOG).
 */
export const OPENROUTER_PROVIDER = { sort: "latency", require_parameters: true } as const;

/**
 * The hedge per route (M22.1): when the primary answers 408, 429 or 5xx, or gives no first token
 * within `delayMs`, the same request goes to `model`; the first stream to give a token is the turn's
 * and the other is aborted. `delayMs` starts at 5 s, about the 75th to 80th percentile of Workers AI's
 * first token on staging (proposals/2026-10-15-chat-latency-research.md) and above OpenRouter's p90.
 * A hedge applies only while the chat route's primary is OpenRouter and the deploy has not set
 * `CHAT_HEDGE = "off"`; on Workers AI there is nothing to hedge against.
 */
export interface Hedge {
  model: string;
  delayMs: number;
}
export const HEDGES: Partial<Record<Route, Hedge>> = { chat: { model: GLM_WORKERS_AI, delayMs: 5_000 } };
/** The hedge `route` races under `config`, if any. */
export function hedgeFor(route: Route, config: ModelConfig = SELF_HOST_MODELS): Hedge | undefined {
  const hedge = HEDGES[route];
  return hedge && route === "chat" && config.hedge && routeModel("chat", config) !== hedge.model ? hedge : undefined;
}

/**
 * Model tiers a company policy picks from (M10.2): the models its members' agents may call. The
 * Ledger refuses a call to a model outside the tier before it is made. `standard` is every model a
 * route, a hedge or a chat provider names today, so the default changes nothing; `economy` is D1's
 * default model alone, GLM 5.3 Flash, on both hosts the chat route may use.
 */
export const MODEL_TIERS = {
  economy: [GLM_OPENROUTER, GLM_WORKERS_AI],
  standard: [...new Set<string>([...Object.values(ROUTES), ...Object.values(PROVIDER_MODELS), ...Object.values(HEDGES).map((h) => h.model)])],
} as const satisfies Record<string, readonly string[]>;
export type ModelTier = keyof typeof MODEL_TIERS;
export const DEFAULT_TIER: ModelTier = "standard";
export const isModelTier = (t: unknown): t is ModelTier => typeof t === "string" && Object.hasOwn(MODEL_TIERS, t);

/** pi's API name for this adapter: OpenAI chat completions carried by the `AI` binding, to Workers AI or through a gateway. */
export const BINDING_API = "workers-ai-binding";

/**
 * GLM 5.3 Flash's window is its model page's (fetched 2026-10-12); Muse Spark 1.3 Contributor's is
 * Meta's model page (dev.meta.ai, fetched 2026-10-30); others take a conservative default.
 */
const CONTEXT_WINDOW: Record<string, number> = { [GLM_WORKERS_AI]: 1_048_576, [GLM_OPENROUTER]: 1_048_576, [MUSE_SPARK_CONTRIBUTOR]: 1_048_576 };
/**
 * Reasoning effort per route (M18.3), sent as `reasoning_effort` to Workers AI and to Meta, and as
 * `reasoning: { effort }` to OpenRouter (M22.1). GLM 5.3 Flash takes `low`, `high` or `max`, defaults
 * to `max` and cannot turn reasoning off (its model page, fetched 2026-10-15); Muse Spark takes `none`
 * to `xhigh` (`max` only on the standard tier; dev.meta.ai, 2026-10-30), so the chat route's `low` is
 * on both. A route absent here sends none and keeps the model's default until its cost is measured.
 */
export type ReasoningEffort = "low" | "high" | "max";
export const REASONING_EFFORT: Partial<Record<Route, ReasoningEffort>> = { chat: "low" };
/**
 * Time bounds per route (M19.1, QYVR-169), beside the effort they were measured at: a call with no first
 * token (reasoning, text or a tool call) within `firstTokenMs` is aborted with `MODEL_FIRST_TOKEN_TIMEOUT`,
 * and one not finished within `totalMs` with `MODEL_CALL_TIMEOUT`. A route named here also retries a
 * 408, a 5xx or a first-token timeout once, as its own Ledger row. Measured on staging at `low` effort
 * (DECISIONS-LOG M19.1): first tokens at 4.9 s and 14.2 s, calls of 4.4 s to 14.2 s; a route absent here waits
 * as long as Workers AI does until it is measured.
 */
export interface CallBounds {
  firstTokenMs: number;
  totalMs: number;
}
export const CALL_BOUNDS: Partial<Record<Route, CallBounds>> = { chat: { firstTokenMs: 45_000, totalMs: 180_000 } };
/** Output ceilings per route where the default is too generous: a verdict is a few lines, a caption a paragraph. */
const MAX_TOKENS: Partial<Record<Route, number>> = { verifier: 2_048, caption: 1_024 };

/**
 * What each model takes as input (M24.3): GLM 5.3 Flash takes images on both hosts, by OpenRouter's
 * model list (`input_modalities` text, image, video) and Workers AI's model page ("Vision: Yes"),
 * both read 2026-10-16; Muse Spark 1.3 Contributor takes `image_url` parts in user messages by Meta's
 * Chat Completions reference (dev.meta.ai, 2026-10-30). A model absent here takes text alone, so an
 * image never reaches one unasked.
 */
const MODEL_INPUT: Record<string, ReadonlyArray<"text" | "image">> = {
  [GLM_OPENROUTER]: ["text", "image"],
  [GLM_WORKERS_AI]: ["text", "image"],
  [MUSE_SPARK_CONTRIBUTOR]: ["text", "image"],
};
const inputOf = (model: string): Array<"text" | "image"> => [...(MODEL_INPUT[model] ?? ["text"])];
/** Whether a route's model, and its hedge's, take image input: an image goes to the model only then. */
export const acceptsImages = (route: ChatRoute, config: ModelConfig = SELF_HOST_MODELS): boolean =>
  [routeModel(route, config), hedgeFor(route, config)?.model].every((m) => m === undefined || inputOf(m).includes("image"));

export function modelFor(route: ChatRoute, config: ModelConfig = SELF_HOST_MODELS): Model<typeof BINDING_API> {
  const id = routeModel(route, config);
  return {
    id,
    name: id,
    api: BINDING_API,
    provider: piProvider(id),
    baseUrl: providerOf(id) === "workers-ai" ? "binding:AI" : `binding:AI/gateway/${providerOf(id)}`,
    input: inputOf(id),
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    reasoning: true,
    contextWindow: CONTEXT_WINDOW[id] ?? 131_072,
    maxTokens: MAX_TOKENS[route] ?? 16_384,
  };
}
