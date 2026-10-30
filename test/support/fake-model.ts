// The scripted fake model (testing-and-evals.md section 2) as a `FakeAi` binding shim: it stands in
// for `env.AI` and answers the adapter's `run(model, inputs, { returnRawResponse: true })` with an
// OpenAI chat-completions SSE response, recording every request.
//
// Derived from upstream's packages/integration-tests/src/mock-model.ts at 54d4685 (cloudflare-os,
// Apache-2.0): the step script, the SSE stream shape and the pending step. Changed here: a binding
// shim instead of an HTTPS handler (D1 chose the `AI` binding), reasoning deltas, raw malformed
// tool arguments, a 429 with Retry-After, a mid-stream drop after N bytes, named checkpoints with
// release and drop, usage growth, and the compromised and echo modes. The HTTPS form arrives with
// the first REST route and reads this script format.
//
// The stream's shape is the recorded GLM 5.3 Flash stream in test/fixtures/glm-5.3-flash.stream.sse
// (M1.2, through the AI binding and gateway qyvr on staging): a role chunk carrying the prompt
// tokens, then one chunk per delta whose `usage` counts that chunk's completion tokens, reasoning
// under the field the recording uses, a tool call's name before its arguments, a finish chunk, an
// empty `choices` chunk, and a closing chunk with no `choices` whose `usage` holds the totals and no
// reasoning detail. A step's `usage.reasoning` is spread over its reasoning chunks.
//
// From M22.1 the binding also answers its fetch passthrough to a gateway's provider-native path,
// `https://workers-binding.ai/ai-gateway/gateways/<gateway>/<provider>/<endpoint>`, the path the adapter
// takes to Meta, from the same script: the request is recorded with the model from its body and the path's
// gateway, provider, endpoint and the request headers under `passthrough`. Every chunk names the model
// asked for, or a text step's `servedAs` (a provider's dated id for it).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fakeEmbedding } from "./fake-embeddings.ts";

/** The embedding model the adapter asks for (D1, M12.2); answered with `fakeEmbedding`, not the script. */
export const FAKE_EMBEDDING_MODEL = "@cf/baai/bge-base-en-v1.5";

export interface FakeUsage {
  prompt?: number;
  completion?: number;
  reasoning?: number;
  cached?: number;
}

export interface FakeToolCall {
  id?: string;
  name: string;
  arguments: Record<string, unknown>;
}

export type FakeStep =
  /** `servedAs` is the model the chunks name instead of the one asked for (D-0020: a dated id is priced as the one asked). */
  | { text: string; reasoning?: string; usage?: FakeUsage; servedAs?: string }
  | { toolCall: FakeToolCall; text?: string; reasoning?: string; usage?: FakeUsage }
  | { rawToolCall: { id?: string; name: string; arguments: string }; usage?: FakeUsage }
  /** Several tool calls in one answer, in order (M25.2: a job answer with two terminal tools). */
  | { toolCalls: FakeToolCall[]; text?: string; usage?: FakeUsage }
  | { status: number; retryAfter?: number; message?: string }
  | { drop: { text: string; afterBytes: number } }
  /** A 200 whose body never sends a token and stays open until the request's signal aborts (M19.1). */
  | { silent: true }
  /** Streams the role chunk and first delta of `step`, then waits until `release(name)` or `drop(name)`. */
  | { checkpoint: string; step: FakeStep }
  /**
   * A 200 that sends nothing until `release(name)` streams all of `step`, or `drop(name)` breaks it
   * (the test decides when the first token arrives). Unlike a checkpoint, the script moves past it when
   * the request arrives.
   */
  | { hold: string; step: FakeStep }
  /** A step made from the request it answers: a model that copies what it was shown (M13's redaction scenario). */
  | { fromRequest: (request: FakeRequest) => FakeStep };

export interface FakeRequest {
  model: string;
  inputs: { messages: Array<{ role: string; content?: unknown; tool_calls?: unknown; tool_call_id?: string }>; tools?: unknown[]; stream?: boolean; [k: string]: unknown };
  options: { gateway?: { id: string; collectLog?: boolean; metadata?: unknown }; returnRawResponse?: boolean; [k: string]: unknown };
  /** Set when the request came through the binding's fetch passthrough to a gateway provider (M22.1). */
  passthrough?: { gatewayId: string; provider: string; endpoint: string; headers: Record<string, string> };
}

export type FakeMode = { kind: "scripted" } | { kind: "compromised"; hostile: FakeToolCall } | { kind: "echo" };

interface Waiter {
  release: () => void;
  drop: () => void;
}

const encoder = new TextEncoder();

/** The script ran out: a test asked for more model calls than it planned. */
export class FakeScriptExhausted extends Error {
  readonly code = "FAKE_SCRIPT_EXHAUSTED";
}

export class FakeModel {
  readonly requests: FakeRequest[] = [];
  /** Embedding calls, kept apart from chat requests: `requests` stays the count of generation calls. */
  readonly embeddingRequests: Array<{ texts: string[]; options: FakeRequest["options"] }> = [];
  /** When set, the next embedding calls throw this message, as a failed binding call would. */
  embeddingFault: string | null = null;
  private index = 0;
  private callCount = 0;
  private readonly waiters = new Map<string, Waiter[]>();
  private readonly arrivals = new Map<string, number>();
  private readonly arrivalListeners: Array<{ name: string; n: number; resolve: () => void }> = [];

  private readonly script: FakeStep[];
  private readonly mode: FakeMode;

  constructor(script: FakeStep[] = [], mode: FakeMode = { kind: "scripted" }) {
    this.script = script;
    this.mode = mode;
  }

  /** The object to put in `env.AI` (cast to `Ai` by the Worker test). Only the method the adapter uses exists. */
  get binding(): { run: (model: string, inputs: unknown, options: unknown) => Promise<Response>; fetch: (input: string, init: RequestInit) => Promise<Response> } {
    return {
      run: (model, inputs, options) => this.run(model, inputs, options),
      fetch: (input, init) => this.passthrough(input, init),
    };
  }

  /** A request through the binding's fetch passthrough to a gateway provider, answered from the same script as `run`. */
  private passthrough(input: string, init: RequestInit): Promise<Response> {
    const m = /^https:\/\/workers-binding\.ai\/ai-gateway\/gateways\/([^/]+)\/([^/]+)\/(.+)$/.exec(input);
    if (!m || init.method !== "POST" || typeof init.body !== "string") throw new Error(`FAKE_CONTRACT: the adapter posts JSON to a gateway provider's path, not ${init.method ?? "GET"} ${input}`);
    const [, gatewayId, provider, endpoint] = m as unknown as [string, string, string, string];
    const headers = { ...((init.headers ?? {}) as Record<string, string>) };
    const body = JSON.parse(init.body) as { model?: string };
    const passthrough = { gatewayId, provider, endpoint, headers };
    const options = { gateway: { id: gatewayId, collectLog: headers["cf-aig-collect-log"] === "true" }, returnRawResponse: true, signal: init.signal };
    return this.run(String(body.model), body, options, passthrough);
  }

  /** Appends steps to the script, so a test plans each call where it happens (M12.1). */
  enqueue(...steps: FakeStep[]): void {
    this.script.push(...steps);
  }

  /** Resolves when the `n`th request has arrived at checkpoint `name`. */
  reached(name: string, n = 1): Promise<void> {
    if ((this.arrivals.get(name) ?? 0) >= n) return Promise.resolve();
    return new Promise((resolve) => this.arrivalListeners.push({ name, n, resolve }));
  }

  /** Lets every request waiting at `name` finish its step, and moves the script past it. */
  release(name: string): void {
    const ws = this.take(name);
    const step = this.script[this.index];
    if (step && "checkpoint" in step && step.checkpoint === name) this.index++;
    for (const w of ws) w.release();
  }

  /** Breaks the stream of every request waiting at `name`; the step stays next in the script. */
  drop(name: string): void {
    for (const w of this.take(name)) w.drop();
  }

  get remaining(): number {
    return this.script.length - this.index;
  }

  private take(name: string): Waiter[] {
    const ws = this.waiters.get(name) ?? [];
    if (!ws.length) throw new Error(`FAKE_NO_WAITER: nothing is waiting at checkpoint ${name}`);
    this.waiters.delete(name);
    return ws;
  }

  private async run(model: string, inputs: unknown, options: unknown, passthrough?: FakeRequest["passthrough"]): Promise<Response> {
    if (model === FAKE_EMBEDDING_MODEL) return this.embed(inputs, options) as unknown as Response;
    const request = { model, inputs, options, ...(passthrough ? { passthrough } : {}) } as FakeRequest;
    this.requests.push(request);
    if (!request.options?.returnRawResponse || !request.inputs?.stream) {
      throw new Error("FAKE_CONTRACT: the adapter must ask for a raw streaming response");
    }
    const n = ++this.callCount;
    if (this.mode.kind === "compromised") return sse(toolCallChunks(this.mode.hostile, n), usageOf(request, undefined), headOf(request));
    if (this.mode.kind === "echo") return sse(textChunks(JSON.stringify(request.inputs.messages)), usageOf(request, undefined), headOf(request));
    const step = this.script[this.index];
    if (!step) throw new FakeScriptExhausted(`request ${n} has no scripted step`);
    if (!("checkpoint" in step)) this.index++;
    return this.respond(step, request, n);
  }

  /** Workers AI's embedding answer, `{ shape, data, pooling }`, never a raw response. */
  private embed(inputs: unknown, options: unknown): { shape: number[]; data: number[][]; pooling: string } {
    const i = inputs as { text?: unknown; pooling?: unknown };
    const texts = Array.isArray(i.text) ? i.text.map(String) : [String(i.text)];
    this.embeddingRequests.push({ texts, options: options as FakeRequest["options"] });
    if (this.embeddingFault) throw new Error(this.embeddingFault);
    if ((options as { returnRawResponse?: boolean })?.returnRawResponse) throw new Error("FAKE_CONTRACT: embeddings are answered as JSON");
    const data = texts.map(fakeEmbedding);
    return { shape: [data.length, data[0]?.length ?? 0], data, pooling: String(i.pooling ?? "mean") };
  }

  private respond(step: FakeStep, request: FakeRequest, n: number): Response {
    if ("status" in step) {
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (step.retryAfter !== undefined) headers["retry-after"] = String(step.retryAfter);
      return new Response(JSON.stringify({ errors: [{ message: step.message ?? `status ${step.status}` }] }), { status: step.status, headers });
    }
    if ("drop" in step) {
      const bytes = encoder.encode(sseBody(textChunks(step.drop.text), usageOf(request, undefined), headOf(request)));
      const cut = bytes.slice(0, step.drop.afterBytes);
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(cut);
          controller.error(new Error("network connection lost"));
        },
      });
      return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
    }
    if ("silent" in step) {
      const signal = request.options.signal as AbortSignal | undefined;
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          signal?.addEventListener("abort", () => controller.error(signal.reason), { once: true });
        },
      });
      return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
    }
    if ("checkpoint" in step) return this.paused(step.checkpoint, step.step, request, n);
    if ("hold" in step) return this.held(step.hold, step.step, request, n);
    if ("fromRequest" in step) return this.respond(step.fromRequest(request), request, n);
    return sse(chunksOf(step, n), usageOf(request, step.usage), { model: ("servedAs" in step && step.servedAs) || request.model });
  }

  private held(name: string, inner: FakeStep, request: FakeRequest, n: number): Response {
    if ("status" in inner || "drop" in inner || "silent" in inner || "checkpoint" in inner || "hold" in inner || "fromRequest" in inner) throw new Error("FAKE_SCRIPT: a hold wraps a streamed step");
    const whole = encoder.encode(sseBody(chunksOf(inner, n), usageOf(request, inner.usage), headOf(request)));
    const body = new ReadableStream<Uint8Array>({
      start: (controller) => {
        // A leg aborted while held has already errored its body; a later release or drop is a no-op.
        this.arrive(name, {
          release: () => {
            try {
              controller.enqueue(whole);
              controller.close();
            } catch {}
          },
          drop: () => {
            try {
              controller.error(new Error("network connection lost"));
            } catch {}
          },
        });
        const signal = request.options.signal as AbortSignal | undefined;
        signal?.addEventListener("abort", () => {
          try {
            controller.error(signal.reason);
          } catch {}
        }, { once: true });
      },
    });
    return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
  }

  /** Registers a waiter at `name` and wakes whoever waits for that many arrivals. */
  private arrive(name: string, waiter: Waiter): void {
    this.waiters.set(name, [...(this.waiters.get(name) ?? []), waiter]);
    const count = (this.arrivals.get(name) ?? 0) + 1;
    this.arrivals.set(name, count);
    for (const l of this.arrivalListeners.filter((x) => x.name === name && x.n <= count)) {
      this.arrivalListeners.splice(this.arrivalListeners.indexOf(l), 1);
      l.resolve();
    }
  }

  private paused(name: string, inner: FakeStep, request: FakeRequest, n: number): Response {
    if ("status" in inner || "drop" in inner || "silent" in inner || "checkpoint" in inner || "hold" in inner || "fromRequest" in inner) throw new Error("FAKE_SCRIPT: a checkpoint wraps a streamed step");
    // The role chunk and the first delta (a tool call's name, for a tool step) arrive before the pause.
    const chunks = streamChunks(chunksOf(inner, n), usageOf(request, inner.usage), headOf(request));
    const head = chunks.slice(0, 2).map(lineOf).join("");
    const tail = encoder.encode(`${chunks.slice(2).map(lineOf).join("")}data: [DONE]\n\n`);
    const body = new ReadableStream<Uint8Array>({
      start: (controller) => {
        controller.enqueue(encoder.encode(head));
        const waiter: Waiter = {
          release: () => {
            controller.enqueue(tail);
            controller.close();
          },
          drop: () => controller.error(new Error("network connection lost")),
        };
        this.arrive(name, waiter);
      },
    });
    return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
  }
}

// --- the recorded chat.completion.chunk stream ---------------------------------------------------

type Delta = Record<string, unknown>;
type Usage = { prompt: number; completion: number; reasoning: number; cached: number };
type Head = { model: string };

/** What each chunk names: the model asked for. */
function headOf(request: FakeRequest): Head {
  return { model: request.model };
}

/** The reasoning field of the recorded stream, read from the recording itself. */
export const RECORDED_STREAM = join(import.meta.dirname, "../fixtures/glm-5.3-flash.stream.sse");
export const REASONING_FIELD = reasoningFieldOf(readFileSync(RECORDED_STREAM, "utf8"));

function reasoningFieldOf(sse: string): string {
  for (const line of sse.split("\n")) {
    const data = line.startsWith("data:") ? line.slice(5).trim() : "";
    if (!data || data === "[DONE]") continue;
    for (const c of (JSON.parse(data) as { choices?: Array<{ delta?: Delta }> }).choices ?? []) {
      const field = Object.entries(c.delta ?? {}).find(([k, v]) => /reasoning/.test(k) && typeof v === "string" && v)?.[0];
      if (field) return field;
    }
  }
  throw new Error("FAKE_RECORDING: the recorded stream has no reasoning delta");
}

function chunksOf(step: Exclude<FakeStep, { status: number } | { drop: unknown } | { silent: true } | { checkpoint: string } | { hold: string } | { fromRequest: unknown }>, n: number): Delta[] {
  const out: Delta[] = [];
  if ("reasoning" in step && step.reasoning) out.push(...splitText(step.reasoning).map((t) => ({ [REASONING_FIELD]: t })));
  if ("text" in step && step.text) out.push(...textChunks(step.text));
  if ("toolCall" in step) out.push(...toolCallChunks(step.toolCall, n));
  if ("toolCalls" in step) for (const [i, c] of step.toolCalls.entries()) out.push(...rawToolCallChunks(c.id ?? `call_${n}_${i}`, c.name, JSON.stringify(c.arguments), i));
  if ("rawToolCall" in step) out.push(...rawToolCallChunks(step.rawToolCall.id ?? `call_${n}`, step.rawToolCall.name, step.rawToolCall.arguments));
  return out.length ? out : [{ content: "" }];
}

function textChunks(text: string): Delta[] {
  return splitText(text).map((t) => ({ content: t }));
}

function toolCallChunks(call: FakeToolCall, n: number): Delta[] {
  return rawToolCallChunks(call.id ?? `call_${n}`, call.name, JSON.stringify(call.arguments));
}

/** As recorded: the name with empty arguments, then the arguments in pieces with null id and name. */
function rawToolCallChunks(id: string, name: string, args: string, index = 0): Delta[] {
  const half = Math.ceil(args.length / 2);
  const call = (callId: string | null, callName: string | null, piece: string) => ({
    role: null, content: null, [REASONING_FIELD]: null,
    tool_calls: [{ id: callId, index, type: "function", function: { name: callName, arguments: piece } }],
  });
  return [call(id, name, ""), call(null, null, args.slice(0, half)), call(null, null, args.slice(half))];
}

function splitText(text: string): string[] {
  const words = text.split(/(?<= )/);
  return words.length ? words : [text];
}

function usageOf(request: FakeRequest, usage: FakeUsage | undefined): Usage {
  const reasoning = usage?.reasoning ?? 0;
  const completion = usage?.completion ?? 8 + reasoning;
  if (completion < reasoning) throw new Error("FAKE_SCRIPT: completion tokens include reasoning tokens, so cannot be fewer");
  return { prompt: usage?.prompt ?? Math.ceil(JSON.stringify(request.inputs.messages).length / 4), completion, reasoning, cached: usage?.cached ?? 0 };
}

const usageField = (prompt: number, completion: number, cached = 0) => ({
  prompt_tokens: prompt, completion_tokens: completion, total_tokens: prompt + completion, prompt_tokens_details: { cached_tokens: cached },
});

/** Splits `total` over `count` parts, the first taking the remainder. */
function spread(total: number, count: number): number[] {
  if (!count) return [];
  const each = Math.floor(total / count);
  return Array.from({ length: count }, (_, i) => each + (i === 0 ? total - each * count : 0));
}

/** Every chunk of one response in the recorded order, with per-chunk usage and closing totals. */
function streamChunks(deltas: Delta[], usage: Usage, served: Head): Record<string, unknown>[] {
  const head = { id: "fake", object: "chat.completion.chunk", created: 0, ...served };
  const choice = (delta: Delta, finish: string | null = null) => [{ index: 0, delta, logprobs: null, finish_reason: finish, matched_stop: null }];
  const isReasoning = (d: Delta) => typeof d[REASONING_FIELD] === "string" && d[REASONING_FIELD] !== "";
  const reasoningShares = spread(usage.reasoning, deltas.filter(isReasoning).length);
  const otherShares = spread(usage.completion - usage.reasoning, deltas.filter((d) => !isReasoning(d)).length);
  // A response of reasoning alone puts its other completion tokens on the last reasoning chunk.
  if (!otherShares.length && reasoningShares.length) reasoningShares[reasoningShares.length - 1] += usage.completion - usage.reasoning;
  const finish = deltas.some((d) => d.tool_calls) ? "tool_calls" : "stop";
  return [
    { ...head, choices: choice({ [REASONING_FIELD]: null, role: "assistant", content: "" }), usage: usageField(usage.prompt, 0, usage.cached) },
    ...deltas.map((d) => ({ ...head, choices: choice(d), usage: usageField(0, (isReasoning(d) ? reasoningShares : otherShares).shift() ?? 0) })),
    { ...head, choices: choice({ [REASONING_FIELD]: null }, finish), usage: usageField(0, 0) },
    { ...head, choices: [], usage: usageField(0, 0) },
    { response: "", usage: usageField(usage.prompt, usage.completion, usage.cached) },
  ];
}

const lineOf = (chunk: Record<string, unknown>) => `data: ${JSON.stringify(chunk)}\n\n`;

function sseBody(deltas: Delta[], usage: Usage, served: Head): string {
  return `${streamChunks(deltas, usage, served).map(lineOf).join("")}data: [DONE]\n\n`;
}

function sse(deltas: Delta[], usage: Usage, served: Head): Response {
  return new Response(sseBody(deltas, usage, served), { status: 200, headers: { "content-type": "text/event-stream" } });
}

/** A job run's terminal `report` (M25.2): a job's model step ends with it, never with bare text. */
export const report = (text: string, usage?: FakeUsage): FakeStep => ({ toolCall: { name: "report", arguments: { text } }, ...(usage ? { usage } : {}) });
