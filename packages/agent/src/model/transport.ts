// How a model is reached (D1, AD-11; M22.1 for OpenRouter, 2026-10-30 for Meta). Every path is the
// tenant's `AI` binding, so no token or provider key is in a tenant script:
// - Workers AI: `ai.run(model, inputs, { returnRawResponse })`, plus `{ gateway }` with the gateway's
//   log collection off only when the deploy configures `AI_GATEWAY_ID` (a self-host deploy does not).
// - A gateway provider: the configured gateway's provider-native path over the binding's fetch
//   passthrough, `https://workers-binding.ai/ai-gateway/gateways/<id>/<provider>/<endpoint>`, with no
//   provider authorization header, so the gateway serves it with the BYOK key stored for that provider
//   (credential precedence: a request's own key, then the stored `default` key, then Unified Billing),
//   and the binding needs no gateway token. OpenRouter is a built-in provider; Meta's Model API is the
//   gateway's custom provider `meta` (base URL https://api.meta.ai/v1, added in the dashboard), which
//   the gateway names `custom-meta`. Only a deploy that configures both a gateway and `CHAT_PROVIDER`
//   takes this path.
import { type ChatProvider, type ModelConfig, OPENROUTER_PROVIDER, providerOf, REASONING_EFFORT, type Route, SELF_HOST_MODELS } from "./routes.ts";
import type { WireMessage, WireTool } from "./wire.ts";

/** The gateway option a call carries under `config`: none unless the deploy configured a gateway. */
export function gatewayOption(config: ModelConfig = SELF_HOST_MODELS): { id: string; collectLog: false } | undefined {
  return config.gatewayId ? { id: config.gatewayId, collectLog: false } : undefined;
}
/**
 * Each gateway provider's path: the provider as the gateway names it, and the chat completions endpoint
 * appended to it (a custom provider's path is appended to its base URL, which for Meta already ends in
 * `/v1`).
 */
export const GATEWAY_REQUESTS: Readonly<Record<Exclude<ChatProvider, "workers-ai">, { provider: string; endpoint: string }>> = Object.freeze({
  openrouter: { provider: "openrouter", endpoint: "v1/chat/completions" },
  meta: { provider: "custom-meta", endpoint: "chat/completions" },
});

/** The binding's fetch passthrough (`workerd` `ai-api.ts`), which `@cloudflare/workers-types` does not declare. */
interface BindingFetch {
  fetch(input: string, init: RequestInit): Promise<Response>;
}

export interface RequestParts {
  messages: WireMessage[];
  tools: WireTool[];
  maxTokens?: number;
}

/**
 * The request body for `model` on `route`: the same messages and tools, each provider's spelling of
 * effort. Meta's Chat Completions (dev.meta.ai, 2026-10-30) takes the flat `reasoning_effort`, refuses
 * `tool_choice` other than `auto`, and documents no policy for unknown fields, so it is sent nothing
 * OpenRouter-shaped (`provider`, nested `reasoning`).
 */
export function requestBody(route: Route, model: string, parts: RequestParts): Record<string, unknown> {
  const effort = REASONING_EFFORT[route];
  const common = {
    messages: parts.messages,
    ...(parts.tools.length ? { tools: parts.tools } : {}),
    stream: true,
    ...(parts.maxTokens ? { max_tokens: parts.maxTokens } : {}),
  };
  const provider = providerOf(model);
  if (provider === "workers-ai") return { ...common, ...(effort ? { reasoning_effort: effort } : {}) };
  const streamed = { model, ...common, stream_options: { include_usage: true } };
  if (provider === "meta") return { ...streamed, ...(effort ? { reasoning_effort: effort } : {}) };
  return { ...streamed, ...(effort ? { reasoning: { effort } } : {}), provider: OPENROUTER_PROVIDER };
}

/** Sends one request; resolves with the provider's raw response, whatever its status. */
export function send(ai: Ai, model: string, body: Record<string, unknown>, signal: AbortSignal, config: ModelConfig = SELF_HOST_MODELS): Promise<Response> {
  const gateway = gatewayOption(config);
  const provider = providerOf(model);
  if (provider !== "workers-ai") {
    // `routeModel` names a gateway provider only with a gateway configured; this guards a caller that skipped it.
    if (!gateway) return Promise.reject(new Error(`MODEL_GATEWAY_UNSET: ${provider} is reached only through an AI Gateway; set AI_GATEWAY_ID`));
    const request = GATEWAY_REQUESTS[provider];
    // The gateway's provider-native path over the binding's fetch passthrough, pre-authenticated in-account: a
    // custom provider is served there and on `/compat`, not by the deprecated universal request, which answers
    // it with 502 (gateway error 2006). The `Ai` type does not declare `fetch` yet; it exists at run time.
    const url = `https://workers-binding.ai/ai-gateway/gateways/${gateway.id}/${request.provider}/${request.endpoint}`;
    const headers = { "content-type": "application/json", "cf-aig-collect-log": String(gateway.collectLog) };
    return (ai as unknown as BindingFetch).fetch(url, { method: "POST", headers, body: JSON.stringify(body), signal });
  }
  return ai.run(model as keyof AiModels, body as never, { ...(gateway ? { gateway } : {}), returnRawResponse: true, signal }) as unknown as Promise<Response>;
}

/** The serving provider a Ledger row names: OpenRouter's host as it reported it, else the provider itself. */
export function providerName(model: string, reported: string | undefined): string {
  const provider = providerOf(model);
  if (provider !== "openrouter") return provider;
  return reported ? `openrouter/${reported}` : "openrouter";
}
