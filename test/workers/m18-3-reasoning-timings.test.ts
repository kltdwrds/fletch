// M18.3: the chat route reasons at low effort and every model call records when it started, when its
// first token arrived and when it finished. The request each route sends is read off the scripted
// fake; the timings go adapter to Ledger row to cost report on the production modules, with the clock
// moved by the test at the events it observes (no sleeps).
import { normalizeContext } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import { costReport, type TimedCall } from "../../packages/agent/src/loops/cost-report.ts";
import { createStreamFn } from "../../packages/agent/src/model/adapter.ts";
import { modelConfig, modelFor, REASONING_EFFORT, ROUTES, type ChatRoute } from "../../packages/agent/src/model/routes.ts";
import type { ModelCallRow } from "../../packages/agent/src/ledger/types.ts";
import { Ledger } from "../../packages/agent/src/objects/ledger.ts";
import { FakeModel } from "../support/fake-model.ts";
import { ObjectHarness } from "../support/object-harness.ts";
import { ada, T0 } from "./support/authority-world.ts";

/** A deploy configured as qyvr-co's: chat on OpenRouter through gateway `qyvr`, hedged to Workers AI. */
const OPENROUTER = modelConfig({ AI_GATEWAY_ID: "qyvr", CHAT_PROVIDER: "openrouter" });

const hello = normalizeContext({ messages: [{ role: "user", content: "hello", timestamp: 0 }] });

/** One call on `route` through the adapter; `clock` is the test's, `ledger` takes every row. */
async function call(route: ChatRoute, person: string, clock: { t: number }, rows: ModelCallRow[]) {
  const fake = new FakeModel([{ text: "Hi there." }]);
  const ai = fake.binding as unknown as Ai;
  const streamFn = createStreamFn(
    { ai, ledger: { record: async (r) => void rows.push(r) }, wait: async () => {}, now: () => clock.t },
    { tenant: "solo-sam", person, runId: `run-${route}`, route },
  );
  const message = await (await streamFn(modelFor(route), hello, {})).result();
  return { fake, message };
}

describe("[M18.3] reasoning effort per route", () => {
  it("the chat route's request carries effort low, in its provider's spelling, and no other route sends one", async () => {
    const sent: Record<string, unknown> = {};
    for (const route of Object.keys(ROUTES) as ChatRoute[]) {
      const { fake } = await call(route, ada.email, { t: T0 }, []);
      const inputs = fake.requests[0]?.inputs;
      sent[route] = inputs?.reasoning_effort ?? inputs?.reasoning;
    }
    // A self-host deploy's chat route is Workers AI, which spells it `reasoning_effort`.
    expect(sent.chat).toBe("low");
    for (const route of Object.keys(ROUTES) as ChatRoute[]) {
      if (route !== "chat") expect(sent[route], `route ${route}`).toBeUndefined();
    }
    // The table the adapter reads names the chat route alone: another route's effort is a later, measured change.
    expect(REASONING_EFFORT).toEqual({ chat: "low" });
  });

  it("the job route's request has no reasoning_effort key at all, for either member", async () => {
    for (const person of [ada.email]) {
      const { fake } = await call("job", person, { t: T0 }, []);
      expect(Object.keys(fake.requests[0]?.inputs ?? {})).not.toContain("reasoning_effort");
    }
  });
});

describe("[M18.3] the clock of a model call", () => {
  it("records start, first token and finish from the production adapter into the Ledger's row", async () => {
    const clock = { t: 10_000 };
    const rows: ModelCallRow[] = [];
    // The fake pauses after its first delta, so the test moves the clock between first token and finish.
    const fake = new FakeModel([{ checkpoint: "mid", step: { text: "hello there friend" } }]);
    // On a deploy that puts the chat route on OpenRouter, its primary goes through the gateway (M22.1).
    const ai = {
      fetch: (input: string, init: RequestInit) => {
        clock.t += 1_500;
        return fake.binding.fetch(input, init);
      },
    } as unknown as Ai;
    const streamFn = createStreamFn(
      { ai, ledger: { record: async (r) => void rows.push(r) }, wait: async () => {}, now: () => clock.t, models: OPENROUTER },
      { tenant: "solo-sam", person: ada.email, runId: "run-clock", route: "chat" },
    );
    let released = false;
    for await (const ev of await streamFn(modelFor("chat", OPENROUTER), hello, {})) {
      if (ev.type === "text_start" && !released) {
        released = true;
        clock.t += 2_500;
        fake.release("mid");
      }
    }
    expect(released).toBe(true);
    expect(rows).toEqual([expect.objectContaining({ status: "ok", startedAt: 10_000, firstTokenAt: 11_500, finishedAt: 14_000 })]);

    const h = new ObjectHarness("ledger-clock", (ctx, env) => new Ledger(ctx as DurableObjectState, env as Env), { TENANT_ID: "solo-sam", QYVR_ENV: "test" });
    await h.instance.record(rows[0] as ModelCallRow);
    expect(await h.instance.modelCalls({ person: ada.email })).toEqual([expect.objectContaining({ startedAt: 10_000, firstTokenAt: 11_500, finishedAt: 14_000 })]);
  });

  it("a refused call never ran, so its row has no times; a failed call has start and finish but no first token", async () => {
    const clock = { t: 5_000 };
    const rows: ModelCallRow[] = [];
    const down = async () => { clock.t += 40; throw new Error("binding down"); };
    const ai = { run: down, fetch: down } as unknown as Ai;
    const who = { tenant: "solo-sam", person: ada.email, runId: "run-fail", route: "chat" as const };
    const base = { wait: async () => {}, now: () => clock.t, models: OPENROUTER };
    await (await createStreamFn({ ...base, ai, ledger: { record: async (r) => void rows.push(r) } }, who)(modelFor("chat", OPENROUTER), hello, {})).result();
    const refusing = { record: async (r: ModelCallRow) => void rows.push(r), admit: async () => ({ ok: false as const, code: "BUDGET_PERSON_EXHAUSTED" as const, reason: "spent" }) };
    await (await createStreamFn({ ...base, ai, ledger: refusing }, { ...who, runId: "run-refused" })(modelFor("chat", OPENROUTER), hello, {})).result();
    // The failed primary went to the hedge (M22.1), which failed too: each attempt timed on its own.
    expect(rows).toEqual([
      expect.objectContaining({ attempt: 1, status: "failed", code: "MODEL_CALL_FAILED", startedAt: 5_000, firstTokenAt: null, finishedAt: 5_040 }),
      expect.objectContaining({ attempt: 2, status: "failed", code: "MODEL_CALL_FAILED", startedAt: 5_040, firstTokenAt: null, finishedAt: 5_080 }),
      expect.objectContaining({ status: "refused", code: "BUDGET_PERSON_EXHAUSTED", startedAt: null, firstTokenAt: null, finishedAt: null }),
    ]);
  });
});

describe("[M18.3] the cost report's answer times", () => {
  const timed = (route: string, person: string, ttft: number | null, total: number | null, over: Partial<TimedCall> = {}): TimedCall => ({
    person, runId: `${route}-${ttft}-${total}`, inputTokens: 10, outputTokens: 5, at: T0, costMicros: 0,
    route: route as TimedCall["route"], status: "ok",
    startedAt: total === null ? null : 1_000, firstTokenAt: total === null || ttft === null ? null : 1_000 + ttft, finishedAt: total === null ? null : 1_000 + total,
    ...over,
  });

  it("a route with calls but no timed ones reads n/a, never zero", () => {
    const report = costReport("2026-10", [timed("chat", ada.email, null, null)], [])!;
    expect(report.routes).toEqual([{ route: "chat", calls: 1, firstToken: null, duration: null }]);
    expect(report.markdown).toContain("| chat | 1 | n/a | n/a | n/a | n/a |");
  });
});
