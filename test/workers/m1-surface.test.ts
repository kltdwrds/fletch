// M1.2: the chat surface through the agent script's routes, the `Person`'s chats and the `Chat`
// engine, each over the object harness, with the two solo-sam members Sam Solo and Pat. The
// Agents SDK hosts (`objects/chat.ts`, `objects/person.ts`) are thin over these and run live on
// staging (test/m1/chat.live.test.ts); the decisions they make are the ones tested here.
import { describe, expect, it } from "vitest";
import { ChatEngine, type EngineCtx } from "../../packages/agent/src/chat/engine.ts";
import { admit, ownerOnly, parseClientFrame } from "../../packages/agent/src/chat/protocol.ts";
import { propsOf } from "../../packages/agent/src/http/identity.ts";
import { type Directory, route } from "../../packages/agent/src/http/routes.ts";
import { Ledger } from "../../packages/agent/src/objects/ledger.ts";
import { PersonChats } from "../../packages/agent/src/person/chats.ts";
import { FakeModel } from "../support/fake-model.ts";
import { harnessNamespace, ObjectHarness } from "../support/object-harness.ts";
import people from "../fixtures/people.json" with { type: "json" };

const ada = people.people.find((p) => p.id === "sam-solo")!;
const TENANT = ada.company;

function world(env: Partial<Env> = {}) {
  const fake = new FakeModel([{ text: "Hello." }]);
  const ledgers = harnessNamespace((name) => new ObjectHarness(name, (ctx, e) => new Ledger(ctx as DurableObjectState, e as Env), {}));
  const base = { TENANT_ID: TENANT, QYVR_ENV: "staging", AI: fake.binding, LEDGER: ledgers.binding, ...env } as unknown as Env;
  const chats = harnessNamespace((name) => new ObjectHarness<ChatEngine>(name, (ctx, e) => new ChatEngine(ctx as EngineCtx, e as Env), base as unknown as Record<string, unknown>));
  const persons = harnessNamespace(
    (name) => new ObjectHarness<PersonChats>(name, (ctx) => new PersonChats((ctx as DurableObjectState).storage, name, async (id, p) => chats.harness(id).instance.claim(p)), {}),
  );
  const forwarded: Request[] = [];
  const dir: Directory = {
    person: (p) => ({ openChat: () => persons.harness(p).instance.open(Date.UTC(2026, 9, 12)), ownsChat: async (id) => persons.harness(p).instance.owns(id), connectChat: async (id) => persons.harness(p).instance.connected(id, Date.UTC(2026, 9, 12)) }),
    chat: () => ({
      fetch: async (request) => {
        forwarded.push(request);
        return new Response(null, { status: 204 });
      },
    }),
    ledger: () => ({ modelCalls: (filter) => ledgers.harness(TENANT).instance.modelCalls(filter) }),
    company: () => ({
      lookup: async () => null,
      list: async () => [],
      invite: async () => ({ ok: false, code: "NOT_AN_ADMIN" }),
      resyncAccess: async () => ({ ok: false, code: "NOT_AN_ADMIN" }),
    }),
    modelSample: async () => ({ ok: true, raw: "data: [DONE]\n\n" }),
  };
  const call = (path: string, person?: string, init: RequestInit = {}, tenant = TENANT) =>
    route(new Request(`https://${TENANT}.qyvr-staging.dev${path}`, init), base, { tenant, ...(person ? { person } : {}) }, dir);
  const upgrade = { headers: { upgrade: "websocket" } };
  return { call, upgrade, forwarded, chats, ledgers, fake, base, dir };
}

describe("[M1.2] chat surface", () => {

  it("frames go only to the owner's connections", () => {
    const conns = [{ state: { person: ada.email }, id: "a" }, { state: {  }, id: "b" }, { state: null, id: "c" }];
    expect(ownerOnly(conns, ada.email).map((c) => c.id)).toEqual(["a"]);
    expect(ownerOnly(conns, null)).toEqual([]);
  });

  it("a connection without a person or to an unclaimed chat is refused with its code", () => {
    expect(admit(null, ada.email)).toBe("NO_SESSION");
    expect(admit(ada.email, null)).toBe("CHAT_UNCLAIMED");
  });

  it("every route but /health needs the dispatcher's person, for this script's tenant", async () => {
    const w = world();
    expect((await w.call("/health")).status).toBe(200);
    for (const [path, init] of [["/", {}], ["/chats", { method: "POST" }], ["/ledger/calls", {}]] as const) {
      const res = await w.call(path, undefined, init);
      expect([path, res.status, await res.json()]).toEqual([path, 401, { code: "NO_SESSION" }]);
    }
    const other = await w.call("/chats", ada.email, { method: "POST" }, "other-tenant");
    expect([other.status, await other.json()]).toEqual([403, { code: "TENANT_MISMATCH" }]);
    const page = await w.call("/", ada.email);
    expect(page.headers.get("content-type")).toMatch(/^text\/html/);
    expect(await page.text()).toContain("/chats/");
  });

  it("a socket route needs a chat the person owns, then an upgrade", async () => {
    const w = world();
    const { chatId } = (await (await w.call("/chats", ada.email, { method: "POST" })).json()) as { chatId: string };
    expect(await (await w.call(`/chats/${chatId}/ws`, ada.email)).json()).toEqual({ code: "WEBSOCKET_REQUIRED" });
    expect(await (await w.call("/chats/not-an-id/ws", ada.email, w.upgrade)).json()).toEqual({ code: "CHAT_NOT_FOUND" });
    expect(w.forwarded).toHaveLength(0);
  });

  it("the stream sample route exists in staging only", async () => {
    const staging = world();
    expect((await staging.call("/dev/model-sample", ada.email, { method: "POST" })).status).toBe(200);
    const prod = world({ QYVR_ENV: "prod" } as Partial<Env>);
    expect((await prod.call("/dev/model-sample", ada.email, { method: "POST" })).status).toBe(404);
  });

  it("props carry only what the dispatcher wrote; a person in props is never read as the session", () => {
    expect(propsOf({ props: { tenant: TENANT, devPerson: ada.email } })).toEqual({ tenant: TENANT, devPerson: ada.email });
    expect(propsOf({ props: { tenant: TENANT, person: ada.email, platform: "yes" } })).toEqual({ tenant: TENANT });
    expect(propsOf({ props: { tenant: TENANT } })).toEqual({ tenant: TENANT });
    expect(propsOf({ props: {} })).toBeNull();
    expect(propsOf(undefined)).toBeNull();
  });
});

describe("[M1.2] chat socket frames", () => {
  it("a frame that is not a send request is refused with FRAME_UNPARSEABLE and a reason", () => {
    expect(parseClientFrame('{"type":"send","text":"Hi","timeZone":"Europe/London"}')).toEqual({ ok: true, frame: { type: "send", text: "Hi", timeZone: "Europe/London" } });
    const bad = ["not json", "[]", '{"type":"grant","text":"x"}', '{"type":"send","text":3}', '{"type":"send","text":"x","timeZone":"Mars/Base"}'];
    for (const raw of bad) {
      const parsed = parseClientFrame(raw);
      expect(parsed.ok).toBe(false);
      if (!parsed.ok) expect([parsed.code, parsed.reason.length > 0]).toEqual(["FRAME_UNPARSEABLE", true]);
    }
    expect(parseClientFrame(new ArrayBuffer(4))).toMatchObject({ ok: false, reason: "binary frames are not accepted" });
  });

  it("a frame cannot name its sender: the person field is ignored", () => {
    expect(parseClientFrame(JSON.stringify({ type: "send", text: "Hi", person: ada.email }))).toEqual({ ok: true, frame: { type: "send", text: "Hi" } });
  });
});
