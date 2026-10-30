// Reading one model response into pi's events (moved out of the adapter at M22.1, unchanged in what it
// streams): the body guarded by the attempt's abort, the SSE chunks turned into text, thinking and
// tool-call blocks on the message, and the model the response says served it.
import type { AssistantMessage, AssistantMessageEvent, Usage } from "@earendil-works/pi-ai";
import { readSse, reasoningOf, StreamFault } from "./wire.ts";

export const zeroUsage = (): Usage => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } });

/** Where a response's events go: the turn's stream. */
export interface EventSink {
  push(event: AssistantMessageEvent): void;
}

/** What served a response, as its chunks say: the model, which a provider may name by a dated id of its own. */
export interface Served {
  model?: string;
}

/** Rejects with the signal's reason once it aborts, whether or not the binding honours the signal. */
export function abortable<T>(p: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    p.then(
      (v) => { signal.removeEventListener("abort", onAbort); resolve(v); },
      (e) => { signal.removeEventListener("abort", onAbort); reject(e); },
    );
  });
}

/** The body as a stream that errors the moment the signal aborts, and cancels the source with it. */
export function guarded(body: ReadableStream<Uint8Array>, signal: AbortSignal): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      const onAbort = () => {
        try { controller.error(signal.reason); } catch {}
        reader.cancel(signal.reason).catch(() => {});
      };
      if (signal.aborted) onAbort();
      else signal.addEventListener("abort", onAbort, { once: true });
    },
    async pull(controller) {
      const r = await reader.read().catch((e: unknown) => ({ error: e }) as const);
      try {
        if ("error" in r) controller.error(r.error);
        else if (r.done) controller.close();
        else controller.enqueue(r.value);
      } catch {
        // Already errored by the abort.
      }
    },
    cancel: (reason) => reader.cancel(reason),
  });
}

export function tapped(body: ReadableStream<Uint8Array>, tap: (raw: string) => void): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder();
  return body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        tap(decoder.decode(chunk, { stream: true }));
        controller.enqueue(chunk);
      },
    }),
  );
}

/**
 * Streams chunks into pi events on `message`; throws a StreamFault when the body breaks or the provider
 * reports an error inside the stream. `onFirstToken` runs at each delta that carries a token.
 */
export async function readInto(body: ReadableStream<Uint8Array>, message: AssistantMessage, stream: EventSink, onFirstToken: () => void, served: Served = {}): Promise<void> {
  let open: { kind: "text" | "thinking"; index: number } | undefined;
  const calls = new Map<number, { index: number; id: string; name: string; args: string }>();
  let finish: string | null | undefined;
  const close = () => {
    if (!open) return;
    const block = message.content[open.index];
    if (open.kind === "text" && block?.type === "text") stream.push({ type: "text_end", contentIndex: open.index, content: block.text, partial: message });
    if (open.kind === "thinking" && block?.type === "thinking") stream.push({ type: "thinking_end", contentIndex: open.index, content: block.thinking, partial: message });
    open = undefined;
  };
  const append = (kind: "text" | "thinking", delta: string) => {
    if (open?.kind !== kind) {
      close();
      message.content.push(kind === "text" ? { type: "text", text: "" } : { type: "thinking", thinking: "" });
      open = { kind, index: message.content.length - 1 };
      stream.push({ type: kind === "text" ? "text_start" : "thinking_start", contentIndex: open.index, partial: message });
    }
    const block = message.content[open.index];
    if (block?.type === "text") block.text += delta;
    if (block?.type === "thinking") block.thinking += delta;
    stream.push({ type: kind === "text" ? "text_delta" : "thinking_delta", contentIndex: open.index, delta, partial: message });
  };

  // Usage as GLM 5.3 Flash streams it over the binding (the recording in test/fixtures): each chunk
  // with `choices` counts its own tokens, so they add up, and reasoning tokens are the completion
  // tokens of chunks carrying reasoning text; a closing chunk without `choices` holds the totals.
  // A reported `reasoning_tokens` detail, where a model gives one, wins over the count.
  let reasoningCounted = 0;
  let reasoningReported: number | undefined;
  for await (const event of readSse(body)) {
    if (event.done) break;
    const { chunk } = event;
    if (chunk.error) throw new StreamFault("MODEL_STREAM_DROPPED", `the provider reported an error in the stream: ${String(chunk.error.message ?? chunk.error.code ?? "unknown").slice(0, 120)}`);
    if (chunk.model) served.model = chunk.model;
    const u = chunk.usage;
    if (u) {
      if (chunk.choices === undefined) {
        message.usage.input = u.prompt_tokens ?? message.usage.input;
        message.usage.output = u.completion_tokens ?? message.usage.output;
        message.usage.cacheRead = u.prompt_tokens_details?.cached_tokens ?? message.usage.cacheRead;
      } else {
        message.usage.input += u.prompt_tokens ?? 0;
        message.usage.output += u.completion_tokens ?? 0;
        message.usage.cacheRead += u.prompt_tokens_details?.cached_tokens ?? 0;
        if (chunk.choices.some((c) => c.delta && reasoningOf(c.delta))) reasoningCounted += u.completion_tokens ?? 0;
      }
      reasoningReported = u.completion_tokens_details?.reasoning_tokens ?? reasoningReported;
      message.usage.reasoning = reasoningReported ?? reasoningCounted;
      message.usage.totalTokens = message.usage.input + message.usage.output;
    }
    for (const choice of chunk.choices ?? []) {
      const d = choice.delta ?? {};
      const reasoning = reasoningOf(d);
      if (reasoning || d.content || d.tool_calls?.length) onFirstToken();
      if (reasoning) append("thinking", reasoning);
      if (d.content) append("text", d.content);
      for (const tc of d.tool_calls ?? []) {
        let call = calls.get(tc.index);
        if (!call) {
          close();
          message.content.push({ type: "toolCall", id: tc.id ?? `call_${tc.index}`, name: tc.function?.name ?? "", arguments: {} });
          call = { index: message.content.length - 1, id: tc.id ?? `call_${tc.index}`, name: tc.function?.name ?? "", args: "" };
          calls.set(tc.index, call);
          stream.push({ type: "toolcall_start", contentIndex: call.index, partial: message });
        }
        if (tc.function?.name && !call.name) call.name = tc.function.name;
        if (tc.function?.arguments) {
          call.args += tc.function.arguments;
          stream.push({ type: "toolcall_delta", contentIndex: call.index, delta: tc.function.arguments, partial: message });
        }
      }
      if (choice.finish_reason) finish = choice.finish_reason;
    }
  }
  close();
  for (const call of calls.values()) {
    const block = message.content[call.index];
    if (block?.type !== "toolCall") continue;
    block.name = call.name;
    const parsed = parseArguments(call.args);
    block.arguments = parsed.ok ? parsed.value : { [MALFORMED_ARGS_KEY]: parsed.reason };
    stream.push({ type: "toolcall_end", contentIndex: call.index, toolCall: block, partial: message });
  }
  message.stopReason = calls.size ? "toolUse" : finish === "length" ? "length" : "stop";
  message.rawStopReason = finish ?? undefined;
}

/**
 * Tool arguments that are not a JSON object are kept out of the tool: the call carries only the
 * parse reason under this key, and the turn loop refuses the call with `TOOL_ARGS_MALFORMED`.
 */
export const MALFORMED_ARGS_KEY = "__qyvr_malformed_arguments";

function parseArguments(raw: string): { ok: true; value: Record<string, never> } | { ok: false; reason: string } {
  try {
    const value = JSON.parse(raw === "" ? "{}" : raw);
    if (value === null || typeof value !== "object" || Array.isArray(value)) return { ok: false, reason: "arguments are not a JSON object" };
    return { ok: true, value };
  } catch (err) {
    return { ok: false, reason: `arguments are not JSON: ${(err as Error).message}` };
  }
}
