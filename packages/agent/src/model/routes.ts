// Model routes (open-decisions.md D1): every route defaults to GLM 5.3 Flash on Workers AI, reached
// over the `AI` binding through the platform gateway; DeepSeek V4 Pro serves UAT and smoke. The
// sub-agent and verifier routes (M7.2) are D1's cheap model too, the verifier under a tight ceiling.
// From M22.1 (D1 amended 2026-10-15) the chat route's primary is the same model on OpenRouter, reached
// through the same binding's gateway with the BYOK key stored there, and Workers AI is its hedge.
import type { Model } from "@earendil-works/pi-ai";

export const GATEWAY_ID = "qyvr";

/** GLM 5.3 Flash on Workers AI: every route's model but chat's, and the chat route's hedge. */
export const GLM_WORKERS_AI = "@cf/zai-org/glm-5.3-flash";
/** GLM 5.3 Flash on OpenRouter (D1 amended): the chat route's primary. */
export const GLM_OPENROUTER = "z-ai/glm-5.3-flash";

export const ROUTES = {
  chat: GLM_OPENROUTER,
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

/**
 * Embeddings for semantic memory search (D1, M12.2): bge-base on Workers AI into Vectorize, with `cls`
 * pooling for index and query alike (the model's own advice; the two poolings do not compare).
 */
export const EMBEDDING_MODEL = "@cf/baai/bge-base-en-v1.5";
export const EMBEDDING_DIMENSIONS = 768;
export const EMBEDDING_POOLING = "cls";

/**
 * Models served by OpenRouter (M22.1): reached as a universal request through the binding's gateway,
 * never over a key in tenant code. Any other model id is Workers AI's.
 */
const OPENROUTER_MODELS: ReadonlySet<string> = new Set([GLM_OPENROUTER]);
export const isOpenRouter = (model: string): boolean => OPENROUTER_MODELS.has(model);
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
 */
export interface Hedge {
  model: string;
  delayMs: number;
}
export const HEDGES: Partial<Record<Route, Hedge>> = { chat: { model: GLM_WORKERS_AI, delayMs: 5_000 } };

/**
 * Model tiers a company policy picks from (M10.2): the models its members' agents may call. The
 * Ledger refuses a call to a model outside the tier before it is made. `standard` is every model a
 * route or a hedge names today, so the default changes nothing; `economy` is D1's default model
 * alone, GLM 5.3 Flash, on both hosts the chat route uses.
 */
export const MODEL_TIERS = {
  economy: [GLM_OPENROUTER, GLM_WORKERS_AI],
  standard: [...new Set<string>([...Object.values(ROUTES), ...Object.values(HEDGES).map((h) => h.model)])],
} as const satisfies Record<string, readonly string[]>;
export type ModelTier = keyof typeof MODEL_TIERS;
export const DEFAULT_TIER: ModelTier = "standard";
export const isModelTier = (t: unknown): t is ModelTier => typeof t === "string" && Object.hasOwn(MODEL_TIERS, t);

/** pi's API name for this adapter: OpenAI chat completions carried by the `AI` binding, to Workers AI or through its gateway. */
export const BINDING_API = "workers-ai-binding";

/** GLM 5.3 Flash's window is its model page's (fetched 2026-10-12); others take a conservative default. */
const CONTEXT_WINDOW: Record<string, number> = { [GLM_WORKERS_AI]: 1_048_576, [GLM_OPENROUTER]: 1_048_576 };
/**
 * Reasoning effort per route (M18.3), sent as `reasoning_effort` to Workers AI and as
 * `reasoning: { effort }` to OpenRouter (M22.1). GLM 5.3 Flash takes `low`, `high` or `max`, defaults
 * to `max` and cannot turn reasoning off (its model page, fetched 2026-10-15); a route absent here
 * sends none and keeps that default until its cost is measured.
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
 * both read 2026-10-16. A model absent here takes text alone, so an image never reaches one unasked.
 */
const MODEL_INPUT: Record<string, ReadonlyArray<"text" | "image">> = { [GLM_OPENROUTER]: ["text", "image"], [GLM_WORKERS_AI]: ["text", "image"] };
const inputOf = (model: string): Array<"text" | "image"> => [...(MODEL_INPUT[model] ?? ["text"])];
/** Whether a route's model, and its hedge's, take image input: an image goes to the model only then. */
export const acceptsImages = (route: ChatRoute): boolean => [ROUTES[route], HEDGES[route]?.model].every((m) => m === undefined || inputOf(m).includes("image"));

export function modelFor(route: ChatRoute): Model<typeof BINDING_API> {
  const id = ROUTES[route];
  return {
    id,
    name: id,
    api: BINDING_API,
    provider: isOpenRouter(id) ? "openrouter" : "cloudflare-workers-ai",
    baseUrl: isOpenRouter(id) ? "binding:AI/gateway/openrouter" : "binding:AI",
    input: inputOf(id),
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    reasoning: true,
    contextWindow: CONTEXT_WINDOW[id] ?? 131_072,
    maxTokens: MAX_TOKENS[route] ?? 16_384,
  };
}
