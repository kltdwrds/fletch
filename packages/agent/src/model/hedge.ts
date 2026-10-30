// The hedged call (M22.1, D1 amended): a route with a hedge in `HEDGES` sends its request to the
// primary, and the same request to the hedge when the primary answers 408, 429 or 5xx, fails before
// any token, or gives no first token within the hedge delay. Whichever attempt gives its first token
// first is the turn's: it claims the turn's stream, and the other is aborted on the spot. An attempt
// pushes nothing before its first token, and at its first token it either claims the stream or stops
// reading (`Lost`), so a frame is never doubled or interleaved. Each attempt is bounded by the route's `CALL_BOUNDS` and is its own Ledger row (the
// loser `aborted`, coded `MODEL_HEDGE_LOST`); the budget is admitted once for the step. When neither
// attempt gives a token, the step fails with the last failure's code, in words, as an unhedged call
// does. Nothing is retried beyond the hedge itself: a 429 goes to the hedge at once rather than
// waiting out Retry-After, and a failure after the first token is the step's.
import type { AssistantMessage, AssistantMessageEventStream, Model } from "@earendil-works/pi-ai";
import type { CallStatus, ModelCallRow } from "../ledger/types.ts";
import type { AdapterDeps, CallAttribution } from "./adapter.ts";
import { CALL_BOUNDS, type Hedge, piProvider } from "./routes.ts";
import { abortable, guarded, readInto, type Served, tapped, zeroUsage } from "./read.ts";
import { providerName, requestBody, type RequestParts, send } from "./transport.ts";
import { StreamFault } from "./wire.ts";

/** The code of the attempt that lost the race and was aborted. */
export const HEDGE_LOST = "MODEL_HEDGE_LOST";

/** Thrown inside the losing attempt's read when the other attempt has claimed the stream. */
class Lost extends Error {}

type Result =
  | { kind: "completed"; httpStatus: number }
  | { kind: "lost" }
  | { kind: "failed"; code: string; detail: string; status: CallStatus; httpStatus: number | null; beforeToken: boolean };

interface Attempt {
  n: number;
  model: string;
  message: AssistantMessage;
  abort: AbortController;
  /** Set when the other attempt claimed the stream, so this one's abort reads as lost, not failed. */
  lost: boolean;
  done: Promise<Result>;
}

/**
 * Failures after which the request goes to the hedge: any before the first token (a timeout, a drop, a
 * call that threw, a 408, 429 or 5xx) except a refusal of the request itself, another 4xx.
 */
const hedgeable = (r: Result) => r.kind === "failed" && r.beforeToken && !(r.status === "http_error" && r.httpStatus !== null && r.httpStatus < 500 && r.httpStatus !== 408);

export async function callHedged(
  deps: AdapterDeps,
  who: CallAttribution,
  primary: Model<string>,
  hedge: Hedge,
  parts: RequestParts,
  signal: AbortSignal | undefined,
  stream: AssistantMessageEventStream,
): Promise<void> {
  const schedule = deps.schedule ?? ((fn: () => void, ms: number) => {
    const t = setTimeout(fn, ms);
    return () => clearTimeout(t);
  });
  const bounds = CALL_BOUNDS[who.route];
  let unrecorded = false;
  const record = (r: ModelCallRow) => deps.ledger.record(r).then(() => true, () => false).then((ok) => {
    if (!ok) unrecorded = true;
    return ok;
  });
  const messageFor = (model: string): AssistantMessage => ({
    role: "assistant",
    content: [],
    api: primary.api,
    provider: piProvider(model),
    model,
    usage: zeroUsage(),
    stopReason: "stop",
    timestamp: deps.now(),
  });
  const end = (message: AssistantMessage, code: string, detail: string) => {
    message.stopReason = signal?.aborted ? "aborted" : "error";
    message.errorMessage = `${code}: ${detail}`;
    stream.push({ type: "error", reason: message.stopReason, error: message });
    stream.end(message);
  };

  // Budgets are the Ledger's decision (M5.1), made once for the step however many attempts it makes.
  if (deps.ledger.admit) {
    const admitted = await deps.ledger.admit({ person: who.person, runId: who.runId, model: primary.id, ...(who.ceiling !== undefined ? { ceiling: who.ceiling } : {}) }).catch(
      (err: unknown) => ({ ok: false, code: "BUDGET_UNAVAILABLE", reason: String(err) }) as const,
    );
    if (!admitted.ok) {
      const message = messageFor(primary.id);
      const recorded = await record({
        tenant: who.tenant, person: who.person, runId: who.runId, route: who.route, model: primary.id, provider: providerName(primary.id, undefined), attempt: 1,
        status: "refused", code: admitted.code, httpStatus: null, inputTokens: 0, outputTokens: 0, reasoningTokens: 0, cachedTokens: 0,
        at: deps.now(), startedAt: null, firstTokenAt: null, finishedAt: null,
      });
      return end(message, admitted.code, recorded ? admitted.reason : `${admitted.reason}; LEDGER_UNAVAILABLE: the row was not written`);
    }
  }

  const attempts: Attempt[] = [];
  let winner: Attempt | null = null;
  let stopTimer: () => void = () => {};
  const pendingTap = new Map<Attempt, string[]>();

  /** The first attempt to give a token takes the stream; every other attempt is aborted as lost. */
  const claim = (me: Attempt): boolean => {
    if (winner) return winner === me;
    winner = me;
    stopTimer();
    for (const other of attempts) {
      if (other === me) continue;
      other.lost = true;
      other.abort.abort(new Lost("the other attempt gave its first token first"));
    }
    if (deps.tap) for (const raw of pendingTap.get(me) ?? []) deps.tap(raw);
    stream.push({ type: "start", partial: me.message });
    return true;
  };

  const run = async (me: Attempt): Promise<Result> => {
    const timing: { startedAt: number; firstTokenAt: number | null } = { startedAt: deps.now(), firstTokenAt: null };
    const served: Served = {};
    const row = (status: CallStatus, code: string | null, httpStatus: number | null): ModelCallRow => ({
      tenant: who.tenant, person: who.person, runId: who.runId, route: who.route,
      model: served.model ?? me.model, provider: providerName(me.model, served.provider),
      ...(served.costUsd !== undefined ? { costMicros: Math.round(served.costUsd * 1e6) } : {}),
      attempt: me.n, status, code, httpStatus,
      inputTokens: me.message.usage.input, outputTokens: me.message.usage.output, reasoningTokens: me.message.usage.reasoning ?? 0, cachedTokens: me.message.usage.cacheRead,
      at: deps.now(), startedAt: timing.startedAt, firstTokenAt: timing.firstTokenAt, finishedAt: deps.now(),
    });
    let late: "first" | "total" | null = null;
    const stops: Array<() => void> = [];
    if (bounds) {
      stops.push(schedule(() => { late ??= "first"; me.abort.abort(new Error("no first token in time")); }, bounds.firstTokenMs));
      stops.push(schedule(() => { late ??= "total"; me.abort.abort(new Error("the call did not finish in time")); }, bounds.totalMs));
    }
    const onCaller = () => me.abort.abort(signal?.reason);
    if (signal?.aborted) onCaller();
    else signal?.addEventListener("abort", onCaller, { once: true });
    const settle = () => {
      for (const stop of stops.splice(0)) stop();
      signal?.removeEventListener("abort", onCaller);
    };
    const failed = async (status: CallStatus, code: string, detail: string, httpStatus: number | null): Promise<Result> => {
      settle();
      if (me.lost) {
        await record(row("aborted", HEDGE_LOST, httpStatus));
        return { kind: "lost" };
      }
      if (late) {
        status = "failed";
        code = late === "first" ? "MODEL_FIRST_TOKEN_TIMEOUT" : "MODEL_CALL_TIMEOUT";
        detail = late === "first" ? `no first token within ${bounds?.firstTokenMs} ms` : `the call did not finish within ${bounds?.totalMs} ms`;
      }
      await record(row(status, code, httpStatus));
      return { kind: "failed", code, detail, status, httpStatus, beforeToken: timing.firstTokenAt === null };
    };

    const body = requestBody(who.route, me.model, parts);
    let res: Response;
    try {
      res = await abortable(send(deps.ai, me.model, body, me.abort.signal, deps.models), me.abort.signal);
    } catch (err) {
      return failed("failed", "MODEL_CALL_FAILED", String(err), null);
    }
    if (!res.ok || !res.body) {
      const text = (await res.text().catch(() => "")).slice(0, 200);
      return res.status === 429 ? failed("rate_limited", "MODEL_RATE_LIMITED", `429 from ${me.model}: ${text}`, 429) : failed("http_error", `MODEL_HTTP_${res.status}`, text, res.status);
    }
    const guardedBody = guarded(res.body, me.abort.signal);
    const tap = deps.tap;
    const read = tap
      ? tapped(guardedBody, (raw) => {
          if (winner === me) tap(raw);
          else if (!winner) pendingTap.set(me, [...(pendingTap.get(me) ?? []), raw]);
        })
      : guardedBody;
    try {
      await readInto(read, me.message, stream, () => {
        if (timing.firstTokenAt === null) {
          timing.firstTokenAt = deps.now();
          stops.shift()?.();
        }
        if (!claim(me)) throw new Lost("the other attempt gave its first token first");
      }, served);
    } catch (err) {
      if (err instanceof Lost) me.lost = true;
      return failed("dropped", err instanceof StreamFault ? err.code : "MODEL_STREAM_DROPPED", String(err), res.status);
    }
    // A response with no token at all still answers: it takes the stream if nothing else has.
    if (!claim(me)) return failed("aborted", HEDGE_LOST, "the other attempt gave its first token first", res.status);
    settle();
    await record(row("ok", null, res.status));
    return { kind: "completed", httpStatus: res.status };
  };

  const start = (model: string): Attempt => {
    const me: Attempt = { n: attempts.length + 1, model, message: messageFor(model), abort: new AbortController(), lost: false, done: Promise.resolve({ kind: "lost" }) };
    attempts.push(me);
    me.done = run(me);
    return me;
  };
  let hedged: Attempt | null = null;
  const startHedge = () => {
    stopTimer();
    if (hedged || winner || signal?.aborted) return;
    hedged = start(hedge.model);
  };

  const first = start(primary.id);
  stopTimer = schedule(startHedge, hedge.delayMs);
  const firstResult = await first.done;
  if (hedgeable(firstResult)) startHedge();
  stopTimer();
  const second = hedged as Attempt | null;
  const secondResult = second ? await second.done : null;

  const results: Array<[Attempt, Result]> = [[first, firstResult], ...(second && secondResult ? [[second, secondResult] as [Attempt, Result]] : [])];
  const won = results.find(([a]) => a === winner);
  if (won && won[1].kind === "completed") {
    const message = won[0].message;
    if (unrecorded) return end(message, "LEDGER_UNAVAILABLE", "an attempt's row was not written");
    const reason = message.stopReason === "toolUse" ? "toolUse" : message.stopReason === "length" ? "length" : "stop";
    stream.push({ type: "done", reason, message });
    stream.end(message);
    return;
  }
  // The winner broke after its first token, or neither attempt gave one: the last failure is the step's.
  const last = won ?? [...results].reverse().find(([, r]) => r.kind === "failed");
  const [attempt, result] = last ?? [first, firstResult];
  const detail = result.kind === "failed" ? result.detail : "no attempt answered";
  const code = result.kind === "failed" ? result.code : "MODEL_CALL_FAILED";
  end(attempt.message, code, unrecorded ? `${detail}; LEDGER_UNAVAILABLE: a row was not written` : detail);
}
