// Model routes (open-decisions.md D1): every route defaults to GLM 5.3 Flash on Workers AI, reached
// over the `AI` binding with no key; DeepSeek V4 Pro serves UAT and smoke. The sub-agent and verifier
// routes (M7.2) are D1's cheap model too, the verifier under a tight ceiling.
//
// How a deploy reaches models is its own configuration (`modelConfig`, D-0020), never a hardcoded gateway: a
// self-host deploy sends every route to Workers AI over the binding and no gateway option at all. Setting the
// `AI_GATEWAY_ID` var routes every call through that AI Gateway, and `CHAT_PROVIDER = "meta"` with it moves the
// chat route to Muse Spark 1.3 Contributor on Meta's own Model API, reached as the gateway's custom provider `meta`
// with the key stored on the gateway. There is no fallback model: a Spark failure is the turn's, by name. Vars that
// name something this deploy cannot reach fail every model call with `MODEL_CONFIG_INVALID`, never a quiet call to
// Workers AI instead.
import type { Model } from "@earendil-works/pi-ai";

/** GLM 5.3 Flash on Workers AI: every route's model by default. */
export const GLM_WORKERS_AI = "@cf/zai-org/glm-5.3-flash";
/**
 * Muse Spark 1.3 Contributor on Meta's Model API (dev.meta.ai, 2026-10-30): the model Muse runs, at
 * Contributor prices, in exchange for Meta training on what is sent. For the parity loop's evals, which
 * carry only `test/fixtures/people.json` identities, never a deploy whose owner has not agreed to that.
 * Meta redacts the reasoning text for API keys, so a turn on it shows no thinking.
 */
export const MUSE_SPARK_CONTRIBUTOR = "muse-spark-1.3-contributor";

/** Where the chat route runs: Workers AI over the binding, or Meta through the gateway's stored key. */
export type ChatProvider = "workers-ai" | "meta";

/** How this deploy reaches models, read from its vars by `modelConfig`. */
export interface ModelConfig {
  /** The AI Gateway every call goes through; null sends no gateway option. */
  gatewayId: string | null;
  /** The chat route's provider; `workers-ai` whenever `fault` is set, so nothing else branches on a bad config. */
  chatProvider: ChatProvider;
  /** Vars this deploy cannot serve: every model call fails with this before any network (D-0001, D-0020). */
  fault?: { code: "MODEL_CONFIG_INVALID"; reason: string };
}
/** A self-host deploy's models (spec section 2): Workers AI over the binding, no gateway, no key. */
export const SELF_HOST_MODELS: ModelConfig = Object.freeze({ gatewayId: null, chatProvider: "workers-ai" });

/** The vars `modelConfig` reads; both optional, so a deploy that sets neither is a self-host one. */
export interface ModelVars {
  AI_GATEWAY_ID?: string;
  CHAT_PROVIDER?: string;
}
/**
 * A deploy's model configuration from its vars; it never throws, since a Durable Object constructor that
 * throws is a 500 to the owner. `meta` is reached only through a gateway (its key is stored there, never in
 * the Worker), so `CHAT_PROVIDER=meta` without `AI_GATEWAY_ID`, or a provider this file does not know, is a
 * fault that names the var.
 */
export function modelConfig(env: ModelVars): ModelConfig {
  const gatewayId = env.AI_GATEWAY_ID?.trim() || null;
  const named = env.CHAT_PROVIDER?.trim().toLowerCase() ?? "";
  if (named === "" || named === "workers-ai") return { gatewayId, chatProvider: "workers-ai" };
  const fault = (reason: string): ModelConfig => ({ gatewayId, chatProvider: "workers-ai", fault: { code: "MODEL_CONFIG_INVALID", reason } });
  if (named !== "meta") return fault(`CHAT_PROVIDER is "${named.slice(0, 40)}"; it takes workers-ai or meta`);
  if (!gatewayId) return fault("CHAT_PROVIDER=meta is reached only through an AI Gateway, and AI_GATEWAY_ID is not set");
  return { gatewayId, chatProvider: "meta" };
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

/** The model `route` calls under `config`: Muse Spark for chat on Meta, else the route's own. */
export function routeModel(route: ChatRoute, config: ModelConfig = SELF_HOST_MODELS): string {
  return route === "chat" && config.chatProvider === "meta" ? MUSE_SPARK_CONTRIBUTOR : ROUTES[route];
}

/**
 * Embeddings for semantic memory search (D1, M12.2): bge-base on Workers AI into Vectorize, with `cls`
 * pooling for index and query alike (the model's own advice; the two poolings do not compare).
 */
export const EMBEDDING_MODEL = "@cf/baai/bge-base-en-v1.5";
export const EMBEDDING_DIMENSIONS = 768;
export const EMBEDDING_POOLING = "cls";

/** The provider that serves a model: Meta for Muse Spark, reached through the configured gateway; Workers AI for any other id. */
export const providerOf = (model: string): ChatProvider => (model === MUSE_SPARK_CONTRIBUTOR ? "meta" : "workers-ai");
/** pi's provider name for a model's host, as its messages carry it. */
export const piProvider = (model: string): string => (providerOf(model) === "workers-ai" ? "cloudflare-workers-ai" : providerOf(model));

/**
 * Model tiers a company policy picks from (M10.2): the models its members' agents may call. The
 * Ledger refuses a call to a model outside the tier before it is made. `standard` is every model a
 * route or the chat provider names today, so the default changes nothing; `economy` is D1's default
 * model alone, GLM 5.3 Flash on Workers AI.
 */
export const MODEL_TIERS = {
  economy: [GLM_WORKERS_AI],
  standard: [...new Set<string>([...Object.values(ROUTES), MUSE_SPARK_CONTRIBUTOR])],
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
const CONTEXT_WINDOW: Record<string, number> = { [GLM_WORKERS_AI]: 1_048_576, [MUSE_SPARK_CONTRIBUTOR]: 1_048_576 };
/**
 * Reasoning effort per route (M18.3), sent as `reasoning_effort` to Workers AI and to Meta alike. GLM
 * 5.3 Flash takes `low`, `high` or `max`, defaults to `max` and cannot turn reasoning off (its model page,
 * fetched 2026-10-15); Muse Spark takes `none` to `xhigh` (`max` only on the standard tier; dev.meta.ai,
 * 2026-10-30), so the chat route's `low` is on both. A route absent here sends none and keeps the model's default until its cost is measured.
 */
export type ReasoningEffort = "low" | "high" | "max";
export const REASONING_EFFORT: Partial<Record<Route, ReasoningEffort>> = { chat: "low" };
/**
 * Time bounds per route (M19.1, QYVR-169), beside the effort they were measured at: a call with no first
 * token (reasoning, text or a tool call) within `firstTokenMs` is aborted with `MODEL_FIRST_TOKEN_TIMEOUT`,
 * and one not finished within `totalMs` with `MODEL_CALL_TIMEOUT`. A route named here also retries a
 * 408, a 5xx or a first-token timeout once, as its own Ledger row. `totalMs` bounds the whole call, every
 * retry and Retry-After wait inside it (D-0020), so a turn ends inside it however many attempts it makes.
 * Measured on staging at `low` effort (DECISIONS-LOG M19.1): first tokens at 4.9 s and 14.2 s, calls of
 * 4.4 s to 14.2 s; a route absent here waits as long as Workers AI does until it is measured.
 */
export interface CallBounds {
  firstTokenMs: number;
  totalMs: number;
}
export const CALL_BOUNDS: Partial<Record<Route, CallBounds>> = { chat: { firstTokenMs: 45_000, totalMs: 180_000 } };
/** Output ceilings per route where the default is too generous: a verdict is a few lines, a caption a paragraph. */
const MAX_TOKENS: Partial<Record<Route, number>> = { verifier: 2_048, caption: 1_024 };

/**
 * What each model takes as input (M24.3): GLM 5.3 Flash takes images by Workers AI's model page
 * ("Vision: Yes", read 2026-10-16); Muse Spark 1.3 Contributor takes `image_url` parts in user messages
 * by Meta's Chat Completions reference (dev.meta.ai, 2026-10-30). A model absent here takes text alone, so an
 * image never reaches one unasked.
 */
const MODEL_INPUT: Record<string, ReadonlyArray<"text" | "image">> = {
  [GLM_WORKERS_AI]: ["text", "image"],
  [MUSE_SPARK_CONTRIBUTOR]: ["text", "image"],
};
const inputOf = (model: string): Array<"text" | "image"> => [...(MODEL_INPUT[model] ?? ["text"])];
/** Whether a route's model takes image input under `config`: an image goes to the model only then. */
export const acceptsImages = (route: ChatRoute, config: ModelConfig = SELF_HOST_MODELS): boolean => inputOf(routeModel(route, config)).includes("image");

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
