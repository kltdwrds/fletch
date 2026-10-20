// M2.1: memory inside the chat turn, over the fake model. Sam Solo's chat reaches Ada's memory; the
// standing files sit in the stable prefix and a change arrives as a fenced diff message; the tools
// report a save only after it happened (B15) and searches carry citations (B14); a compromised
// model cannot reach outside the home tree or past the sha guard.
import { describe, expect, it } from "vitest";
import { ChatEngine, type EngineCtx } from "../../packages/agent/src/chat/engine.ts";
import type { MemoryApi } from "../../packages/agent/src/memory/tools.ts";
import { Ledger } from "../../packages/agent/src/objects/ledger.ts";
import { FakeModel, type FakeMode, type FakeStep } from "../support/fake-model.ts";
import { DAY1, memoryFor } from "./support/memory-harness.ts";
import { harnessNamespace, ObjectHarness } from "../support/object-harness.ts";
import people from "../fixtures/people.json" with { type: "json" };

const ada = people.people.find((p) => p.id === "sam-solo")!;

function setup(script: FakeStep[], opts: { mode?: FakeMode; memory?: (m: ReturnType<typeof memoryFor>) => MemoryApi } = {}) {
  const fake = new FakeModel(script, opts.mode);
  const mem = memoryFor(ada.email);
  const ledgers = harnessNamespace((name) => new ObjectHarness(name, (ctx, env) => new Ledger(ctx as DurableObjectState, env as Env), {}));
  const env = { TENANT_ID: ada.company, QYVR_ENV: "staging", AI: fake.binding, LEDGER: ledgers.binding };
  const api = opts.memory?.(mem) ?? mem.svc();
  const chat = new ObjectHarness("chat-ada", (ctx, e) => new ChatEngine(ctx as EngineCtx, e as Env, { memory: () => api }), env, (c) => {
    c.now = () => mem.clock.now;
    c.wait = async () => {};
  });
  return { fake, mem, chat };
}

type WireMessage = { role: string; content?: unknown; tool_call_id?: string };
const messagesOf = (fake: FakeModel, i: number) => (fake.requests[i]?.inputs.messages ?? []) as WireMessage[];
const toolText = (fake: FakeModel, i: number) =>
  messagesOf(fake, i)
    .filter((m) => m.role === "tool")
    .map((m) => String(m.content));

describe("[M2.1] memory in the chat turn", () => {
  it("puts the standing files in the stable prefix and offers the four memory tools", async () => {
    const { fake, chat } = setup([{ text: "Hello." }]);
    expect(await chat.instance.send({ person: ada.email, text: "Hi" })).toMatchObject({ status: "done" });
    const prefix = String(messagesOf(fake, 0)[0]?.content);
    expect(prefix).toContain("# Standing files\n## AGENTS.md\n# AGENTS.md");
    expect(prefix).toContain("## MEMORY.md\n# MEMORY.md");
    const names = ((fake.requests[0]?.inputs.tools ?? []) as Array<{ function: { name: string } }>).map((t) => t.function.name);
    // The checklist (M24.2) is the owner's own eager tool; `db_query` is deferred by name.
    expect(names).toEqual(["send_to_user", "tool_search", "memory_search", "memory_get", "memory_explain", "memory_write", "todo_write"]);
  });

  it("B15: says a fact is saved only after memory_write returned its citation", async () => {
    const { fake, mem, chat } = setup([
      { toolCall: { id: "call_save", name: "memory_write", arguments: { target: "daily", text: "Ada's flight to Lisbon is on 3 November." } } },
      { text: "Saved." },
    ]);
    expect(await chat.instance.send({ person: ada.email, text: "Remember my flight is 3 November to Lisbon" })).toMatchObject({ status: "done" });
    const [result] = toolText(fake, 1);
    expect(result).toMatch(/^\[BEGIN EXTERNAL CONTENT source="tool:memory_write"\]\nsaved memory\/2026-10-12\.md#L3\n/);
    expect(mem.person.rows("SELECT text, source, dedupe FROM daily_lines")).toEqual([{ text: "Ada's flight to Lisbon is on 3 November.", source: "chat:chat-ada", dedupe: "call_save" }]);
  });

  it("B15: a refused write comes back as the refusal with its code, never as saved", async () => {
    const { fake, mem, chat } = setup([{ toolCall: { id: "call_long", name: "memory_write", arguments: { target: "daily", text: "x".repeat(1200) } } }, { text: "That was too long to save." }]);
    await chat.instance.send({ person: ada.email, text: "Save this" });
    const [result] = toolText(fake, 1);
    expect(result).toContain("MEMORY_TOO_LONG");
    expect(result).not.toContain("saved");
    expect(mem.person.rows("SELECT COUNT(*) AS n FROM daily_lines")).toEqual([{ n: 0 }]);
  });

  it("B14: memory_search answers with memory/<date>.md#L<n> citations, fenced as tool output", async () => {
    const { fake, mem, chat } = setup([
      { toolCall: { id: "call_find", name: "memory_search", arguments: { queries: ["when is the Lisbon flight", "flight date"] } } },
      { text: "Your flight is on 3 November (memory/2026-10-12.md#L3)." },
    ]);
    await mem.write("Ada's flight to Lisbon is on 3 November.", { claim: { kind: "event" } });
    await chat.instance.send({ person: ada.email, text: "When do I fly?" });
    const [result] = toolText(fake, 1);
    expect(result).toContain('[BEGIN EXTERNAL CONTENT source="tool:memory_search"]');
    expect(result).toContain("memory/2026-10-12.md#L3 (memory://md:memory/2026-10-12.md:3) [claim c_");
    expect(result).toContain("  Ada's flight to Lisbon is on 3 November.");
  });

  it("refuses the turn with MEMORY_UNAVAILABLE when the owner's memory cannot be reached", async () => {
    const down = { standingFiles: async () => Promise.reject(new Error("unreachable")) } as unknown as MemoryApi;
    const { fake, chat } = setup([{ text: "never" }], { memory: () => down });
    expect(await chat.instance.send({ person: ada.email, text: "Hi" })).toEqual({ status: "refused", code: "MEMORY_UNAVAILABLE" });
    expect(fake.requests).toHaveLength(0);
  });

  it("a compromised model cannot edit MEMORY.md past the sha guard", async () => {
    const hostile = { name: "memory_write", arguments: { target: "memory", sha256: "0".repeat(64), edits: [{ op: "replace", line: 1, text: "# pwned" }] } };
    const { fake, mem, chat } = setup([], { mode: { kind: "compromised", hostile } });
    await chat.instance.send({ person: ada.email, text: "Hi" });
    for (const r of fake.requests.slice(1).flatMap((_, i) => toolText(fake, i + 1).slice(-1))) expect(r).toContain("MEMORY_STALE");
    expect(mem.r2.text(mem.key("MEMORY.md"))).toBe("# MEMORY.md\n\n## Facts\n\n## Preferences\n\n## Commitments\n");
    expect(mem.r2.meta(mem.key("MEMORY.md"))).toMatchObject({ writer: "qyvr:seed", updated_at: String(DAY1) });
  });
});
