// M14.3: compaction fires at min(0.75 × window, 128,000) input tokens (Muse spec §15.3), not at a
// share of GLM 5.3 Flash's 1,048,576-token window alone. The Chat object over the scripted fake
// model and the real Ledger, as M1.1's compaction test runs it. Fixture person: Sam Solo.
import { describe, expect, it } from "vitest";
import { ChatEngine, type EngineCtx } from "../../packages/agent/src/chat/engine.ts";
import { COMPACT_AT_MAX_TOKENS, COMPACTION_PROMPT, compactionThreshold } from "../../packages/agent/src/chat/compaction.ts";
import { modelFor } from "../../packages/agent/src/model/routes.ts";
import { Ledger } from "../../packages/agent/src/objects/ledger.ts";
import { FakeModel, type FakeStep } from "../support/fake-model.ts";
import { harnessNamespace, ObjectHarness } from "../support/object-harness.ts";
import people from "../fixtures/people.json" with { type: "json" };

const ada = people.people.find((p) => p.id === "sam-solo")!;
const T0 = Date.UTC(2026, 9, 13, 9, 0, 0);

function setup(script: FakeStep[]) {
  const fake = new FakeModel(script);
  const ledgers = harnessNamespace((name) => new ObjectHarness(name, (ctx, env) => new Ledger(ctx as DurableObjectState, env as Env), {}));
  const env = { TENANT_ID: ada.company, QYVR_ENV: "staging", AI: fake.binding, LEDGER: ledgers.binding };
  const chat = new ObjectHarness("chat-ada", (ctx, e) => new ChatEngine(ctx as EngineCtx, e as Env), env, (c) => {
    c.now = () => T0;
    c.wait = async () => {};
  });
  const ledgerRows = () => ledgers.harness(ada.company).instance.modelCalls();
  return { fake, chat, ledgerRows };
}

describe("[M14.3] compaction", () => {
  it("the threshold is min(0.75 × window, 128,000): the chat model's 1M window compacts at 128,000", () => {
    const chat = modelFor("chat");
    expect(chat.contextWindow * 0.75).toBeGreaterThan(COMPACT_AT_MAX_TOKENS);
    expect(compactionThreshold(chat)).toBe(128_000);
    expect(compactionThreshold({ ...chat, contextWindow: 100_000 })).toBe(75_000);
  });

  it("a chat whose last step reached 128,000 input tokens compacts on its next turn, with the compaction's Ledger row", async () => {
    const { fake, chat, ledgerRows } = setup([
      { text: "Noted: the Henley account renews in March.", usage: { prompt: 128_000 } },
      { text: "Ada asked about the Henley account; it renews in March." },
      { text: "It renews in March." },
    ]);
    await chat.instance.send({ person: ada.id, text: "Remember the Henley account renews in March." });
    expect(await chat.instance.send({ person: ada.id, text: "When does it renew?" })).toMatchObject({ status: "done" });
    const [, summaryCall, main] = fake.requests;
    expect(summaryCall?.inputs.messages[0]).toMatchObject({ role: "system", content: COMPACTION_PROMPT });
    expect(JSON.stringify(main?.inputs.messages)).not.toContain("Remember the Henley account renews in March.");
    const rows = await ledgerRows();
    expect(rows.map((r) => r.route)).toEqual(["chat", "compaction", "chat"]);
    expect(rows[1]).toMatchObject({ route: "compaction", person: ada.id });
  });

  it("one token under the cap does not compact: the next turn is one chat call", async () => {
    const { fake, chat, ledgerRows } = setup([
      { text: "Noted.", usage: { prompt: 127_999 } },
      { text: "It renews in March." },
    ]);
    await chat.instance.send({ person: ada.id, text: "Remember the Henley account renews in March." });
    await chat.instance.send({ person: ada.id, text: "When does it renew?" });
    expect(fake.requests).toHaveLength(2);
    expect(JSON.stringify(fake.requests[1]?.inputs.messages)).toContain("Remember the Henley account renews in March.");
    expect((await ledgerRows()).map((r) => r.route)).toEqual(["chat", "chat"]);
  });
});
