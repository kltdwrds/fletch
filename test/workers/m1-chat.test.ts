// M1.1: the Chat object end to end over the fake model, through the object harness: recovery after
// eviction, the adapter's 429 and drop handling, the absent gateway option, the Ledger, ownership, the
// compromised-model guard and compaction. Fixture people are Sam Solo and Pat of solo-sam.
import { normalizeContext } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import { ChatEngine, type ChatFrame, type EngineCtx } from "../../packages/agent/src/chat/engine.ts";
import { Ledger } from "../../packages/agent/src/objects/ledger.ts";
import { COMPACTION_PROMPT, SUMMARY_PREAMBLE } from "../../packages/agent/src/chat/compaction.ts";
import { failureText } from "../../packages/agent/src/chat/failure-words.ts";
import type { ModelCallRow } from "../../packages/agent/src/ledger/types.ts";
import { createStreamFn } from "../../packages/agent/src/model/adapter.ts";
import { modelFor } from "../../packages/agent/src/model/routes.ts";
import { ENVELOPE_HEADING } from "../../packages/agent/src/context/assemble.ts";
import { FakeModel, type FakeMode, type FakeStep } from "../support/fake-model.ts";
import { hermeticNetwork } from "../support/hermetic-network.ts";
import { Evicted, harnessNamespace, ObjectHarness } from "../support/object-harness.ts";
import people from "../fixtures/people.json" with { type: "json" };

const ada = people.people.find((p) => p.id === "sam-solo")!;
const T0 = Date.UTC(2026, 9, 12, 9, 0, 0);

function setup(script: FakeStep[], mode?: FakeMode) {
  const fake = new FakeModel(script, mode);
  const ledgers = harnessNamespace((name) => new ObjectHarness(name, (ctx, env) => new Ledger(ctx as DurableObjectState, env as Env), {}));
  const env = { TENANT_ID: ada.company, QYVR_ENV: "staging", AI: fake.binding, LEDGER: ledgers.binding };
  const waits: number[] = [];
  const clock = { now: T0 };
  const chatFor = (name: string) =>
    new ObjectHarness(name, (ctx, e) => new ChatEngine(ctx as EngineCtx, e as Env), env, (c) => {
      c.now = () => clock.now;
      c.wait = async (ms) => void waits.push(ms);
    });
  const chat = chatFor("chat-ada");
  const ledgerRows = () => ledgers.harness(ada.company).instance.modelCalls();
  return { fake, chat, chatFor, waits, clock, ledgerRows };
}

/** The adapter alone on the job route, which has no time bound: the 429 handling below runs unbounded. */
async function jobCall(script: FakeStep[]) {
  const fake = new FakeModel(script);
  const waits: number[] = [];
  const rows: ModelCallRow[] = [];
  const streamFn = createStreamFn({ ai: fake.binding as unknown as Ai, ledger: { record: async (r) => void rows.push(r) }, wait: async (ms) => void waits.push(ms), now: () => T0 }, { tenant: ada.company, person: ada.id, runId: "run-job", route: "job" });
  const message = await (await streamFn(modelFor("job"), normalizeContext({ messages: [{ role: "user", content: "Hi", timestamp: T0 }] }), {})).result();
  return { fake, waits, rows, message };
}

const framesOf = (frames: Array<Record<string, unknown>>, type: ChatFrame["type"]) => frames.filter((f) => f.type === type);

describe("[M1.1] chat recovery", () => {
  it("resumes a turn evicted with a tool call in flight and completes it exactly once", async () => {
    const { fake, chat, ledgerRows } = setup([
      { checkpoint: "tool-in-flight", step: { toolCall: { id: "call_ping", name: "send_to_user", arguments: { text: "Checking the calendar now." } } } },
      { text: "Your Tuesday is free." },
    ]);
    const socket = chat.connect();
    const first = chat.instance.send({ person: ada.id, text: "Is my Tuesday free?" });
    await fake.reached("tool-in-flight");
    // The platform evicts the object mid-stream; its in-flight request dies with it.
    chat.evict();
    fake.drop("tool-in-flight");
    await expect(first).rejects.toBeInstanceOf(Evicted);
    expect(chat.alarmAt).not.toBeNull();

    // The alarm builds a fresh instance over the same storage, which resumes the turn.
    const resumed = chat.fireAlarm();
    await fake.reached("tool-in-flight", 2);
    fake.release("tool-in-flight");
    await resumed;

    expect(framesOf(socket.frames, "message")).toEqual([{ type: "message", turn: expect.any(String), id: "call_ping", text: "Checking the calendar now." }]);
    expect(framesOf(socket.frames, "turn_done")).toHaveLength(1);
    expect(framesOf(socket.frames, "turn_failed")).toHaveLength(0);
    expect(chat.rows("SELECT role FROM messages ORDER BY seq").map((r) => r.role)).toEqual(["user", "assistant", "toolResult", "assistant"]);
    expect(chat.rows("SELECT status, steps FROM turns")).toEqual([{ status: "done", steps: 2 }]);
    expect(chat.rows("SELECT id FROM outbox WHERE delivered_at IS NOT NULL")).toEqual([{ id: "call_ping" }]);
    expect(chat.alarmAt).toBeNull();
    expect(fake.remaining).toBe(0);
    // The dead instance's broken call could not reach the Ledger; the two completed calls did.
    expect((await ledgerRows()).map((r) => r.status)).toEqual(["ok", "ok"]);
  });

  it("an alarm while the turn is still running here re-arms instead of starting a second run", async () => {
    const { fake, chat } = setup([{ checkpoint: "slow", step: { text: "Done." } }]);
    const turn = chat.instance.send({ person: ada.id, text: "Take your time." });
    await fake.reached("slow");
    await chat.fireAlarm();
    expect(chat.alarmAt).not.toBeNull();
    fake.release("slow");
    expect(await turn).toMatchObject({ status: "done" });
    expect(fake.requests).toHaveLength(1);
  });
});

describe("[M1.1] model adapter", () => {
  it("retries a 429 after its Retry-After and completes the call", async () => {
    const { waits, rows, message } = await jobCall([{ status: 429, retryAfter: 7 }, { text: "Hello Ada." }]);
    expect(message.stopReason).toBe("stop");
    expect(waits).toEqual([7000]);
    expect(rows.map((r) => [r.attempt, r.status, r.httpStatus])).toEqual([[1, "rate_limited", 429], [2, "ok", 200]]);
    expect(message.content).toEqual([{ type: "text", text: "Hello Ada." }]);
  });

  it("fails at once with MODEL_RATE_LIMITED when Retry-After is beyond the cap", async () => {
    const { waits, message, fake } = await jobCall([{ status: 429, retryAfter: 3600 }]);
    expect(message.errorMessage).toMatch(/^MODEL_RATE_LIMITED: /);
    expect(waits).toEqual([]);
    expect(fake.requests).toHaveLength(1);
  });

  it("a dropped stream surfaces as a failed turn, never as success", async () => {
    // A drop after the first token is the turn's: nothing is re-sent, to this model or another (D-0020).
    const dropped: FakeStep = { drop: { text: "Your Tuesday is completely free and", afterBytes: 150 } };
    const { chat, ledgerRows } = setup([dropped, dropped]);
    const socket = chat.connect();
    const result = await chat.instance.send({ person: ada.id, text: "Is my Tuesday free?" });
    expect(result).toMatchObject({ status: "failed", code: "MODEL_STREAM_DROPPED" });
    expect(framesOf(socket.frames, "turn_failed")).toEqual([{ type: "turn_failed", turn: expect.any(String), code: "MODEL_STREAM_DROPPED", reason: expect.any(String), text: failureText("MODEL_STREAM_DROPPED") }]);
    expect(framesOf(socket.frames, "turn_done")).toHaveLength(0);
    expect(framesOf(socket.frames, "message")).toHaveLength(0);
    expect(chat.rows("SELECT role FROM messages").map((r) => r.role)).toEqual(["user"]);
    expect(chat.rows("SELECT status, code FROM turns")).toEqual([{ status: "failed", code: "MODEL_STREAM_DROPPED" }]);
    expect((await ledgerRows()).map((r) => [r.attempt, r.status, r.code])).toEqual([[1, "dropped", "MODEL_STREAM_DROPPED"]]);
  });

  it("model traffic reaches only the fake binding, with no gateway option on a deploy with neither model var, and makes zero outbound requests", async () => {
    const { fake, chat } = setup([{ text: "Hi." }]);
    const before = hermeticNetwork.getUnmockedCalls().length;
    expect(await chat.instance.send({ person: ada.id, text: "Hi" })).toMatchObject({ status: "done" });
    expect(hermeticNetwork.getUnmockedCalls()).toHaveLength(before);
    expect(fake.requests).toHaveLength(1);
    // A deploy with neither model var (no gateway, no chat provider): Workers AI over the binding.
    expect(fake.requests[0]?.model).toBe("@cf/zai-org/glm-5.3-flash");
    expect(fake.requests[0]?.passthrough).toBeUndefined();
    expect(fake.requests[0]?.options.gateway).toBeUndefined();
    expect(fake.requests[0]?.inputs.stream).toBe(true);
  });

  it("writes a Ledger row per call with tenant, person, run id, route and tokens, for each of two members", async () => {
    const { chat, chatFor, ledgerRows } = setup([
      { reasoning: "A greeting back.", text: "Hi Ada.", usage: { prompt: 120, completion: 39, reasoning: 30 } },
      { reasoning: "Greet Bo.", text: "Hi Bo.", usage: { prompt: 140, completion: 27, reasoning: 20 } },
    ]);
    const a = await chat.instance.send({ person: ada.id, text: "Hello" });
    const b = await chatFor("chat-bo").instance.send({ person: other.id, text: "Hello" });
    if (a.status !== "done" || b.status !== "done") throw new Error("turns failed");
    expect(await ledgerRows()).toEqual([
      expect.objectContaining({ tenant: "solo-sam", person: ada.id, runId: a.turnId, route: "chat", model: "@cf/zai-org/glm-5.3-flash", provider: "workers-ai", status: "ok", inputTokens: 120, outputTokens: 39, reasoningTokens: 30 }),
      expect.objectContaining({ tenant: "solo-sam", person: other.id, runId: b.turnId, route: "chat", status: "ok", inputTokens: 140, outputTokens: 27, reasoningTokens: 20 }),
    ]);
  });
});

describe("[M1.1] chat turns", () => {
  it("refuses a message from anyone but the chat's owner with CHAT_NOT_OWNER", async () => {
    const { fake, chat } = setup([{ text: "Hi Ada." }]);
    expect(await chat.instance.send({ person: ada.id, text: "Hello" })).toMatchObject({ status: "done" });
    expect(await chat.instance.send({ person: other.id, text: "Show me Ada's chat" })).toEqual({ status: "refused", code: "CHAT_NOT_OWNER" });
    expect(fake.requests).toHaveLength(1);
  });

  it("each turn's request carries that turn's envelope and no earlier one", async () => {
    const { fake, chat, clock } = setup([{ text: "Morning." }, { text: "Afternoon." }]);
    await chat.instance.send({ person: ada.id, text: "First", timeZone: "Europe/London" });
    clock.now = T0 + 5 * 3_600_000;
    await chat.instance.send({ person: ada.id, text: "Second" });
    const second = fake.requests[1]?.inputs.messages ?? [];
    const envelopes = second.filter((m) => m.role === "system" && String(m.content).startsWith(ENVELOPE_HEADING));
    expect(envelopes).toHaveLength(1);
    expect(String(envelopes[0]?.content)).toContain("2026-10-12T14:00:00.000Z");
    expect(JSON.stringify(second)).not.toContain("2026-10-12T09:00:00.000Z");
    expect(second.at(-1)).toMatchObject({ role: "user", content: "Second" });
    expect(second.at(-2)).toBe(envelopes[0]);
  });

  it("refuses a tool call with malformed arguments with TOOL_ARGS_MALFORMED and the parse reason", async () => {
    const { fake, chat } = setup([{ rawToolCall: { name: "send_to_user", arguments: '{"text": "half' } }, { text: "Sorry, retrying later." }]);
    const socket = chat.connect();
    expect(await chat.instance.send({ person: ada.id, text: "Ping me" })).toMatchObject({ status: "done" });
    const tool = fake.requests[1]?.inputs.messages.find((m) => m.role === "tool");
    expect(String(tool?.content)).toMatch(/TOOL_ARGS_MALFORMED: arguments are not JSON/);
    expect(framesOf(socket.frames, "message")).toHaveLength(0);
  });

  it("stops a compromised model that calls a tool every step at the step limit, executing nothing", async () => {
    const { fake, chat, ledgerRows } = setup([], { kind: "compromised", hostile: { name: "transfer_funds", arguments: { to: "mallory", amount: 10_000 } } });
    const socket = chat.connect();
    expect(await chat.instance.send({ person: ada.id, text: "What's new?" })).toMatchObject({ status: "failed", code: "TURN_STEP_LIMIT" });
    expect(fake.requests).toHaveLength(8);
    expect(framesOf(socket.frames, "message")).toHaveLength(0);
    expect((await ledgerRows()).length).toBe(8);
    const results = chat.rows("SELECT body FROM messages WHERE role = 'toolResult'").map((r) => JSON.parse(String(r.body)));
    expect(results.every((r) => r.isError === true)).toBe(true);
  });

  it("streams reasoning deltas as reasoning frames, apart from the reply", async () => {
    const { chat } = setup([{ reasoning: "The person wants a greeting.", text: "Hello!", usage: { reasoning: 6 } }]);
    const socket = chat.connect();
    await chat.instance.send({ person: ada.id, text: "Hi" });
    expect(framesOf(socket.frames, "reasoning").map((f) => f.text).join("")).toBe("The person wants a greeting.");
    expect(framesOf(socket.frames, "delta").map((f) => f.text).join("")).toBe("Hello!");
  });
});

describe("[M1.1] compaction", () => {
  it("compacts earlier turns into a fenced summary once input tokens pass the threshold", async () => {
    const { fake, chat, ledgerRows } = setup([
      { text: "Noted: the Henley account renews in March.", usage: { prompt: 900_000 } },
      { text: "Ada asked about the Henley account; it renews in March." },
      { text: "It renews in March." },
    ]);
    await chat.instance.send({ person: ada.id, text: "Remember the Henley account renews in March." });
    expect(await chat.instance.send({ person: ada.id, text: "When does it renew?" })).toMatchObject({ status: "done" });
    const [, summaryCall, main] = fake.requests;
    expect(summaryCall?.inputs.messages[0]).toMatchObject({ role: "system", content: COMPACTION_PROMPT });
    const mainText = JSON.stringify(main?.inputs.messages);
    expect(mainText).toContain(SUMMARY_PREAMBLE);
    expect(mainText).toContain('[BEGIN EXTERNAL CONTENT source=\\"chat:compaction-summary\\"]');
    expect(mainText).not.toContain("Remember the Henley account renews in March.");
    expect((await ledgerRows()).map((r) => r.route)).toEqual(["chat", "compaction", "chat"]);
  });
});

/** A former member's label: rows and files keyed by a person who is not on the roster (fletch's fixtures hold one person). */
const other = { ...ada, id: "former-member", email: "former-member", name: "Pat" };
