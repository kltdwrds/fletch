// How a model is reached (D1, AD-11; M22.1 for OpenRouter). Both paths are the tenant's `AI` binding,
// so no token or provider key is in a tenant script:
// - Workers AI: `ai.run(model, inputs, { returnRawResponse })`, plus `{ gateway }` with the gateway's
//   log collection off only when the deploy configures `AI_GATEWAY_ID` (a self-host deploy does not).
// - OpenRouter: the configured gateway as a universal request, `ai.gateway(id).run({ provider:
//   "openrouter", ... })`, with no provider authorization header, so the gateway serves it with the
//   BYOK key stored for OpenRouter (credential precedence: a request's own key, then the stored
//   `default` key, then Unified Billing), and the binding needs no gateway token. Only a deploy that
//   configures both a gateway and `CHAT_PROVIDER = "openrouter"` takes this path.
import { isOpenRouter, type ModelConfig, OPENROUTER_PROVIDER, REASONING_EFFORT, type Route, SELF_HOST_MODELS } from "./routes.ts";
import type { WireMessage, WireTool } from "./wire.ts";

/** The gateway option a call carries under `config`: none unless the deploy configured a gateway. */
export function gatewayOption(config: ModelConfig = SELF_HOST_MODELS): { id: string; collectLog: false } | undefined {
  return config.gatewayId ? { id: config.gatewayId, collectLog: false } : undefined;
}
/** The universal request's endpoint for OpenRouter's chat completions, appended to the provider's gateway path. */
export const OPENROUTER_ENDPOINT = "v1/chat/completions";

export interface RequestParts {
  messages: WireMessage[];
  tools: WireTool[];
  maxTokens?: number;
}

/** The request body for `model` on `route`: the same messages and tools, each provider's spelling of effort. */
export function requestBody(route: Route, model: string, parts: RequestParts): Record<string, unknown> {
  const effort = REASONING_EFFORT[route];
  const common = {
    messages: parts.messages,
    ...(parts.tools.length ? { tools: parts.tools } : {}),
    stream: true,
    ...(parts.maxTokens ? { max_tokens: parts.maxTokens } : {}),
  };
  if (!isOpenRouter(model)) return { ...common, ...(effort ? { reasoning_effort: effort } : {}) };
  return {
    model,
    ...common,
    stream_options: { include_usage: true },
    ...(effort ? { reasoning: { effort } } : {}),
    provider: OPENROUTER_PROVIDER,
  };
}

/** Sends one request; resolves with the provider's raw response, whatever its status. */
export function send(ai: Ai, model: string, body: Record<string, unknown>, signal: AbortSignal, config: ModelConfig = SELF_HOST_MODELS): Promise<Response> {
  const gateway = gatewayOption(config);
  if (isOpenRouter(model)) {
    // `routeModel` names OpenRouter only with a gateway configured; this guards a caller that skipped it.
    if (!gateway) return Promise.reject(new Error("MODEL_GATEWAY_UNSET: OpenRouter is reached only through an AI Gateway; set AI_GATEWAY_ID"));
    return ai.gateway(gateway.id).run(
      { provider: "openrouter", endpoint: OPENROUTER_ENDPOINT, headers: { "content-type": "application/json" }, query: body },
      // The universal options' type keeps `id` required (it removes nothing from an object type); the
      // gateway is the one `gateway()` names, so the same option as Workers AI's is passed.
      { gateway, signal },
    );
  }
  return ai.run(model as keyof AiModels, body as never, { ...(gateway ? { gateway } : {}), returnRawResponse: true, signal }) as unknown as Promise<Response>;
}

/** The serving provider a Ledger row names: OpenRouter's host as it reported it, else Workers AI. */
export function providerName(model: string, reported: string | undefined): string {
  if (!isOpenRouter(model)) return "workers-ai";
  return reported ? `openrouter/${reported}` : "openrouter";
}
