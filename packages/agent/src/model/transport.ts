// How a model is reached (D1, AD-11; D-0020). Every path is the tenant's `AI` binding, so no token or
// provider key is in a tenant script:
// - Workers AI: `ai.run(model, inputs, { returnRawResponse })`, plus `{ gateway }` with the gateway's
//   log collection off only when the deploy configures `AI_GATEWAY_ID` (the base config does).
// - Meta: the configured gateway's provider-native path over the binding's fetch passthrough,
//   `https://workers-binding.ai/ai-gateway/gateways/<id>/custom-meta/chat/completions`, with no provider
//   authorization header, so the gateway serves it with the BYOK key stored for that provider (credential
//   precedence: a request's own key, then the stored `default` key, then Unified Billing), and the binding
//   needs no gateway token. Meta's Model API is the gateway's custom provider `meta` (base URL
//   https://api.meta.ai/v1, added in the dashboard), which the gateway names `custom-meta`. Only a deploy
//   that configures both a gateway and `CHAT_PROVIDER=meta` takes this path.
import { type ChatProvider, type ModelConfig, NO_VARS_MODELS, providerOf, REASONING_EFFORT, type Route } from "./routes.ts";
import type { WireMessage, WireTool } from "./wire.ts";

/** The gateway option a call carries under `config`: none unless the deploy configured a gateway. */
export function gatewayOption(config: ModelConfig = NO_VARS_MODELS): { id: string; collectLog: false } | undefined {
  return config.gatewayId ? { id: config.gatewayId, collectLog: false } : undefined;
}
/**
 * Meta's path under a gateway: the custom provider as the gateway names it, then the chat completions
 * endpoint appended to its base URL, which already ends in `/v1`.
 */
export const META_GATEWAY_PATH = "custom-meta/chat/completions";

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
 * The request body for `model` on `route`: the same Chat Completions body for both providers, with the flat
 * `reasoning_effort`. Meta's (dev.meta.ai, 2026-10-30) also names the model and asks for usage in the stream;
 * it refuses `tool_choice` other than `auto` and documents no policy for unknown fields, so it is sent no more.
 */
export function requestBody(route: Route, model: string, parts: RequestParts): Record<string, unknown> {
  const effort = REASONING_EFFORT[route];
  const meta = providerOf(model) === "meta";
  return {
    ...(meta ? { model } : {}),
    messages: parts.messages,
    ...(parts.tools.length ? { tools: parts.tools } : {}),
    stream: true,
    ...(meta ? { stream_options: { include_usage: true } } : {}),
    ...(parts.maxTokens ? { max_tokens: parts.maxTokens } : {}),
    ...(effort ? { reasoning_effort: effort } : {}),
  };
}

/** A request this deploy's model configuration cannot send: refused by its code before any network (D-0001). */
export class ModelConfigInvalid extends Error {
  readonly code = "MODEL_CONFIG_INVALID";
}

/** Sends one request; resolves with the provider's raw response, whatever its status. */
export function send(ai: Ai, model: string, body: Record<string, unknown>, signal: AbortSignal, config: ModelConfig = NO_VARS_MODELS): Promise<Response> {
  const gateway = gatewayOption(config);
  if (providerOf(model) === "meta") {
    // `modelConfig` names Meta only with a gateway configured; this guards a caller that skipped it.
    if (!gateway) return Promise.reject(new ModelConfigInvalid("Meta is reached only through an AI Gateway; set AI_GATEWAY_ID"));
    // The gateway's provider-native path over the binding's fetch passthrough, pre-authenticated in-account: a
    // custom provider is served there and on `/compat`, not by the deprecated universal request, which answers
    // it with 502 (gateway error 2006). The `Ai` type does not declare `fetch` yet; it exists at run time.
    const url = `https://workers-binding.ai/ai-gateway/gateways/${gateway.id}/${META_GATEWAY_PATH}`;
    const headers = { "content-type": "application/json", "cf-aig-collect-log": String(gateway.collectLog) };
    return (ai as unknown as BindingFetch).fetch(url, { method: "POST", headers, body: JSON.stringify(body), signal });
  }
  return ai.run(model as keyof AiModels, body as never, { ...(gateway ? { gateway } : {}), returnRawResponse: true, signal }) as unknown as Promise<Response>;
}

/** The provider a Ledger row names: `workers-ai` or `meta`. */
export const providerName = (model: string): ChatProvider => providerOf(model);
