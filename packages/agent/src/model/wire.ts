// The wire format between pi's transcript and the OpenAI-compatible chat completions of Workers AI and
// OpenRouter: messages and tools out, SSE chunks in.
import type { Message, Tool } from "@earendil-works/pi-ai";

/** A content part of a user message: text, or an image as a data URL (M24.3, where the route's model takes images). */
export type WirePart = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };

export interface WireMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | WirePart[];
  tool_calls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }>;
  tool_call_id?: string;
}

export interface WireTool {
  type: "function";
  function: { name: string; description: string; parameters: unknown };
}

type Part = { type: string; text?: string; data?: string; mimeType?: string };
const textOf = (content: string | Part[]): string => (typeof content === "string" ? content : content.map((c) => (c.type === "text" ? (c.text ?? "") : "")).join(""));
const imagesOf = (content: string | Part[]): WirePart[] =>
  typeof content === "string" ? [] : content.flatMap((c) => (c.type === "image" && c.data && c.mimeType ? [{ type: "image_url" as const, image_url: { url: `data:${c.mimeType};base64,${c.data}` } }] : []));
/** A wire message's text alone, for a summary or a log: an image part is named, never inlined. */
export const wireText = (content: WireMessage["content"]): string => (typeof content === "string" ? content : content.map((p) => (p.type === "text" ? p.text : "[image]")).join(""));

/**
 * Converts pi messages in place, so a system message in the middle of the transcript (the per-turn
 * envelope) stays where it is. Tools are the leading system messages' declarations minus removals.
 * An image a tool returned cannot ride in a tool message, so it follows the step's tool messages as
 * one user message that names the call it came from (M24.3).
 */
export function toWire(messages: Message[]): { messages: WireMessage[]; tools: WireTool[] } {
  const out: WireMessage[] = [];
  const tools = new Map<string, Tool>();
  let toolImages: WirePart[] = [];
  const flush = () => {
    if (toolImages.length) out.push({ role: "user", content: toolImages });
    toolImages = [];
  };
  for (const m of messages) {
    if (m.role !== "toolResult") flush();
    switch (m.role) {
      case "system":
        for (const t of m.toolsAdded ?? []) tools.set(t.name, t);
        for (const t of m.toolsRemoved ?? []) tools.delete(t.name);
        if (textOf(m.content)) out.push({ role: "system", content: textOf(m.content) });
        break;
      case "user": {
        const images = imagesOf(m.content);
        out.push({ role: "user", content: images.length ? [{ type: "text", text: textOf(m.content) }, ...images] : textOf(m.content) });
        break;
      }
      case "assistant": {
        const calls = m.content.filter((c) => c.type === "toolCall");
        out.push({
          role: "assistant",
          content: m.content.map((c) => (c.type === "text" ? c.text : "")).join(""),
          ...(calls.length
            ? { tool_calls: calls.map((c) => ({ id: c.id, type: "function" as const, function: { name: c.name, arguments: JSON.stringify(c.arguments) } })) }
            : {}),
        });
        break;
      }
      case "toolResult": {
        out.push({ role: "tool", tool_call_id: m.toolCallId, content: textOf(m.content) });
        const images = imagesOf(m.content);
        if (images.length) toolImages.push({ type: "text", text: `The image${images.length > 1 ? "s" : ""} returned by tool call ${m.toolCallId}:` }, ...images);
        break;
      }
    }
  }
  flush();
  const wireTools = [...tools.values()].map((t) => ({ type: "function" as const, function: { name: t.name, description: t.description, parameters: t.parameters } }));
  return { messages: out, tools: wireTools };
}

/** One parsed `data:` event of the stream. */
export type SseEvent = { done: true } | { done: false; chunk: ChatChunk };

/** The readable reasoning of a delta: the plain fields, else the text and summary items of `reasoning_details`. */
export function reasoningOf(d: NonNullable<NonNullable<ChatChunk["choices"]>[number]["delta"]>): string {
  const plain = d.reasoning_content ?? d.reasoning;
  if (plain) return plain;
  let out = "";
  for (const item of d.reasoning_details ?? []) {
    if (item.type === "reasoning.text" && item.text) out += item.text;
    else if (item.type === "reasoning.summary" && item.summary) out += item.summary;
  }
  return out;
}

/** True when a delta carries only encrypted reasoning items: reasoning the provider withholds. */
export function reasoningWithheld(d: NonNullable<NonNullable<ChatChunk["choices"]>[number]["delta"]>): boolean {
  return !reasoningOf(d) && (d.reasoning_details ?? []).some((i) => i.type === "reasoning.encrypted");
}

export interface ChatChunk {
  /** OpenRouter: the host that served the call, on every chunk (openrouter.ai/docs, streaming). */
  provider?: string;
  /** The model that answered, as the provider names it. */
  model?: string;
  /** OpenRouter: an error after the stream started, sent as a chunk instead of a status. */
  error?: { code?: number | string; message?: string };
  /** Absent on the closing chunk, which carries the totals (and an empty `response`). */
  choices?: Array<{
    delta?: {
      content?: string | null;
      /** GLM 5.3 Flash's reasoning field, as recorded (M1.2); `reasoning` is the other OpenAI-compatible spelling. */
      reasoning_content?: string | null;
      reasoning?: string | null;
      /** OpenRouter's typed reasoning items (openrouter.ai/docs reasoning-tokens): text, summary, or encrypted (opaque, may read `[REDACTED]`). */
      reasoning_details?: Array<{ type?: string; text?: string | null; summary?: string | null; data?: string | null }> | null;
      tool_calls?: Array<{ index: number; id?: string | null; function?: { name?: string | null; arguments?: string | null } }>;
    };
    finish_reason?: string | null;
  }>;
  response?: string;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
    completion_tokens_details?: { reasoning_tokens?: number };
    /** OpenRouter: the call's cost in US dollars, and with a BYOK key the host's charge under `upstream_inference_cost`. */
    cost?: number;
    cost_details?: { upstream_inference_cost?: number | null } | null;
  };
}

/**
 * Reads an SSE body into events. A body that ends without `[DONE]` or throws mid-read rejects with
 * `MODEL_STREAM_DROPPED`; a `data:` line that is not JSON rejects with `MODEL_STREAM_UNPARSEABLE`.
 */
export async function* readSse(body: ReadableStream<Uint8Array>): AsyncGenerator<SseEvent> {
  const reader = body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    let next: ReadableStreamReadResult<string>;
    try {
      next = await reader.read();
    } catch (err) {
      throw new StreamFault("MODEL_STREAM_DROPPED", `stream broke after ${buffer.length} buffered chars: ${String(err)}`);
    }
    if (next.done) throw new StreamFault("MODEL_STREAM_DROPPED", "stream ended before [DONE]");
    buffer += next.value;
    let end = buffer.indexOf("\n\n");
    while (end >= 0) {
      const event = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      const data = event
        .split("\n")
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).trim())
        .join("\n");
      if (data === "[DONE]") {
        yield { done: true };
        return;
      }
      if (data) {
        try {
          yield { done: false, chunk: JSON.parse(data) as ChatChunk };
        } catch {
          throw new StreamFault("MODEL_STREAM_UNPARSEABLE", `data line is not JSON: ${data.slice(0, 80)}`);
        }
      }
      end = buffer.indexOf("\n\n");
    }
  }
}

export class StreamFault extends Error {
  readonly code: "MODEL_STREAM_DROPPED" | "MODEL_STREAM_UNPARSEABLE";

  constructor(code: "MODEL_STREAM_DROPPED" | "MODEL_STREAM_UNPARSEABLE", message: string) {
    super(`${code}: ${message}`);
    this.code = code;
  }
}
