// M15.2: each compaction leaves a row in its chat (Muse spec §15.1): the checkpoint seq, the first seq
// kept verbatim, the input tokens of the step that triggered it and of the first step after it, and
// the trigger, read back by the chat's owner for the dashboard and by no one else. Ada and Bo each
// compact their own chat over the scripted fake model and the real Ledger.
import { describe, expect, it } from "vitest";
import { ChatEngine, type EngineCtx } from "../../packages/agent/src/chat/engine.ts";
import { Ledger } from "../../packages/agent/src/objects/ledger.ts";
import { FakeModel } from "../support/fake-model.ts";
import { harnessNamespace, ObjectHarness } from "../support/object-harness.ts";
import people from "../fixtures/people.json" with { type: "json" };

const ada = people.people.find((p) => p.id === "sam-solo")!;
const T0 = Date.UTC(2026, 9, 13, 9, 0, 0);

function chatFor(name: string, before: number, after: number) {
  const fake = new FakeModel([
    { text: "Noted: the Henley account renews in March.", usage: { prompt: before } },
    { text: "The person asked about the Henley account; it renews in March." },
    { text: "It renews in March.", usage: { prompt: after } },
  ]);
  const ledgers = harnessNamespace((n) => new ObjectHarness(n, (ctx, env) => new Ledger(ctx as DurableObjectState, env as Env), {}));
  const env = { TENANT_ID: ada.company, QYVR_ENV: "staging", AI: fake.binding, LEDGER: ledgers.binding };
  const chat = new ObjectHarness(name, (ctx, e) => new ChatEngine(ctx as EngineCtx, e as Env), env, (c) => {
    c.now = () => T0;
    c.wait = async () => {};
  });
  return { fake, chat };
}

describe("[M15.2] compaction record", () => {
  it("a compaction's record reads back with its tokens before and after, to the chat's owner alone", async () => {
    const a = chatFor("chat-ada", 128_000, 9_400);
    const b = chatFor("chat-bo", 131_072, 8_100);
    for (const [who, c] of [[ada.id, a], [other.id, b]] as const) {
      await c.chat.instance.send({ person: who, text: "Remember the Henley account renews in March." });
      expect(c.chat.instance.compactionsFor(who)).toEqual([]);
      expect(await c.chat.instance.send({ person: who, text: "When does it renew?" })).toMatchObject({ status: "done" });
      expect(c.fake.requests).toHaveLength(3);
    }
    // Two messages from the first turn compacted; the second turn's message (seq 3) is the first kept.
    expect(a.chat.instance.compactionsFor(ada.id)).toEqual([{ id: 1, turnId: expect.any(String), checkpointSeq: 3, firstKeptSeq: 3, tokensBefore: 128_000, tokensAfter: 9_400, trigger: "threshold", at: T0, status: "done", code: null, reason: null }]);
    expect(b.chat.instance.compactionsFor(other.id)).toMatchObject([{ tokensBefore: 131_072, tokensAfter: 8_100, trigger: "threshold" }]);
    // The record's turn is the turn that compacted, and the summarised messages are marked, not deleted.
    const [rec] = a.chat.instance.compactionsFor(ada.id) ?? [];
    expect(a.chat.rows("SELECT id FROM turns ORDER BY started_at, rowid").map((r) => r.id)).toContain(rec?.turnId);
    expect(a.chat.rows("SELECT seq, compacted FROM messages ORDER BY seq").slice(0, 3)).toEqual([{ seq: 1, compacted: 1 }, { seq: 2, compacted: 1 }, { seq: 3, compacted: 0 }]);
    // Each owner's chat answers its owner only.
    expect(a.chat.instance.compactionsFor(other.id)).toBeNull();
    expect(b.chat.instance.compactionsFor(ada.id)).toBeNull();
  });

  it("a turn under the threshold leaves no record", async () => {
    const c = chatFor("chat-ada", 127_999, 9_000);
    c.fake.requests.length = 0;
    await c.chat.instance.send({ person: ada.id, text: "Remember the Henley account renews in March." });
    await c.chat.instance.send({ person: ada.id, text: "When does it renew?" });
    expect(c.chat.instance.compactionsFor(ada.id)).toEqual([]);
  });
});

/** A former member's label: rows and files keyed by a person who is not on the roster (fletch's fixtures hold one person). */
const other = { ...ada, id: "former-member", email: "former-member", name: "Pat" };
