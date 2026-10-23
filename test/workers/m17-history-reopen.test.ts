// M17.1, QYVR-151: Muse's repro, rewritten with the fictional set. Ada opens a new chat and has three
// turns there; a reload draws all three, but closing the tab and opening the app again drew a
// different set. The staging spike (DECISIONS-LOG M17.1) showed the chat's own store draws the same
// entries on a reconnect and after the object was evicted, so the difference was which chat a fresh
// open landed on: a reload keeps the open chat, a fresh open went to Main, and every side chat is
// titled "New chat". The fix is at the Person's chat store, which records the chat a page last
// connected to and hands it to a fresh open. Two members: Bo's sockets never move Ada's last chat.
import { describe, expect, it } from "vitest";
import { ChatEngine, type EngineCtx } from "../../packages/agent/src/chat/engine.ts";
import { connectFrame } from "../../packages/agent/src/chat/protocol.ts";
import { APP_PAGE } from "../../packages/agent/src/http/page.ts";
import { type Directory, route } from "../../packages/agent/src/http/routes.ts";
import { Ledger } from "../../packages/agent/src/objects/ledger.ts";
import { PersonChats, runChatsCall } from "../../packages/agent/src/person/chats.ts";
import { FakeModel } from "../support/fake-model.ts";
import { harnessNamespace, ObjectHarness } from "../support/object-harness.ts";
import people from "../fixtures/people.json" with { type: "json" };

const ada = people.people.find((p) => p.id === "sam-solo")!;
const TENANT = ada.company;
const T0 = Date.UTC(2026, 9, 13, 16, 0, 0);

function world() {
  const fake = new FakeModel([{ text: "One noted." }, { text: "Two noted." }, { text: "Three noted." }, { text: "Bo's answer." }]);
  const clock = { now: T0 };
  const ledgers = harnessNamespace((name) => new ObjectHarness(name, (ctx, e) => new Ledger(ctx as DurableObjectState, e as Env), {}));
  const base = { TENANT_ID: TENANT, QYVR_ENV: "staging", AI: fake.binding, LEDGER: ledgers.binding } as unknown as Env;
  const chats = harnessNamespace((name) =>
    new ObjectHarness<ChatEngine>(name, (ctx, e) => new ChatEngine(ctx as EngineCtx, e as Env), base as unknown as Record<string, unknown>, (c) => {
      c.now = () => clock.now;
    }),
  );
  const persons = harnessNamespace((name) => new ObjectHarness<PersonChats>(name, (ctx) => new PersonChats((ctx as DurableObjectState).storage, name, async (id, p) => chats.harness(id).instance.claim(p)), {}));
  const person = (p: string) => persons.harness(p).instance;
  const dir = {
    person: (p: string) => ({ openChat: () => person(p).open(clock.now), ownsChat: async (id: string) => person(p).owns(id), connectChat: async (id: string) => person(p).connected(id, clock.now) }),
    chat: () => ({ fetch: async () => new Response(null, { status: 204 }) }),
  } as unknown as Directory;
  /** The page's socket: the script's route, which decides ownership at the Person before the chat sees it. */
  const socket = (p: string, chatId: string) => route(new Request(`https://${TENANT}.qyvr-staging.dev/chats/${chatId}/ws`, { headers: { upgrade: "websocket" } }), base, { tenant: TENANT, person: p }, dir);
  /** The chat list a page loads first: `GET /app/chats`, served by the Person's `view`. */
  const view = async (p: string) => (await runChatsCall(person(p), p, p, { op: "view" }, clock.now)) as { ok: true; main: string; last: string };
  const drawn = (chatId: string, p: string) => {
    const r = connectFrame(p, chats.harness(chatId).instance.owner(), () => chats.harness(chatId).instance.history());
    return r.ok && r.frame.type === "history" ? r.frame.entries.map((e) => [e.kind, e.text]) : r;
  };
  /** The page's own choice on load, as `chats(select)` makes it: the address's chat, else the list's last, else main. */
  const pageOpens = (v: { main: string; last?: string }, select: string | null) => select || v.last || v.main;
  return { clock, chats, persons, socket, view, drawn, pageOpens, person };
}

describe("[M17.1] a fresh open restores what a reload restores (QYVR-151)", () => {
  it("Ada's three turns in a new chat are drawn alike by a reload and by a fresh open after every object restarted", async () => {
    const w = world();
    const first = await w.view(ada.email);
    expect(first.last).toBe(first.main);
    // A new chat, as the page's "+ New chat" makes it, and its socket.
    const opened = await w.person(ada.email).open(w.clock.now);
    if (!opened.ok) throw new Error(opened.code);
    const side = opened.chatId;
    w.clock.now += 1_000;
    expect((await w.socket(ada.email, side)).status).toBe(204);
    for (const n of ["one", "two", "three"]) {
      w.clock.now += 1_000;
      await w.chats.harness(side).instance.send({ person: ada.email, text: `UAT check ${n}` });
    }
    const expected = [
      ["you", "UAT check one"], ["agent", "One noted."],
      ["you", "UAT check two"], ["agent", "Two noted."],
      ["you", "UAT check three"], ["agent", "Three noted."],
    ];
    // Reload: the address names the open chat.
    const reload = w.pageOpens(await w.view(ada.email), side);
    expect(reload).toBe(side);
    expect(w.drawn(reload, ada.email)).toEqual(expected);
    // Close the tab: nothing is connected and every object restarts. Open the app again with no address.
    w.chats.harness(side).evict();
    w.persons.harness(ada.email).evict();
    const fresh = w.pageOpens(await w.view(ada.email), null);
    expect(fresh).toBe(reload);
    expect(w.drawn(fresh, ada.email)).toEqual(w.drawn(reload, ada.email));
  });

  it("an archived or deleted last chat is not reopened: a fresh open falls back to main", async () => {
    const w = world();
    const person = w.person(ada.email);
    const a = await person.open(w.clock.now);
    if (!a.ok) throw new Error(a.code);
    await w.socket(ada.email, a.chatId);
    expect(person.archive(a.chatId, w.clock.now)).toEqual({ ok: true });
    const v = await w.view(ada.email);
    expect(v.last).toBe(v.main);
  });

  it("the page opens the list's last chat when the address names none, and keeps the open chat in the address", () => {
    expect(APP_PAGE).toContain("open(select || chatId || v.last || mainId);");
    // F4: home becomes the opened chat's own address, by a replace; a chat's address is read at boot from its path.
    expect(APP_PAGE).toContain('if (location.pathname === "/" && !fileLink() && chatId) history.replaceState(null, "", chatPath(chatId));');
    expect(APP_PAGE).toContain('chats(booted && booted.row.name === "chat" ? booted.id : null)');
  });
});
