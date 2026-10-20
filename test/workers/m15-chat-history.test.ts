// M15.5: the chat page draws a chat's earlier turns when it opens or reconnects (2026-10-13:
// switching to Main blanked the screen, since `onConnect` sent no transcript). The connect step sends
// the chat's own history to its owner only, read from the chat's transcript after admission. Two
// members: Ada's chats show Ada's turns after a switch away and back and after an eviction, and Bo's
// socket on Ada's chat is refused with a code and is sent none of it. Fixture people are Ada and Bo.
import { describe, expect, it, vi } from "vitest";
import { ChatEngine, type EngineCtx } from "../../packages/agent/src/chat/engine.ts";
import { connectFrame } from "../../packages/agent/src/chat/protocol.ts";
import { Ledger } from "../../packages/agent/src/objects/ledger.ts";
import { APP_PAGE, PUSH_REFUSED_TEXT, SERVICE_WORKER } from "../../packages/agent/src/http/page.ts";
import { FakeModel, type FakeStep } from "../support/fake-model.ts";
import { harnessNamespace, ObjectHarness } from "../support/object-harness.ts";
import people from "../fixtures/people.json" with { type: "json" };
import vm from "node:vm";

const ada = people.people.find((p) => p.id === "sam-solo")!;
const T0 = Date.UTC(2026, 9, 13, 9, 0, 0);

function world(script: FakeStep[]) {
  const fake = new FakeModel(script);
  const ledgers = harnessNamespace((name) => new ObjectHarness(name, (ctx, env) => new Ledger(ctx as DurableObjectState, env as Env), {}));
  const env = { TENANT_ID: ada.company, QYVR_ENV: "staging", AI: fake.binding, LEDGER: ledgers.binding };
  const clock = { now: T0 };
  const chatFor = (name: string) => new ObjectHarness(name, (ctx, e) => new ChatEngine(ctx as EngineCtx, e as Env), env, (c) => {
    c.now = () => clock.now;
  });
  /** What the host's `onConnect` does, over the production `connectFrame` and the engine's own history. */
  const connect = (chat: ObjectHarness<ChatEngine>, person: string | null) => connectFrame(person, chat.instance.owner(), () => chat.instance.history());
  return { chatFor, connect, clock };
}

describe("[M15.5] a chat's earlier turns are drawn on open and reconnect, to its owner only", () => {
  it("Ada's main chat shows its turns after a switch to a side chat and back, and after an eviction; her side chat shows its own", async () => {
    const w = world([
      { text: "Your Tuesday is free." },
      { toolCall: { id: "call_ping", name: "send_to_user", arguments: { text: "Checking the board now." } } },
      { text: "Nothing on the board." },
      { text: "Side chat answer." },
    ]);
    const main = w.chatFor("chat-ada-main");
    const side = w.chatFor("chat-ada-side");
    expect(w.connect(main, ada.email)).toMatchObject({ ok: false, code: "CHAT_UNCLAIMED" });
    await main.instance.send({ person: ada.email, text: "Is my Tuesday free?" });
    w.clock.now += 1_000;
    await main.instance.send({ person: ada.email, text: "And the board?" });
    await side.instance.send({ person: ada.email, text: "A different matter." });

    const drawn = (r: ReturnType<typeof w.connect>) => (r.ok && r.frame.type === "history" ? r.frame.entries.map((e) => [e.kind, e.text]) : null);
    const expected = [
      ["you", "Is my Tuesday free?"],
      ["agent", "Your Tuesday is free."],
      ["you", "And the board?"],
      ["agent", "Checking the board now."],
      ["agent", "Nothing on the board."],
    ];
    expect(drawn(w.connect(main, ada.email))).toEqual(expected);
    // Switched to the side chat and back: the same chat draws the same turns again, none of the side chat's.
    expect(drawn(w.connect(side, ada.email))).toEqual([["you", "A different matter."], ["agent", "Side chat answer."]]);
    expect(drawn(w.connect(main, ada.email))).toEqual(expected);
    // Reconnect after the object restarted: the transcript is the record, not the instance.
    main.evict();
    expect(drawn(w.connect(main, ada.email))).toEqual(expected);
  });

  it("only the person's words and the agent's are drawn: injected inputs, tool results and undelivered sends are not", async () => {
    const w = world([{ text: "Done." }]);
    const main = w.chatFor("chat-ada-main");
    await main.instance.send({ person: ada.email, text: "Please check." });
    // A hand-off from sub-agents enters as the harness's input in its own turn, not as the person's.
    await main.instance.handoff({ grp: "g1", person: ada.email, text: "HANDOFF: the worker returned a long report." });
    // Planted: a send_to_user the barrier never committed (no outbox row) must not be shown as sent.
    main.db
      .prepare("INSERT INTO messages (turn_id, role, body) VALUES (?, 'assistant', ?)")
      .run("ghost", JSON.stringify({ role: "assistant", content: [{ type: "toolCall", id: "ghost-call", name: "send_to_user", arguments: { text: "NEVER SENT" } }], timestamp: T0 }));
    const r = w.connect(main, ada.email);
    const text = JSON.stringify(r);
    expect(text).toContain("Please check.");
    expect(text).toContain("Done.");
    expect(text).not.toContain("HANDOFF");
    expect(text).not.toContain("NEVER SENT");
  });

  it("a job's notice is drawn among the turns, and the page replaces what it drew with the frame", async () => {
    const w = world([{ text: "Hi." }]);
    const main = w.chatFor("chat-ada-main");
    await main.instance.send({ person: ada.email, text: "Hello" });
    await main.instance.notify({ id: "hn:1", source: "job:hn", text: "A new story is up.", person: ada.email });
    const r = w.connect(main, ada.email);
    expect(r.ok && r.frame.type === "history" ? r.frame.entries.map((e) => e.kind) : null).toEqual(["you", "agent", "note"]);
    // The page: a history frame empties the log before drawing, so a reconnect never doubles a turn.
    expect(APP_PAGE).toMatch(/f\.type === "history"[\s\S]{0,120}log\.replaceChildren\(\)/);
  });
});

describe("[M15.5] the service worker answers only this origin's requests", () => {
  function worker() {
    const listeners: Record<string, (e: unknown) => void> = {};
    const self = { location: { origin: "https://solo-sam.qyvr-staging.dev" }, addEventListener: (t: string, f: (e: unknown) => void) => {
        listeners[t] = f;
      }, skipWaiting() {}, clients: { claim() {} } };
    vm.runInNewContext(SERVICE_WORKER, { self, URL, fetch: () => "network" });
    return listeners;
  }
  const event = (url: string) => {
    const respondWith = vi.fn();
    return { request: { url }, respondWith };
  };

  it("same-origin requests are answered, a cross-origin one (the analytics beacon) is left to the network", () => {
    const l = worker();
    const own = event("https://solo-sam.qyvr-staging.dev/app/chats");
    l.fetch?.(own);
    expect(own.respondWith).toHaveBeenCalledOnce();
    const beacon = event("https://static.cloudflareinsights.com/beacon.min.js");
    l.fetch?.(beacon);
    expect(beacon.respondWith).not.toHaveBeenCalled();
    // A lookalike host that merely starts with this origin is not this origin.
    const lookalike = event("https://solo-sam.qyvr-staging.dev.evil.example/x");
    l.fetch?.(lookalike);
    expect(lookalike.respondWith).not.toHaveBeenCalled();
  });
});

describe("[M15.5] a refused push subscription is said in plain words", () => {
  it("names the push service, Brave's setting, other browsers' permission, and that mail still reaches them", () => {
    expect(PUSH_REFUSED_TEXT).toContain("push service is off or blocked");
    expect(PUSH_REFUSED_TEXT).toContain("Use Google services for push messaging");
    expect(PUSH_REFUSED_TEXT).toContain("reload");
    expect(PUSH_REFUSED_TEXT).toContain("allow notifications for this site");
    expect(PUSH_REFUSED_TEXT).toMatch(/mail/);
    // The page shows it when the browser's subscribe call throws, not a raw error name.
    expect(APP_PAGE).toContain("Use Google services for push messaging");
    // Since M27.6 the refusal carries its code and the Switch is redrawn from the store (m27-settings drives it).
    expect(APP_PAGE).toMatch(/catch \(e\) \{ coded\(\$\("push-result"\), PUSH_REFUSED, "PUSH_REFUSED"\); settingsDevices\(\); return; \}/);
  });
});
