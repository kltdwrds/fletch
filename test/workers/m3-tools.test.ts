// M3.1: the tool registry in the chat turn over the fake model. Namespaces and the two deferral
// levels, tool_search as the discovery and loading path, the loaded set surviving eviction, the
// reference generated from the schemas, and actions performed only from the outbox after the
// barrier. Fixture namespaces stand in for the connectors of later parts.
import { Type } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import { ChatEngine, type EngineCtx, LOADED_NAMESPACES_KEY } from "../../packages/agent/src/chat/engine.ts";
import { PersonAuthority } from "../../packages/agent/src/grants/authority.ts";
import { Ledger } from "../../packages/agent/src/objects/ledger.ts";
import { TOOLS_HEADING, toolReference } from "../../packages/agent/src/tools/reference.ts";
import { type Namespace, ToolRegistry, type ToolSpec } from "../../packages/agent/src/tools/registry.ts";
import { FakeModel, type FakeStep } from "../support/fake-model.ts";
import { harnessNamespace, ObjectHarness } from "../support/object-harness.ts";
import people from "../fixtures/people.json" with { type: "json" };

const ada = people.people.find((p) => p.id === "sam-solo")!;

function fixtures(log: string[]): Namespace[] {
  const ping: ToolSpec = {
    name: "demo_ping",
    kind: "observation",
    label: "Ping",
    description: "Ping the demo service and read its clock.",
    parameters: Type.Object({ echo: Type.String({ description: "Text the service echoes back." }) }),
    execute: async (_id, p) => {
      log.push(`ping:${(p as { echo: string }).echo}`);
      return { content: [{ type: "text", text: `pong ${(p as { echo: string }).echo}` }], details: {} };
    },
  };
  const post: ToolSpec = {
    name: "demo_post",
    kind: "action",
    actionKind: "demo.post",
    label: "Post",
    description: "Post a note to the demo board.",
    parameters: Type.Object({ note: Type.String() }),
    execute: async (id, p) => {
      log.push(`post:${id}:${(p as { note: string }).note}`);
      return { content: [{ type: "text", text: "posted" }], details: {} };
    },
  };
  const hidden: Namespace = { name: "demo", description: "a demo connector for tests", deferral: "hidden", tools: [ping, post] };
  const shown: Namespace = { name: "board", description: "the demo board", deferral: "names", tools: [{ ...post, name: "board_post", description: "Post a note to the board." }] };
  return [hidden, shown];
}

function setup(script: FakeStep[]) {
  const fake = new FakeModel(script);
  const log: string[] = [];
  const ledgers = harnessNamespace((name) => new ObjectHarness(name, (ctx, env) => new Ledger(ctx as DurableObjectState, env as Env), {}));
  const env = { TENANT_ID: ada.company, TENANT_SHAPE: "company", QYVR_ENV: "staging", AI: fake.binding, LEDGER: ledgers.binding };
  // Since M7.1 every action runs under a grant: Ada's own-agent grant for the demo board's posts.
  const company = { snapshot: async () => ({ members: [{ email: ada.email, role: "admin" as const }], teams: {}, policies: [], grants: [], uses: {} }), use: async () => "spent" as const };
  const person = new ObjectHarness(ada.email, (ctx) => new PersonAuthority((ctx as DurableObjectState).storage, ada.company, ada.email, company, () => Date.now()), {});
  person.instance.create(ada.email, { grantor: { kind: "person", id: ada.email }, grantee: { kind: "own-agent" }, subject: { kind: "action-kind", ref: "demo.post" }, mode: "auto", created_from: "chat-confirmation" });
  const authority = () => ({ decide: (d: never) => person.instance.decide(d), commit: (d: never, e: string) => person.instance.commit(d, e), createGrant: async (by: string, i: unknown) => person.instance.create(by, i) });
  const chat = new ObjectHarness("chat-ada", (ctx, e) => new ChatEngine(ctx as EngineCtx, e as Env, { namespaces: fixtures(log), authority }), env, (c) => {
    c.wait = async () => {};
  });
  return { fake, log, chat };
}

type WireMessage = { role: string; content?: unknown };
const messagesOf = (fake: FakeModel, i: number) => (fake.requests[i]?.inputs.messages ?? []) as WireMessage[];
const toolNames = (fake: FakeModel, i: number) => ((fake.requests[i]?.inputs.tools ?? []) as Array<{ function: { name: string } }>).map((t) => t.function.name);
const toolText = (fake: FakeModel, i: number) => messagesOf(fake, i).filter((m) => m.role === "tool").map((m) => String(m.content));
const prefixOf = (fake: FakeModel, i: number) => String(messagesOf(fake, i)[0]?.content);

describe("[M3.1] tool registry", () => {
  it("a deferred namespace loads on demand and stays loaded, across turns and an eviction", async () => {
    const { fake, log, chat } = setup([
      { toolCall: { id: "c1", name: "tool_search", arguments: { query: "ping clock" } } },
      { toolCall: { id: "c2", name: "tool_search", arguments: { load: ["demo"] } } },
      { toolCall: { id: "c3", name: "demo_ping", arguments: { echo: "hi" } } },
      { text: "pong." },
      { text: "still here." },
    ]);
    expect(await chat.instance.send({ person: ada.email, text: "ping the demo" })).toMatchObject({ status: "done" });
    // Before the load: hidden means hidden, in the schemas and in the reference, yet searchable.
    expect(toolNames(fake, 0)).not.toContain("demo_ping");
    expect(prefixOf(fake, 0)).not.toContain("demo_ping");
    expect(prefixOf(fake, 0)).toContain("## more: 1 further namespace with 2 tools; tool_search finds and loads them");
    expect(toolText(fake, 1)[0]).toContain("- demo_ping (demo, not loaded, observation): Ping the demo service and read its clock.");
    // The load: callable from the next step, within the same turn.
    expect(toolNames(fake, 1)).not.toContain("demo_ping");
    expect(toolText(fake, 2)[1]).toContain("loaded demo: callable from your next step");
    expect(toolNames(fake, 2)).toContain("demo_ping");
    expect(toolText(fake, 3)[2]).toContain("pong hi");
    expect(log).toEqual(["ping:hi"]);
    expect(chat.rows(`SELECT value FROM chat_meta WHERE key = '${LOADED_NAMESPACES_KEY}'`)).toEqual([{ value: '["demo"]' }]);

    chat.evict();
    expect(await chat.instance.send({ person: ada.email, text: "again" })).toMatchObject({ status: "done" });
    expect(toolNames(fake, 4)).toContain("demo_ping");
    expect(prefixOf(fake, 4)).toContain("## demo: a demo connector for tests\n- demo_ping (observation: runs now and returns its result): Ping the demo service and read its clock.\n  echo: string: Text the service echoes back.");
  });

  it("the reference is generated from the schemas: loaded tools with parameters, names-level stubs by name, hidden ones as a count", () => {
    const registry = new ToolRegistry(fixtures([]));
    const before = toolReference(registry.namespaces, new Set());
    expect(before.startsWith(`${TOOLS_HEADING}\n`)).toBe(true);
    expect(before).toContain('## board: the demo board (not loaded; tool_search with load: ["board"] loads its schemas)\n- board_post (action): Post a note to the board.');
    expect(before).not.toContain("note: string");
    expect(before).toContain("## more: 1 further namespace with 2 tools");
    const after = toolReference(registry.namespaces, new Set(["board", "demo"]));
    expect(after).toContain("- board_post (action: queued, performed after this step is committed): Post a note to the board.\n  note: string");
    expect(after).toContain("- demo_post (action: queued, performed after this step is committed): Post a note to the demo board.\n  note: string");
    expect(after).not.toContain("## more");
    // The parameter lines come from the schema the model also receives: a renamed field renames the reference.
    const renamed = new ToolRegistry([{ ...fixtures([])[1]!, tools: [{ ...fixtures([])[1]!.tools[0]!, parameters: Type.Object({ body: Type.String({ minLength: 1 }) }) }] }]);
    expect(toolReference(renamed.namespaces, new Set(["board"]))).toContain("  body: string (min length 1)");
  });

  it("an action is queued at the call and performed once from the outbox after the barrier, never during the step", async () => {
    const { fake, log, chat } = setup([
      { toolCall: { id: "c1", name: "tool_search", arguments: { load: ["board"] } } },
      { toolCall: { id: "post-1", name: "board_post", arguments: { note: "ship it" } } },
      { text: "posted." },
    ]);
    const socket = chat.connect();
    expect(await chat.instance.send({ person: ada.email, text: "post it" })).toMatchObject({ status: "done" });
    // The model saw a queued receipt, not a result, and the performer ran after the step was committed.
    expect(toolText(fake, 2)[1]).toMatch(/queued as post-1 under grant g_[0-9a-f]{32}; it is performed after this step is committed/);
    expect(log).toEqual(["post:post-1:ship it"]);
    const rows = chat.rows("SELECT payload, delivered_at IS NOT NULL AS delivered FROM outbox");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.delivered).toBe(1);
    expect(JSON.parse(String(rows[0]?.payload))).toMatchObject({ kind: "action", id: "post-1", tool: "board_post", args: { note: "ship it" }, descriptor: { actionKind: "demo.post" } });
    expect(socket.frames.filter((f) => f.type === "action")).toEqual([{ type: "action", turn: expect.any(String), id: "post-1", tool: "board_post", status: "done" }]);
  });

  it("a step that fails before the barrier drops its queued action, and the performer never runs", async () => {
    const { fake, log, chat } = setup([
      { toolCall: { id: "c1", name: "tool_search", arguments: { load: ["board"] } } },
      { checkpoint: "posting", step: { toolCall: { id: "post-2", name: "board_post", arguments: { note: "leak" } } } },
    ]);
    const sending = chat.instance.send({ person: ada.email, text: "post it" });
    await fake.reached("posting");
    // A self-host chat route is unhedged (Workers AI), so the drop is the step's one attempt.
    fake.drop("posting");
    expect(await sending).toMatchObject({ status: "failed" });
    expect(log).toEqual([]);
    expect(chat.rows("SELECT COUNT(*) AS n FROM outbox")).toEqual([{ n: 0 }]);
  });

  it("tool_search refuses an unknown namespace with TOOL_NAMESPACE_UNKNOWN and loads nothing", async () => {
    const { fake, chat } = setup([{ toolCall: { id: "c1", name: "tool_search", arguments: { load: ["vault", "demo"] } } }, { text: "no." }]);
    await chat.instance.send({ person: ada.email, text: "load" });
    expect(toolText(fake, 1)[0]).toContain("TOOL_NAMESPACE_UNKNOWN: no namespace named vault");
    expect(toolNames(fake, 1)).not.toContain("demo_ping");
    expect(chat.rows(`SELECT value FROM chat_meta WHERE key = '${LOADED_NAMESPACES_KEY}'`)).toEqual([]);
  });

  it("the registry refuses duplicate or malformed tool names at construction", () => {
    const [demo] = fixtures([]);
    expect(() => new ToolRegistry([demo!, { ...demo!, name: "other" }])).toThrow("TOOL_NAME_DUPLICATE: demo_ping");
    expect(() => new ToolRegistry([{ ...demo!, tools: [{ ...demo!.tools[0]!, name: "not valid!" }] }])).toThrow("TOOL_NAME_INVALID");
  });
});
