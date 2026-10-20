// M17.1: chat failures stay visible (QYVR-156) and an exhausted budget fails every turn attempt at once,
// in words (QYVR-157). Muse's repros, rewritten with the fictional set: Ada's turn fails and a re-sync
// (reconnect, or the object restarted) drew nothing of it; under an exhausted budget the first turns
// failed with the raw code and later ones hung. Two members wherever history or a budget is shared:
// Bo never sees Ada's failures, and the company's allowance stops both.
import { describe, expect, it } from "vitest";
import { ChatEngine, type EngineCtx } from "../../packages/agent/src/chat/engine.ts";
import { failureText } from "../../packages/agent/src/chat/failure-words.ts";
import { connectFrame } from "../../packages/agent/src/chat/protocol.ts";
import { APP_PAGE } from "../../packages/agent/src/http/page.ts";
import type { MemoryApi } from "../../packages/agent/src/memory/tools.ts";
import { Ledger } from "../../packages/agent/src/objects/ledger.ts";
import { FakeModel, type FakeStep } from "../support/fake-model.ts";
import { harnessNamespace, ObjectHarness } from "../support/object-harness.ts";
import people from "../fixtures/people.json" with { type: "json" };

const ada = people.people.find((p) => p.id === "sam-solo")!;
const T0 = Date.UTC(2026, 9, 14, 17, 15, 0);

function world(script: FakeStep[], hooks: { memory?: (person: string) => MemoryApi } = {}) {
  const fake = new FakeModel(script);
  const clock = { now: T0 };
  const ledgers = harnessNamespace((name) =>
    new ObjectHarness(name, (ctx, env) => new Ledger(ctx as DurableObjectState, env as Env), {}, (l) => {
      l.now = () => clock.now;
    }),
  );
  const env = { TENANT_ID: ada.company, QYVR_ENV: "staging", AI: fake.binding, LEDGER: ledgers.binding };
  const chatFor = (name: string) =>
    new ObjectHarness(name, (ctx, e) => new ChatEngine(ctx as EngineCtx, e as Env, hooks), env, (c) => {
      c.now = () => clock.now;
      c.wait = async () => {};
    });
  const ledger = () => ledgers.harness(ada.company).instance;
  /** Spends `tokens` of `person`'s day, as an earlier answered call would have: GLM input at $0.15 a million, so 1,000 tokens are 150 micro-dollars. */
  const spend = (person: string, tokens: number) =>
    ledger().record({ tenant: ada.company, person, runId: "earlier", route: "chat", model: "@cf/zai-org/glm-5.3-flash", attempt: 1, status: "ok", code: null, httpStatus: 200, inputTokens: tokens, outputTokens: 0, reasoningTokens: 0, cachedTokens: 0, at: clock.now, startedAt: null, firstTokenAt: null, finishedAt: null });
  /** What the host's `onConnect` sends, over the production `connectFrame` and the engine's own history. */
  const resync = (chat: ObjectHarness<ChatEngine>, person: string) => connectFrame(person, chat.instance.owner(), () => chat.instance.history());
  return { fake, clock, chatFor, ledger, spend, resync };
}

type Frame = Record<string, unknown>;
const failedFrames = (frames: Frame[]) => frames.filter((f) => f.type === "turn_failed");
const entries = (r: ReturnType<typeof connectFrame>) => (r.ok && r.frame.type === "history" ? r.frame.entries : null);

describe("[M17.1] a failed turn is a history entry (QYVR-156)", () => {
  it("Ada's failed turn is drawn with its code and reason after a reconnect and after the object restarts, between her turns", async () => {
    const w = world([{ text: "Your Tuesday is free." }, { status: 400, message: "bad request from the model" }, { text: "Still free." }]);
    const chat = w.chatFor("chat-ada");
    await chat.instance.send({ person: ada.email, text: "Is my Tuesday free?" });
    w.clock.now += 1_000;
    const failed = await chat.instance.send({ person: ada.email, text: "And Wednesday?" });
    expect(failed).toMatchObject({ status: "failed", code: "MODEL_HTTP_400" });
    w.clock.now += 1_000;
    await chat.instance.send({ person: ada.email, text: "And Thursday?" });

    const expected = [
      { kind: "you", text: "Is my Tuesday free?", mid: "m1" },
      { kind: "agent", text: "Your Tuesday is free.", mid: "m2" },
      { kind: "you", text: "And Wednesday?", mid: "m3" },
      { kind: "failed", text: failureText("MODEL_HTTP_400"), turn: (failed as { turnId: string }).turnId, code: "MODEL_HTTP_400", reason: expect.stringContaining("bad request from the model") },
      { kind: "you", text: "And Thursday?", mid: "m4" },
      { kind: "agent", text: "Still free.", mid: "m5" },
    ];
    expect(entries(w.resync(chat, ada.email))).toEqual(expected.map((e) => ({ ...e, at: expect.any(Number) })));
    // The object restarted: the failure is the turn row's, not the instance's.
    chat.evict();
    expect(entries(w.resync(chat, ada.email))).toEqual(expected.map((e) => ({ ...e, at: expect.any(Number) })));
    // Persisted server side with its code and reason.
    expect(chat.rows("SELECT status, code, reason FROM turns WHERE status = 'failed'")).toEqual([{ status: "failed", code: "MODEL_HTTP_400", reason: expect.stringContaining("bad request") }]);
  });

  it("the page draws a failure in words, from the live frame and from history, never the raw code alone", () => {
    expect(APP_PAGE).toContain('f.type === "turn_failed") { endThinking(); reply = null; add("note", f.text); }');
    expect(APP_PAGE).toContain('h.kind === "note" || h.kind === "failed" ? "note"');
    // Planted: the old line that drew the code as the person's text is gone.
    expect(APP_PAGE).not.toContain('"turn failed: " + f.code');
  });
});

describe("[M17.1] an exhausted budget fails every turn attempt at once, in words (QYVR-157)", () => {
  it("Ada's own allowance: three attempts each fail at once with the same frame, no model call, and history keeps all three", async () => {
    const w = world([{ text: "never reached" }]);
    await w.ledger().setBudgets({ personDailyMicros: 150 });
    await w.spend(ada.email, 1_000);
    const chat = w.chatFor("chat-ada");
    const socket = chat.connect();
    for (const text of ["Plan my week.", "Plan my week, please.", "ping"]) {
      w.clock.now += 60_000;
      expect(await chat.instance.send({ person: ada.email, text })).toMatchObject({ status: "failed", code: "BUDGET_PERSON_EXHAUSTED" });
    }
    expect(w.fake.requests).toHaveLength(0);
    const frames = failedFrames(socket.frames as Frame[]);
    expect(frames).toHaveLength(3);
    for (const f of frames) expect(f).toEqual({ type: "turn_failed", turn: expect.any(String), code: "BUDGET_PERSON_EXHAUSTED", reason: expect.stringContaining("spent $0.00015 of $0.00015 today"), text: failureText("BUDGET_PERSON_EXHAUSTED") });
    // Nothing waits on the turn: no resume is armed, no turn is left running to refuse the next one.
    expect(chat.alarmAt).toBeNull();
    expect(chat.rows("SELECT status FROM turns").map((r) => r.status)).toEqual(["failed", "failed", "failed"]);
    expect(entries(w.resync(chat, ada.email))?.map((e) => e.kind)).toEqual(["you", "failed", "you", "failed", "you", "failed"]);
    // Each refusal is accounted for as the adapter accounts for one: a refused row, no tokens.
    const refused = (await w.ledger().modelCalls({ person: ada.email })).filter((r) => r.status === "refused");
    expect(refused.map((r) => [r.code, r.inputTokens, r.outputTokens])).toEqual(Array(3).fill(["BUDGET_PERSON_EXHAUSTED", 0, 0]));
  });

  it("an attempt fails at once even when a store the turn would wait on never answers (the hang)", async () => {
    let asked = 0;
    let markAsked: () => void = () => {};
    const askedOnce = new Promise<"HUNG">((resolve) => {
      markAsked = () => resolve("HUNG");
    });
    // Planted: Ada's memory store never answers; a turn that reached it before the budget would hang here.
    const standingFiles = () => {
      asked++;
      markAsked();
      return new Promise<never>(() => {});
    };
    const memory = () => ({ standingFiles }) as unknown as MemoryApi;
    const w = world([{ text: "never reached" }], { memory });
    await w.ledger().setBudgets({ tenantDailyMicros: 75 });
    await w.spend(ada.email, 500);
    const chat = w.chatFor("chat-ada");
    for (let i = 0; i < 3; i++) {
      const outcome = await Promise.race([chat.instance.send({ person: ada.email, text: `try ${i}` }), askedOnce]);
      expect(outcome).toMatchObject({ status: "failed", code: "BUDGET_TENANT_EXHAUSTED" });
    }
    expect(asked).toBe(0);
    expect(w.fake.requests).toHaveLength(0);
  });

  it("the words say what ran out, when it resets and who can raise it, and carry no code", () => {
    const own = failureText("BUDGET_PERSON_EXHAUSTED");
    const company = failureText("BUDGET_TENANT_EXHAUSTED");
    expect(own).toContain("your own daily allowance");
    expect(company).toContain("the company's daily allowance");
    for (const t of [own, company]) {
      expect(t).toContain("midnight UTC");
      expect(t).toContain("An admin can raise it on the admin page");
      expect(t).not.toMatch(/[A-Z]{3,}_[A-Z_]+/);
    }
    // Every code says something, an unknown one too, and never the code itself.
    expect(failureText("SOMETHING_NEW")).not.toContain("SOMETHING_NEW");
  });

  it("a sub-agents' hand-off turn is admitted first too: under an exhausted budget it fails at once", async () => {
    const w = world([{ text: "never reached" }]);
    const chat = w.chatFor("chat-ada");
    await chat.instance.send({ person: ada.email, text: "hello" });
    await w.ledger().setBudgets({ personDailyMicros: 1 });
    await w.spend(ada.email, 10);
    const socket = chat.connect();
    expect(await chat.instance.handoff({ grp: "g1", person: ada.email, text: "HANDOFF: done" })).toMatchObject({ status: "failed", code: "BUDGET_PERSON_EXHAUSTED" });
    expect(failedFrames(socket.frames as Frame[]).map((f) => f.code)).toEqual(["BUDGET_PERSON_EXHAUSTED"]);
    expect(w.fake.requests).toHaveLength(1);
  });
});
