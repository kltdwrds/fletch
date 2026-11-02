// Meta's prompt cache (dev.meta.ai/docs/prompt-caching) reuses a request's longest prefix that an earlier request on
// the same backend already computed, and nothing after the first byte that differs. A chat on Muse Spark caches well
// only if every request it sends repeats the one before it byte for byte up to what is new: a step extends its turn's
// last request, and a turn's first request extends the turn before's last one. Measured on a preview slot on
// 2026-11-02: each turn's first request diverged where the turn before's envelope had been dropped, or inside the
// tools when a namespace loaded mid-turn came back in another order, and paid for the history again. Every claim runs
// the production engine over the scripted fake on the shipped vars, or the production tool session (D-0024).
import { Type } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import { experimental_readRawConfig } from "wrangler";
import { ChatEngine, type EngineCtx } from "../../packages/agent/src/chat/engine.ts";
import { ENVELOPE_HEADING } from "../../packages/agent/src/context/assemble.ts";
import { Ledger } from "../../packages/agent/src/objects/ledger.ts";
import { type Namespace, ToolRegistry, ToolSession, type ToolSpec } from "../../packages/agent/src/tools/registry.ts";
import { FakeModel, type FakeRequest, type FakeStep } from "../support/fake-model.ts";
import { Evicted, harnessNamespace, ObjectHarness } from "../support/object-harness.ts";
import people from "../fixtures/people.json" with { type: "json" };

const sam = people.people.find((p) => p.id === "sam-solo")!;
const T0 = Date.UTC(2026, 10, 2, 9, 0, 0);
const BASE_VARS = experimental_readRawConfig({ config: "packages/agent/wrangler.jsonc" }).rawConfig.vars as Record<string, string>;
const VARS: Record<string, string> = { ...BASE_VARS, TENANT_ID: "base", OWNER_EMAIL: sam.email };

function setup(script: FakeStep[]) {
  const fake = new FakeModel(script);
  const ledgers = harnessNamespace((name) => new ObjectHarness(name, (ctx, env) => new Ledger(ctx as DurableObjectState, env as Env), { QYVR_ENV: VARS.QYVR_ENV }));
  const clock = { now: T0 };
  const chat = new ObjectHarness("chat-sam", (ctx, e) => new ChatEngine(ctx as EngineCtx, e as Env), { ...VARS, AI: fake.binding, LEDGER: ledgers.binding }, (c) => {
    c.now = () => clock.now;
    c.wait = async () => {};
  });
  return { fake, chat, clock };
}

/** A request as the provider reads it: the tools, then every message, in order. */
const wire = (r: FakeRequest | undefined) => [JSON.stringify(r?.inputs.tools ?? []), ...(r?.inputs.messages ?? []).map((m) => JSON.stringify(m))];
const envelopes = (r: FakeRequest | undefined) => (r?.inputs.messages ?? []).filter((m) => String(m.content).startsWith(ENVELOPE_HEADING));
const ping = (id: string, text: string): FakeStep => ({ toolCall: { id, name: "send_to_user", arguments: { text } } });

describe("[F1] Meta's prompt cache: each request repeats the one before it", () => {
  it("a turn's first request starts with the turn before's last request, its envelope where it was sent, through a resumed step", async () => {
    const { fake, chat, clock } = setup([
      ping("c1", "Looking."),
      { text: "Turn one." },
      { checkpoint: "turn-two", step: ping("c2", "Looking again.") },
      { text: "Turn two." },
      { text: "Turn three." },
    ]);
    expect(await chat.instance.send({ person: sam.email, text: "First" })).toMatchObject({ status: "done" });
    clock.now = T0 + 3_600_000;
    // Turn two's first step is evicted in flight and resumed from its recorded projection.
    const evicted = chat.instance.send({ person: sam.email, text: "Second" });
    await fake.reached("turn-two");
    chat.evict();
    fake.drop("turn-two");
    await expect(evicted).rejects.toBeInstanceOf(Evicted);
    const resumed = chat.fireAlarm();
    await fake.reached("turn-two", 2);
    fake.release("turn-two");
    await resumed;
    clock.now = T0 + 2 * 3_600_000;
    expect(await chat.instance.send({ person: sam.email, text: "Third" })).toMatchObject({ status: "done" });

    // Requests: turn one 0-1, turn two 2 (evicted), 3 (resumed) and 4, turn three 5.
    const r = fake.requests;
    expect(r).toHaveLength(6);
    expect(wire(r[3])).toEqual(wire(r[2]));
    for (const [last, first] of [[1, 2], [4, 5]] as const) expect(wire(r[first]).slice(0, wire(r[last]).length)).toEqual(wire(r[last]));
    // Each turn's envelope stays before the user message it was sent with; the latest carries this turn's time.
    expect(envelopes(r[5]).map((e) => String(e.content).match(/now: (\S+)/)?.[1])).toEqual(["2026-11-02T09:00:00.000Z", "2026-11-02T10:00:00.000Z", "2026-11-02T11:00:00.000Z"]);
    // Meta folds system messages into the leading one by role, so each envelope goes to it as a user message in place,
    // and the stable prefix is the only system message it reads.
    for (const req of r) {
      expect(envelopes(req).map((e) => e.role)).toEqual(envelopes(req).map(() => "user"));
      expect(req.inputs.messages.filter((m) => m.role === "system")).toHaveLength(1);
    }
    expect(r[5]?.inputs.messages.at(-1)).toMatchObject({ role: "user", content: "Third" });
    expect(String(r[5]?.inputs.messages.at(-2)?.content)).toContain("now: 2026-11-02T11:00:00.000Z");
    // The stored transcript holds no envelope.
    expect(chat.rows("SELECT body FROM messages").some((row) => String(row.body).includes(ENVELOPE_HEADING))).toBe(false);
  });

  it("a namespace loaded mid-turn keeps its place in the tools on every later turn", () => {
    const spec = (name: string): ToolSpec => ({ name, kind: "observation", label: name, description: name, parameters: Type.Object({}), execute: async () => ({ content: [], details: {} }) });
    const ns = (name: string, deferral: Namespace["deferral"]): Namespace => ({ name, description: name, deferral, tools: [spec(`${name}_tool`)] });
    // Registry order puts the deferred `alpha` before `beta` and both before the eager `zulu`.
    const registry = new ToolRegistry([ns("alpha", "names"), ns("beta", "names"), ns("zulu", "eager")]);
    const turn = new ToolSession(registry, []);
    expect(turn.load(["beta"])).toMatchObject({ ok: true });
    expect(turn.load(["alpha"])).toMatchObject({ ok: true });
    const next = new ToolSession(registry, turn.loaded);
    expect(next.tools.map((t) => t.name)).toEqual(turn.tools.map((t) => t.name));
    expect(next.tools.map((t) => t.name)).toEqual(["zulu_tool", "beta_tool", "alpha_tool"]);
  });
});
