// M19.1: what the person sees agrees with the chat within seconds (QYVR-169, QYVR-170). The page never
// relies on a live frame alone while it says a turn is working: a quiet socket is asked for the turn's
// state, an unanswered check drops it for a new socket, and a `turn_done` whose reply the page drew less
// of than the chat streamed asks for the history once. A chat-route model call is bounded and its late
// first token, 408 or 5xx is retried once, each attempt a Ledger row. Cards draw no raw
// arguments (M23.2). Every page here runs the shipped script against the production engine, with the
// test owning the clock: a bound passes only when the test fires its timer. Bo's socket on Ada's chat
// gets nothing throughout.
import { normalizeContext } from "@earendil-works/pi-ai";
import { describe, expect, it, } from "vitest";
import { ChatEngine, type EngineCtx } from "../../packages/agent/src/chat/engine.ts";
import { failureText } from "../../packages/agent/src/chat/failure-words.ts";
import { connectFrame, ownerOnly } from "../../packages/agent/src/chat/protocol.ts";
import { answerFrame } from "../../packages/agent/src/chat/socket.ts";
import type { ModelCallRow } from "../../packages/agent/src/ledger/types.ts";
import { createStreamFn } from "../../packages/agent/src/model/adapter.ts";
import { CALL_BOUNDS, modelFor, type Route } from "../../packages/agent/src/model/routes.ts";
import { TURN_CHECK_MS } from "../../packages/agent/src/http/page.ts";
import { ANSWER_TIMEOUT_MS } from "../../packages/agent/src/http/reconnect.ts";
import { Ledger } from "../../packages/agent/src/objects/ledger.ts";
import { FakeModel, type FakeStep } from "../support/fake-model.ts";
import { harnessNamespace, ObjectHarness } from "../support/object-harness.ts";
import { ada } from "./support/authority-world.ts";
import { type El, page, type ScriptedSocket } from "./support/page-harness.ts";

const T0 = Date.UTC(2026, 9, 15, 6, 13, 26);
type Frame = Record<string, unknown>;
const BOUNDS = CALL_BOUNDS.chat as { firstTokenMs: number; totalMs: number };

/** The bounds' timers, fired by the test: a cancelled one never fires. */
function clock() {
  const list: Array<{ f: () => void; ms: number; cancelled?: boolean }> = [];
  const live = () => list.filter((t) => !t.cancelled);
  return {
    live,
    schedule: (f: () => void, ms: number) => {
      const t: { f: () => void; ms: number; cancelled?: boolean } = { f, ms };
      list.push(t);
      return () => {
        t.cancelled = true;
      };
    },
    fire(ms: number) {
      const t = live().find((x) => x.ms === ms);
      if (!t) throw new Error(`no live timer of ${ms} ms`);
      t.cancelled = true;
      t.f();
    },
  };
}

const settle = async () => {
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
};

/** Ada's chat over the production engine and Ledger; frames go to the owner's connections only. */
function world(script: FakeStep[]) {
  const fake = new FakeModel(script);
  const bounds = clock();
  const ledgers = harnessNamespace((name) => new ObjectHarness(name, (ctx, env) => new Ledger(ctx as DurableObjectState, env as Env), {}, (l) => {
    l.now = () => T0;
  }));
  const env = { TENANT_ID: ada.company, QYVR_ENV: "staging", AI: fake.binding, LEDGER: ledgers.binding };
  const conns: Array<{ state: { person: string }; frames: Frame[]; send(d: string): void }> = [];
  const chat: ObjectHarness<ChatEngine> = new ObjectHarness("chat-ada", (ctx, e) => new ChatEngine(ctx as EngineCtx, e as Env, { sockets: () => ownerOnly(conns, chat.instance.owner()) }), env, (c) => {
    c.now = () => T0;
    c.wait = async () => {};
    c.schedule = bounds.schedule;
  });
  chat.instance.claim(ada.email);
  /** A connection of `person`; `onFrame` is where the chat's frames to it go (a page's socket, or nowhere). */
  const socketOf = (person: string, onFrame: (data: string) => void = () => {}) => {
    const c = { state: { person }, frames: [] as Frame[], send: (d: string) => { c.frames.push(JSON.parse(d)); onFrame(d); } };
    conns.push(c);
    return c;
  };
  const resync = (person: string) => connectFrame(person, chat.instance.owner(), () => chat.instance.history());
  const calls = () => ledgers.harness(ada.company).instance.modelCalls({ person: ada.email });
  return { fake, bounds, chat, socketOf, resync, calls };
}

type World = ReturnType<typeof world>;
type Page = Awaited<ReturnType<typeof page>>;

/**
 * Ada's page on her chat. The page's sends go through the socket's production answer; the chat's frames
 * reach the page unless `lose` drops them, as a socket that stopped delivering does.
 */
async function adaPage(w: World, lose: (f: Frame) => boolean = () => false) {
  const box: { p?: Page } = {};
  const p = await page({
    onSend(data: string, s: ScriptedSocket) {
      void answerFrame(ada.email, data, w.chat.instance).then((reply) => reply && box.p?.deliver(s, reply));
    },
  });
  box.p = p;
  const s0 = p.sockets[0] as ScriptedSocket;
  p.open(s0);
  w.socketOf(ada.email, (d) => {
    if (!lose(JSON.parse(d))) p.deliver(s0, d);
  });
  p.deliver(s0, (w.resync(ada.email) as { frame: unknown }).frame);
  return { p, s0 };
}

const syncs = (s: ScriptedSocket) => s.sent.filter((d) => JSON.parse(d).type === "sync").length;
const checkTimers = (p: Page) => p.t.live().filter((t) => t.ms === TURN_CHECK_MS);

describe("[M19.1] the page reconciles while it says working (QYVR-169, QYVR-170)", () => {

  it("a dropped turn_failed: the failure is drawn in words within one bound of the quiet socket", async () => {
    const w = world([{ status: 503 }, { status: 503 }]);
    const { p } = await adaPage(w, (f) => f.type === "turn_failed");
    await p.type("hello");
    await settle();
    expect(p.busy()).toBe(true);
    expect(p.bubbles()).toEqual([["m you", "hello"]]);
    p.t.fire(TURN_CHECK_MS);
    await settle();
    expect(p.busy()).toBe(false);
    expect(p.bubbles()).toEqual([["m you", "hello"], ["m note", failureText("MODEL_HTTP_503")]]);
  });

  it("deltas lost before turn_done: the page asks for the history at once and stays working until the reply is drawn", async () => {
    const w = world([{ reasoning: "Two and two.", text: "4" }]);
    const shown: Array<{ busy: boolean; agents: string[] }> = [];
    const { p, s0 } = await adaPage(w, (f) => f.type === "delta");
    // Every frame the page draws is watched: the working line never clears while the done turn's reply is undrawn.
    const deliver = p.deliver;
    p.deliver = (s, f) => {
      deliver(s, f);
      shown.push({ busy: p.busy(), agents: p.bubbles().filter(([c]) => c === "m agent").map(([, t]) => t as string) });
    };
    await p.type("what is 2+2?");
    await settle();
    // Asked on turn_done, not after a bound.
    expect(syncs(s0)).toBe(1);
    expect(p.t.live().some((t) => t.ms === TURN_CHECK_MS)).toBe(false);
    expect(p.busy()).toBe(false);
    expect(p.bubbles().filter(([c]) => c === "m agent")).toEqual([["m agent", "4"]]);
    expect(shown.filter((v) => !v.busy && !v.agents.includes("4"))).toEqual([]);
  });

  it("a working state never clears without a turn end: checks while the model runs leave the streamed reply as drawn", async () => {
    const w = world([{ checkpoint: "slow-model", step: { text: "Your Tuesday is free." } }]);
    const { p, s0 } = await adaPage(w);
    await p.type("Is my Tuesday free?");
    await w.fake.reached("slow-model");
    await settle();
    const during = p.bubbles();
    expect(during.at(-1)?.[0]).toBe("m agent");
    for (let i = 1; i <= 3; i++) {
      p.t.fire(TURN_CHECK_MS);
      await settle();
      expect(syncs(s0)).toBe(i);
      expect(p.busy()).toBe(true);
      expect(p.bubbles()).toEqual(during);
    }
    w.fake.release("slow-model");
    await settle();
    expect(p.busy()).toBe(false);
    expect(p.bubbles().at(-1)).toEqual(["m agent", "Your Tuesday is free."]);
    expect(syncs(s0)).toBe(3);
    expect(checkTimers(p)).toEqual([]);
  });

  it("a check the socket does not answer drops it, and the new socket's history draws the reply", async () => {
    const w = world([{ text: "Noted." }]);
    const { p, s0 } = await adaPage(w, (f) => f.type !== "turn_started");
    // From here the socket delivers nothing at all, not even an answer to a check.
    s0.send = (d) => void s0.sent.push(d);
    await w.chat.instance.send({ person: ada.email, text: "Remember the dentist.", clientId: "send-x" });
    p.deliver(s0, { type: "turn_started", turn: "t", text: "Remember the dentist.", id: "send-x" });
    expect(p.busy()).toBe(true);
    p.t.fire(TURN_CHECK_MS);
    expect(syncs(s0)).toBe(1);
    p.t.fire(ANSWER_TIMEOUT_MS);
    expect(s0.closed).toMatchObject({ code: 4002 });
    const s1 = p.sockets[1] as ScriptedSocket;
    p.open(s1);
    p.deliver(s1, (w.resync(ada.email) as { frame: unknown }).frame);
    expect(p.busy()).toBe(false);
    expect(p.bubbles()).toEqual([["m you", "Remember the dentist."], ["m agent", "Noted."]]);
  });
});

/** The adapter on its own, with a recording Ledger and the bounds' timers in the test's hands. */
async function call(route: Route, script: FakeStep[]) {
  const fake = new FakeModel(script);
  const bounds = clock();
  const rows: ModelCallRow[] = [];
  const streamFn = createStreamFn({ ai: fake.binding as unknown as Ai, ledger: { record: async (r) => void rows.push(r) }, wait: async () => {}, now: () => T0, schedule: bounds.schedule }, { tenant: ada.company, person: ada.email, runId: `run-${route}`, route });
  const stream = await streamFn(modelFor(route === "embedding" ? "chat" : route), normalizeContext({ messages: [{ role: "user", content: "hello", timestamp: T0 }] }), {});
  return { fake, bounds, rows, result: stream.result() };
}

const fireWhenLive = async (b: ReturnType<typeof clock>, ms: number) => {
  for (let i = 0; i < 50 && !b.live().some((t) => t.ms === ms); i++) await new Promise((r) => setImmediate(r));
  b.fire(ms);
};

describe("[M19.1] a chat-route model call is bounded (QYVR-169)", () => {
  it("a stream that never sends a first token is aborted with its code, retried once, and both attempts are Ledger rows", async () => {
    const c = await call("chat", [{ silent: true }, { silent: true }]);
    await fireWhenLive(c.bounds, BOUNDS.firstTokenMs);
    await fireWhenLive(c.bounds, BOUNDS.firstTokenMs);
    const message = await c.result;
    expect(message.stopReason).toBe("error");
    expect(message.errorMessage).toMatch(/^MODEL_FIRST_TOKEN_TIMEOUT: /);
    expect(c.fake.requests).toHaveLength(2);
    expect(c.rows.map((r) => [r.attempt, r.status, r.code, r.firstTokenAt])).toEqual([
      [1, "failed", "MODEL_FIRST_TOKEN_TIMEOUT", null],
      [2, "failed", "MODEL_FIRST_TOKEN_TIMEOUT", null],
    ]);
    // Each attempt was aborted: the binding saw an aborted signal on both requests.
    expect(c.fake.requests.map((r) => (r.options.signal as AbortSignal).aborted)).toEqual([true, true]);
    expect(c.bounds.live()).toEqual([]);
    expect(failureText("MODEL_FIRST_TOKEN_TIMEOUT")).not.toBe(failureText("UNKNOWN_CODE"));
  });

  it("a late first token is retried once and the retry's answer is the turn's", async () => {
    const c = await call("chat", [{ silent: true }, { text: "Hello Ada." }]);
    await fireWhenLive(c.bounds, BOUNDS.firstTokenMs);
    const message = await c.result;
    expect(message.stopReason).toBe("stop");
    expect(message.content).toEqual([{ type: "text", text: "Hello Ada." }]);
    expect(c.rows.map((r) => [r.attempt, r.status, r.code])).toEqual([[1, "failed", "MODEL_FIRST_TOKEN_TIMEOUT"], [2, "ok", null]]);
    expect(c.bounds.live()).toEqual([]);
  });

  it("a 408 or a 5xx before the first token is retried once, its own row, then failed with its code", async () => {
    const twice = await call("chat", [{ status: 408 }, { status: 408 }]);
    const failed = await twice.result;
    expect(failed.errorMessage).toMatch(/^MODEL_HTTP_408: /);
    expect(twice.rows.map((r) => [r.attempt, r.status, r.code, r.httpStatus])).toEqual([[1, "http_error", "MODEL_HTTP_408", 408], [2, "http_error", "MODEL_HTTP_408", 408]]);
    const once = await call("chat", [{ status: 502 }, { text: "Hi." }]);
    expect((await once.result).stopReason).toBe("stop");
    expect(once.rows.map((r) => [r.status, r.code])).toEqual([["http_error", "MODEL_HTTP_502"], ["ok", null]]);
    // A 400 is the request's fault: never retried.
    const bad = await call("chat", [{ status: 400 }]);
    expect((await bad.result).errorMessage).toMatch(/^MODEL_HTTP_400: /);
    expect(bad.rows).toHaveLength(1);
  });

  it("a call that streams but does not finish in its total bound is aborted with MODEL_CALL_TIMEOUT, not retried", async () => {
    const c = await call("chat", [{ checkpoint: "long", step: { text: "A long answer." } }]);
    await c.fake.reached("long");
    // The first token arrived, so its own bound is gone; only the total bound is left.
    for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
    expect(c.bounds.live().map((t) => t.ms)).toEqual([BOUNDS.totalMs]);
    c.bounds.fire(BOUNDS.totalMs);
    const message = await c.result;
    expect(message.errorMessage).toMatch(/^MODEL_CALL_TIMEOUT: /);
    expect(c.rows.map((r) => [r.attempt, r.status, r.code, r.firstTokenAt !== null])).toEqual([[1, "failed", "MODEL_CALL_TIMEOUT", true]]);
    expect(c.fake.requests).toHaveLength(1);
  });

  it("another route keeps its own behaviour: no bound is armed and a 408 is not retried", async () => {
    expect(Object.keys(CALL_BOUNDS)).toEqual(["chat"]);
    const c = await call("job", [{ status: 408 }]);
    expect((await c.result).errorMessage).toMatch(/^MODEL_HTTP_408: /);
    expect(c.rows).toHaveLength(1);
    expect(c.bounds.live()).toEqual([]);
  });

  it("a turn whose model never starts fails in words on the page, both attempts in Ada's Ledger", async () => {
    const w = world([{ silent: true }, { silent: true }]);
    const { p } = await adaPage(w);
    await p.type("hello");
    await fireWhenLive(w.bounds, BOUNDS.firstTokenMs);
    await fireWhenLive(w.bounds, BOUNDS.firstTokenMs);
    await settle();
    expect(p.busy()).toBe(false);
    expect(p.bubbles()).toEqual([["m you", "hello"], ["m note", failureText("MODEL_FIRST_TOKEN_TIMEOUT")]]);
    expect((await w.calls()).map((r) => r.code)).toEqual(["MODEL_FIRST_TOKEN_TIMEOUT", "MODEL_FIRST_TOKEN_TIMEOUT"]);
  });
});

const find = (root: El, pred: (e: El) => boolean): El[] => [...(pred(root) ? [root] : []), ...root.children.flatMap((c) => find(c, pred))];
