// Agent spans in the shape Cloudflare's Agents dashboard reads, after upstream's span conventions
// (cloudflare-os `workshop-backend/src/agent-tracing.ts`, adoption A5): `invoke_agent` per turn,
// `chat` per model request, `execute_tool` per tool call and `tool_approval` when an action waits for
// a person and when it is decided. Attributes are identifiers, codes and token counts: never a prompt,
// a response, tool arguments or results, or anything a message said.
import { tracing } from "cloudflare:workers";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { AssistantMessage } from "@earendil-works/pi-ai";

type Attributes = Record<string, string | number | boolean | undefined>;

export const AGENT_NAME = "qyvr-agent";

/** Past Workers Observability's 64-byte span name budget, the bare operation; the target is on an attribute either way. */
export function spanName(operation: string, target?: string): string {
  if (target === undefined) return operation;
  const name = `${operation} ${target}`;
  return new TextEncoder().encode(name).length <= 64 ? name : operation;
}

const agent = (conversation: string | undefined): Attributes => ({ "gen_ai.agent.name": AGENT_NAME, "gen_ai.conversation.id": conversation });

/** One turn of a chat, in an `invoke_agent` span that ends when the turn settles. */
export function traceTurn<T>(t: { conversation?: string; turnId: string; model: string }, run: () => Promise<T>, outcome: (r: T) => string | null): Promise<T> {
  return tracing.enterSpan(spanName("invoke_agent", AGENT_NAME), async (span) => {
    span.setAttributes({ "gen_ai.operation.name": "invoke_agent", ...agent(t.conversation), "qyvr.turn.id": t.turnId, "gen_ai.request.model": t.model });
    try {
      const r = await run();
      const code = outcome(r);
      if (code) span.setAttribute("error.type", code);
      return r;
    } catch (err) {
      span.setAttribute("error.type", err instanceof Error ? err.name : typeof err);
      throw err;
    }
  });
}

/** Who a model request is for, as the Ledger row names it. */
export interface ChatSpanSubject {
  tenant: string;
  route: string;
  runId: string;
}

/**
 * One model request in a `chat` span that ends when its final message settles. The message's usage
 * and stop reason are read; its content never is. A failure carries the code the adapter wrote.
 */
export function traceChat(model: { id: string; provider: string }, who: ChatSpanSubject, start: () => { result(): Promise<AssistantMessage> }): void {
  tracing.startActiveSpan(spanName("chat", model.id), (span) => {
    span.setAttributes({
      "gen_ai.operation.name": "chat",
      "gen_ai.agent.name": AGENT_NAME,
      "gen_ai.provider.name": model.provider,
      "gen_ai.request.model": model.id,
      "qyvr.tenant": who.tenant,
      "qyvr.route": who.route,
      "qyvr.run.id": who.runId,
    });
    const settle = (m: AssistantMessage | null) => {
      if (m) {
        span.setAttributes({
          "gen_ai.usage.input_tokens": m.usage.input + m.usage.cacheRead + m.usage.cacheWrite,
          "gen_ai.usage.output_tokens": m.usage.output,
          "gen_ai.usage.cache_read.input_tokens": m.usage.cacheRead,
          "gen_ai.usage.cache_creation.input_tokens": m.usage.cacheWrite,
          "gen_ai.usage.reasoning.output_tokens": m.usage.reasoning,
          "cloudflare.agents.response.finish_reason": m.stopReason,
        });
        if (m.stopReason === "aborted") span.setAttribute("cloudflare.agents.canceled", true);
        // The adapter's error message starts with its stable code; the detail after it is never recorded.
        else if (m.stopReason === "error") span.setAttribute("error.type", codeOf(m.errorMessage));
      } else span.setAttribute("error.type", "_OTHER");
      span.end();
    };
    start().result().then(settle, () => settle(null));
  });
}

/** The stable code at the head of an adapter error message (`CODE: detail`); `_OTHER` when there is none. */
export function codeOf(message: string | undefined): string {
  const head = (message ?? "").split(":")[0] ?? "";
  return /^[A-Z][A-Z0-9_]{1,60}$/.test(head) ? head : "_OTHER";
}

/** Wraps `tool` so each execution runs in an `execute_tool` span; arguments and results stay out of it. */
export function traceTool<T extends AgentTool<never>>(tool: T, conversation?: string): T {
  return {
    ...tool,
    execute: (toolCallId: string, params: never, signal?: AbortSignal, onUpdate?: never) =>
      tracing.enterSpan(spanName("execute_tool", tool.name), async (span) => {
        span.setAttributes({ "gen_ai.operation.name": "execute_tool", ...agent(conversation), "gen_ai.tool.name": tool.name, "gen_ai.tool.call.id": toolCallId, "gen_ai.tool.type": "function" });
        try {
          return await tool.execute(toolCallId, params, signal, onUpdate);
        } catch (err) {
          span.setAttributes(signal?.aborted ? { "cloudflare.agents.canceled": true } : { "error.type": err instanceof Error ? err.name : typeof err });
          throw err;
        }
      }),
  } as T;
}

/** A zero-length `tool_approval` span: an action waiting for a person, then approved or denied. */
export function traceApproval(a: { conversation: string; tool: string; actionKind: string; state: "requested" | "approved" | "denied" }): void {
  tracing.enterSpan(spanName("tool_approval", a.tool), (span) =>
    span.setAttributes({
      "gen_ai.operation.name": "execute_tool",
      "cloudflare.agents.operation.name": "tool.approval",
      "cloudflare.agents.tool.approval.state": a.state,
      ...agent(a.conversation),
      "gen_ai.tool.name": a.tool,
      "gen_ai.tool.type": "function",
      "qyvr.action_kind": a.actionKind,
    }),
  );
}
