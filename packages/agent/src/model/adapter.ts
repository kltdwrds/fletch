// The model adapter (KICKOFF "Model calls through the adapter only"): the one place a model is
// called. It is pi's `StreamFn` over the `AI` binding, through an AI Gateway with `collectLog: false`
// only when the deploy configures one (AD-11, `ModelConfig`), retries a 429 after Retry-After, reports a broken stream as a failed call, and writes a
// Ledger row for every attempt. Per pi's contract it never throws: failures end the stream with
// an `error` event whose message starts with a stable code.
//
// From M19.1 (QYVR-169) a route with bounds in `CALL_BOUNDS` is aborted when its first token or its
// end is late, and a 408, 5xx or first-token timeout before any token is retried once, each attempt
// its own Ledger row; a route without bounds waits as long as Workers AI does. A route's total bound
// holds the whole call, retries and Retry-After waits included (D-0020).
//
// A model is reached through `transport.ts`: Workers AI over the binding, or Meta through the configured
// gateway with its stored BYOK key. There is no second model behind either (D-0020), and a deploy whose
// model vars are invalid has every call fail with `MODEL_CONFIG_INVALID` before any network.
import {
  type AssistantMessage,
  type AssistantMessageEventStream,
  createAssistantMessageEventStream,
  type Model,
  type TranscriptContext,
} from "@earendil-works/pi-ai";
import type { StreamFn } from "@earendil-works/pi-agent-core";
import type { CallStatus, LedgerSink, ModelCallRow } from "../ledger/types.ts";
import { CALL_BOUNDS, EMBEDDING_DIMENSIONS, EMBEDDING_MODEL, EMBEDDING_POOLING, type ModelConfig, type Route } from "./routes.ts";
import { abortable, guarded, readInto, type Served, tapped, zeroUsage } from "./read.ts";
import { gatewayOption, ModelConfigInvalid, providerName, requestBody, send } from "./transport.ts";
import { StreamFault, toWire } from "./wire.ts";
import { traceChat } from "../obs/spans.ts";

export { MALFORMED_ARGS_KEY } from "./read.ts";
export { gatewayOption } from "./transport.ts";

export interface CallAttribution {
  tenant: string;
  person: string;
  runId: string;
  route: Route;
  /** The job run's token ceiling, checked by the Ledger before each call (M5.1). */
  ceiling?: number;
}

export interface AdapterDeps {
  ai: Ai;
  ledger: LedgerSink;
  /** Waits before a retry; injected so tests own the clock instead of sleeping. */
  wait: (ms: number) => Promise<void>;
  now: () => number;
  /** Runs `fn` after `ms` and returns its cancel; injected so tests fire a bound without waiting. Defaults to `setTimeout`. */
  schedule?: (fn: () => void, ms: number) => () => void;
  /** Sees the raw stream text as it arrives; only the staging stream recording sets it. */
  tap?: (raw: string) => void;
  /** How the deploy reaches models (`modelConfig(env)`); absent, a self-host deploy's: Workers AI, no gateway. */
  models?: ModelConfig;
}

/** Retries after a 429 before the call fails; a Retry-After above the cap fails at once. */
export const MAX_RATE_LIMIT_RETRIES = 3;
export const MAX_RETRY_AFTER_MS = 60_000;
/** Retries of a bounded route's 408, 5xx or first-token timeout before any token (M19.1). */
export const MAX_TRANSIENT_RETRIES = 1;

export function createStreamFn(deps: AdapterDeps, who: CallAttribution): StreamFn {
  return (model, context, options) => {
    const stream = createAssistantMessageEventStream();
    // One `chat` span per model request, ended when its final message settles (M15.3).
    traceChat(model, who, () => stream);
    callModel(deps, who, model, context, options?.signal, options?.maxTokens, stream).catch((err) => {
      // Unreachable by design (every path above ends the stream); kept so a bug cannot hang a turn.
      const message = { role: "assistant", content: [], api: model.api, provider: model.provider, model: model.id, usage: zeroUsage(), stopReason: "error", errorMessage: `MODEL_ADAPTER_BUG: ${String(err)}`, timestamp: deps.now() } satisfies AssistantMessage;
      stream.push({ type: "error", reason: "error", error: message });
      stream.end(message);
    });
    return stream;
  };
}


/** Parses Retry-After as seconds or an HTTP date; undefined when absent or unreadable. */
export function retryAfterMs(header: string | null, now: number): number | undefined {
  if (!header) return undefined;
  if (/^\d+$/.test(header.trim())) return Number(header.trim()) * 1000;
  const at = Date.parse(header);
  return Number.isNaN(at) ? undefined : Math.max(0, at - now);
}

async function callModel(
  deps: AdapterDeps,
  who: CallAttribution,
  model: Model<string>,
  context: TranscriptContext,
  signal: AbortSignal | undefined,
  maxTokens: number | undefined,
  stream: AssistantMessageEventStream,
): Promise<void> {
  const wire = toWire(context.messages);
  const message: AssistantMessage = {
    role: "assistant",
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: zeroUsage(),
    stopReason: "stop",
    timestamp: deps.now(),
  };
  // The clock of the attempt in flight (M18.3): reset before each attempt, so a refusal after a retry
  // never inherits the earlier attempt's start.
  const timing: { startedAt: number | null; firstTokenAt: number | null } = { startedAt: null, firstTokenAt: null };
  let served: Served = {};
  const row = (attempt: number, status: CallStatus, code: string | null, httpStatus: number | null): ModelCallRow => ({
    tenant: who.tenant,
    person: who.person,
    runId: who.runId,
    route: who.route,
    model: served.model ?? model.id,
    ...(served.model !== undefined && served.model !== model.id ? { asked: model.id } : {}),
    provider: providerName(model.id),
    attempt,
    status,
    code,
    httpStatus,
    inputTokens: message.usage.input,
    outputTokens: message.usage.output,
    reasoningTokens: message.usage.reasoning ?? 0,
    cachedTokens: message.usage.cacheRead,
    at: deps.now(),
    startedAt: timing.startedAt,
    firstTokenAt: timing.firstTokenAt,
    finishedAt: timing.startedAt === null ? null : deps.now(),
  });
  // A Ledger that cannot take the row fails the call: a call nobody accounted for is not a success.
  const record = (r: ModelCallRow) => deps.ledger.record(r).then(() => true, () => false);
  const end = (code: string, detail: string) => {
    message.stopReason = signal?.aborted ? "aborted" : "error";
    message.errorMessage = `${code}: ${detail}`;
    stream.push({ type: "error", reason: message.stopReason, error: message });
    stream.end(message);
  };
  const fail = async (attempt: number, status: CallStatus, code: string, detail: string, httpStatus: number | null, names?: { model: string; provider: string }) => {
    const recorded = await record({ ...row(attempt, status, code, httpStatus), ...names });
    end(code, recorded ? detail : `${detail}; LEDGER_UNAVAILABLE: the row was not written`);
  };

  // A deploy whose model vars name what it cannot reach never calls a model, and never another one instead.
  // Its chat row names what the vars asked for, not the Workers AI model the faulted config falls back to.
  const fault = deps.models?.fault;
  if (fault) return fail(1, "refused", fault.code, fault.reason, null, who.route === "chat" ? { model: fault.model, provider: fault.provider } : undefined);
  const inputs = requestBody(who.route, model.id, { messages: wire.messages, tools: wire.tools, ...(maxTokens ? { maxTokens } : {}) });
  const bounds = CALL_BOUNDS[who.route];
  // The total bound is the call's, not each attempt's: every attempt and every wait between them ends by it.
  const deadline = bounds ? deps.now() + bounds.totalMs : Number.POSITIVE_INFINITY;
  const schedule = deps.schedule ?? ((fn: () => void, ms: number) => {
    const t = setTimeout(fn, ms);
    return () => clearTimeout(t);
  });
  let transient = 0;
  let started = false;
  const begin = () => {
    if (started) return;
    started = true;
    stream.push({ type: "start", partial: message });
  };
  for (let attempt = 1; ; attempt++) {
    timing.startedAt = null;
    timing.firstTokenAt = null;
    served = {};
    // An attempt retried before its first token streamed nothing; its counts are its own row's alone.
    message.usage = zeroUsage();
    // Budgets are the Ledger's decision, made before every attempt (M5.1): a refused call never
    // reaches the model and is recorded as `refused` with its code.
    if (deps.ledger.admit) {
      const admitted = await deps.ledger.admit({ person: who.person, runId: who.runId, model: model.id, ...(who.ceiling !== undefined ? { ceiling: who.ceiling } : {}) }).catch(
        (err: unknown) => ({ ok: false, code: "BUDGET_UNAVAILABLE", reason: String(err) }) as const,
      );
      if (!admitted.ok) return fail(attempt, "refused", admitted.code, admitted.reason, null);
    }
    if (deadline - deps.now() <= 0) return fail(attempt, "failed", "MODEL_CALL_TIMEOUT", `the call did not finish within ${bounds?.totalMs} ms`, null);
    let res: Response;
    timing.startedAt = deps.now();
    // This attempt's own abort: the caller's signal, or a bound that ran out before the token or the end.
    const attemptAbort = new AbortController();
    let late: "first" | "total" | null = null;
    const onCaller = () => attemptAbort.abort(signal?.reason);
    signal?.addEventListener("abort", onCaller, { once: true });
    const stops: Array<() => void> = [];
    if (bounds) {
      stops.push(schedule(() => { late ??= "first"; attemptAbort.abort(new Error("no first token in time")); }, bounds.firstTokenMs));
      stops.push(schedule(() => { late ??= "total"; attemptAbort.abort(new Error("the call did not finish in time")); }, deadline - deps.now()));
    }
    const settle = () => {
      for (const stop of stops.splice(0)) stop();
      signal?.removeEventListener("abort", onCaller);
    };
    const lateFailure = (): { code: string; detail: string } =>
      late === "first"
        ? { code: "MODEL_FIRST_TOKEN_TIMEOUT", detail: `no first token within ${bounds?.firstTokenMs} ms` }
        : { code: "MODEL_CALL_TIMEOUT", detail: `the call did not finish within ${bounds?.totalMs} ms` };
    // Before any token, a bounded route tries a 408, 5xx or late first token once more, the failed attempt its own row.
    const retryable = (status: number | null) => !!bounds && transient < MAX_TRANSIENT_RETRIES && (late === "first" || status === 408 || (status !== null && status >= 500));
    const retry = async (status: CallStatus, code: string, httpStatus: number | null): Promise<boolean> => {
      transient++;
      return record(row(attempt, status, code, httpStatus));
    };
    try {
      res = await abortable(send(deps.ai, model.id, inputs, attemptAbort.signal, deps.models), attemptAbort.signal);
    } catch (err) {
      settle();
      if (late) {
        const l = lateFailure();
        if (retryable(null)) {
          if (!(await retry("failed", l.code, null))) return end("LEDGER_UNAVAILABLE", "the timed-out attempt's row was not written");
          continue;
        }
        return fail(attempt, "failed", l.code, l.detail, null);
      }
      if (err instanceof ModelConfigInvalid) {
        timing.startedAt = null;
        return fail(attempt, "refused", err.code, err.message, null);
      }
      return fail(attempt, "failed", "MODEL_CALL_FAILED", String(err), null);
    }
    if (res.status === 429) {
      settle();
      const wait = retryAfterMs(res.headers.get("retry-after"), deps.now()) ?? 1000 * attempt;
      await res.body?.cancel();
      if (attempt > MAX_RATE_LIMIT_RETRIES || wait > MAX_RETRY_AFTER_MS) {
        return fail(attempt, "rate_limited", "MODEL_RATE_LIMITED", `429 after ${attempt} attempts, retry-after ${wait} ms`, 429);
      }
      if (deps.now() + wait >= deadline) {
        return fail(attempt, "rate_limited", "MODEL_RATE_LIMITED", `429 after ${attempt} attempts; a retry-after of ${wait} ms would pass the call's ${bounds?.totalMs} ms bound`, 429);
      }
      if (!(await record(row(attempt, "rate_limited", "MODEL_RATE_LIMITED", 429)))) return end("LEDGER_UNAVAILABLE", "the 429 row was not written");
      await deps.wait(wait);
      continue;
    }
    if (!res.ok || !res.body) {
      settle();
      const text = (await res.text().catch(() => "")).slice(0, 200);
      if (retryable(res.status)) {
        if (!(await retry("http_error", `MODEL_HTTP_${res.status}`, res.status))) return end("LEDGER_UNAVAILABLE", "the failed attempt's row was not written");
        continue;
      }
      return fail(attempt, "http_error", `MODEL_HTTP_${res.status}`, text, res.status);
    }
    begin();
    try {
      const body = guarded(res.body, attemptAbort.signal);
      await readInto(deps.tap ? tapped(body, deps.tap) : body, message, stream, () => {
        if (timing.firstTokenAt === null) stops.shift()?.();
        timing.firstTokenAt ??= deps.now();
      }, served);
    } catch (err) {
      settle();
      if (late) {
        const l = lateFailure();
        if (timing.firstTokenAt === null && retryable(res.status)) {
          if (!(await retry("failed", l.code, res.status))) return end("LEDGER_UNAVAILABLE", "the timed-out attempt's row was not written");
          continue;
        }
        return fail(attempt, "failed", l.code, l.detail, res.status);
      }
      const code = err instanceof StreamFault ? err.code : "MODEL_STREAM_DROPPED";
      return fail(attempt, "dropped", code, String(err), res.status);
    }
    settle();
    if (!(await record(row(attempt, "ok", null, res.status)))) return end("LEDGER_UNAVAILABLE", "the call's row was not written");
    const reason = message.stopReason === "toolUse" ? "toolUse" : message.stopReason === "length" ? "length" : "stop";
    stream.push({ type: "done", reason, message });
    stream.end(message);
    return;
  }
}

/** Texts one embedding call carries at most (the sync batch and a search's phrasings fit). */
export const MAX_EMBED_TEXTS = 100;

export type EmbedResult = { ok: true; vectors: number[][] } | { ok: false; code: string; reason: string };

/**
 * Embeds texts for semantic memory search (M12.2) over the same binding and gateway option, admitted
 * by the Ledger first and written to it as one row with route `embedding`. The binding reports no
 * usage for embeddings, so the row's input tokens are estimated at four characters a token.
 */
/** The embedding call's options: the gateway when one is configured, else none. */
function embedOptions(models: ModelConfig | undefined): { gateway?: { id: string; collectLog: false } } {
  const gateway = gatewayOption(models);
  return gateway ? { gateway } : {};
}

export async function embed(deps: Pick<AdapterDeps, "ai" | "ledger" | "now" | "models">, who: Omit<CallAttribution, "route" | "ceiling">, texts: string[]): Promise<EmbedResult> {
  if (!texts.length) return { ok: true, vectors: [] };
  if (texts.length > MAX_EMBED_TEXTS) return { ok: false, code: "EMBED_TOO_MANY", reason: `one call embeds at most ${MAX_EMBED_TEXTS} texts` };
  const timing: { startedAt: number | null } = { startedAt: null };
  const estimate = texts.reduce((n, t) => n + Math.ceil(t.length / 4), 0);
  const row = (status: CallStatus, code: string | null, inputTokens: number): ModelCallRow => ({
    tenant: who.tenant, person: who.person, runId: who.runId, route: "embedding", model: EMBEDDING_MODEL, attempt: 1, status, code,
    httpStatus: null, inputTokens, outputTokens: 0, reasoningTokens: 0, cachedTokens: 0, at: deps.now(),
    startedAt: timing.startedAt, firstTokenAt: null, finishedAt: timing.startedAt === null ? null : deps.now(),
  });
  const fail = async (status: CallStatus, code: string, reason: string, tokens = 0): Promise<EmbedResult> => {
    const recorded = await deps.ledger.record(row(status, code, tokens)).then(() => true, () => false);
    return { ok: false, code, reason: recorded ? reason : `${reason}; LEDGER_UNAVAILABLE: the row was not written` };
  };
  if (deps.models?.fault) return fail("refused", deps.models.fault.code, deps.models.fault.reason);
  if (deps.ledger.admit) {
    const admitted = await deps.ledger.admit({ person: who.person, runId: who.runId }).catch((err: unknown) => ({ ok: false, code: "BUDGET_UNAVAILABLE", reason: String(err) }) as const);
    if (!admitted.ok) return fail("refused", admitted.code, admitted.reason);
  }
  let out: { data?: unknown };
  timing.startedAt = deps.now();
  try {
    out = (await deps.ai.run(EMBEDDING_MODEL, { text: texts, pooling: EMBEDDING_POOLING }, embedOptions(deps.models))) as { data?: unknown };
  } catch (err) {
    return fail("failed", "EMBED_CALL_FAILED", String(err));
  }
  const data = out?.data;
  const valid = Array.isArray(data) && data.length === texts.length && data.every((v) => Array.isArray(v) && v.length === EMBEDDING_DIMENSIONS && v.every((x) => typeof x === "number" && Number.isFinite(x)));
  if (!valid) return fail("failed", "EMBED_SHAPE_INVALID", `expected ${texts.length} vectors of ${EMBEDDING_DIMENSIONS} numbers`, estimate);
  if (!(await deps.ledger.record(row("ok", null, estimate)).then(() => true, () => false))) return { ok: false, code: "LEDGER_UNAVAILABLE", reason: "the embedding call's row was not written" };
  return { ok: true, vectors: data as number[][] };
}
