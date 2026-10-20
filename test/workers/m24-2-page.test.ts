// M24.2, the page's side of chat steering: the shipped page script against the production engine. A send
// while a turn runs is queued and drawn as sent, and the reply that takes it up is drawn below it; Stop sits
// on the status row only while a turn is shown working, ends the turn at its next step boundary, and the
// stopped entry is drawn live and again after a reload; the chat's More menu's compaction (the agent sheet's until M27.3) runs through the
// route the app serves, where the Chat decides. Bo's socket on Ada's chat gets nothing, his stop is refused,
// and his compaction writes no record. The test owns the clock: the held step moves only when it releases it.
import { describe, expect, it } from "vitest";
import { ChatEngine, type EngineCtx } from "../../packages/agent/src/chat/engine.ts";
import { connectFrame, ownerOnly } from "../../packages/agent/src/chat/protocol.ts";
import { answerFrame } from "../../packages/agent/src/chat/socket.ts";
import { STOP_TEXT, WORKING_TEXT } from "../../packages/agent/src/http/app/chat.ts";
import { type AuthorityDirectory, authorityRoutes } from "../../packages/agent/src/http/authority-routes.ts";
import { Ledger } from "../../packages/agent/src/objects/ledger.ts";
import { FakeModel, type FakeStep } from "../support/fake-model.ts";
import { harnessNamespace, ObjectHarness } from "../support/object-harness.ts";
import { ada } from "./support/authority-world.ts";
import { page, type ScriptedSocket } from "./support/page-harness.ts";

const T0 = Date.UTC(2026, 9, 16, 9, 30);
const CHAT_ID = "6f1c2a4e-1b2c-4d3e-8f90-0a1b2c3d4e5f";
type Frame = Record<string, unknown>;

const settle = async () => {
  for (let i = 0; i < 60; i++) await new Promise((r) => setImmediate(r));
};

/** Ada's chat over the production engine and Ledger; frames go to the owner's connections only. */
function world(script: FakeStep[]) {
  const fake = new FakeModel(script);
  const ledgers = harnessNamespace((name) => new ObjectHarness(name, (ctx, env) => new Ledger(ctx as DurableObjectState, env as Env), {}, (l) => {
    l.now = () => T0;
  }));
  const env = { TENANT_ID: ada.company, QYVR_ENV: "staging", AI: fake.binding, LEDGER: ledgers.binding };
  const conns: Array<{ state: { person: string }; frames: Frame[]; send(d: string): void }> = [];
  const chat: ObjectHarness<ChatEngine> = new ObjectHarness(CHAT_ID, (ctx, e) => new ChatEngine(ctx as EngineCtx, e as Env, { sockets: () => ownerOnly(conns, chat.instance.owner()) }), env, (c) => {
    c.now = () => T0;
    c.wait = async () => {};
  });
  chat.instance.claim(ada.email);
  const socketOf = (person: string, onFrame: (data: string) => void = () => {}) => {
    const c = { state: { person }, frames: [] as Frame[], send: (d: string) => { c.frames.push(JSON.parse(d)); onFrame(d); } };
    conns.push(c);
    return c;
  };
  const resync = (person: string) => connectFrame(person, chat.instance.owner(), () => chat.instance.history());
  // The app's route for the sheet's control, with the directory as `index.ts` wires it: straight to the Chat, which decides.
  const dir = { compact: (_chatId: string, person: string) => chat.instance.compactNow(person) } as unknown as AuthorityDirectory;
  const compactRoute = (person: string, path = `/chats/${CHAT_ID}/compact`) => {
    const url = new URL(`https://solo-sam.example${path}`);
    return authorityRoutes(new Request(url, { method: "POST", body: "{}" }), url, person, dir);
  };
  return { fake, chat, socketOf, resync, compactRoute };
}

type World = ReturnType<typeof world>;

/** Ada's page on her chat: its frames go through the socket's production answer; the chat's frames reach it. */
async function adaPage(w: World) {
  const box: { p?: Awaited<ReturnType<typeof page>> } = {};
  const p = await page(
    {
      onSend(data: string, s: ScriptedSocket) {
        void answerFrame(ada.email, data, w.chat.instance).then((reply) => reply && box.p?.deliver(s, reply));
      },
    },
    { search: `?chat=${CHAT_ID}` },
  );
  box.p = p;
  const s0 = p.sockets[0] as ScriptedSocket;
  p.open(s0);
  w.socketOf(ada.email, (d) => p.deliver(s0, d));
  p.deliver(s0, (w.resync(ada.email) as { frame: unknown }).frame);
  return { p, s0 };
}

const toolStep = (name: string, text: string): FakeStep => ({ checkpoint: name, step: { toolCall: { name: "send_to_user", arguments: { text } } } });

describe("[M24.2] the page steers a running turn: queued sends and Stop", () => {
  it("a send while a tool turn runs is drawn as sent, never refused, and the reply that takes it up is drawn; the next request carries it fenced; Bo gets nothing", async () => {
    const w = world([toolStep("tool", "Looking now."), { text: "About ZEBRA-7: yes, I have it noted." }]);
    const { p } = await adaPage(w);
    await p.type("check my notes");
    await w.fake.reached("tool");
    expect(p.busy()).toBe(true);
    await p.type("also remember ZEBRA-7");
    await settle();
    // Taken, not refused: drawn as sent while the first turn still runs, with no "Not sent" note.
    expect(p.bubbles()).toEqual([["m you", "check my notes"], ["m you", "also remember ZEBRA-7"]]);
    w.fake.release("tool");
    await settle();
    expect(p.busy()).toBe(false);
    expect(p.bubbles().filter(([c]) => c?.includes("note"))).toEqual([]);
    expect(p.bubbles()).toContainEqual(["m agent", "About ZEBRA-7: yes, I have it noted."]);
    // One turn, two model calls: the second request holds the queued message, as data, after the first step's work.
    expect(w.fake.requests).toHaveLength(2);
    expect(JSON.stringify(w.fake.requests[1]?.inputs.messages)).toContain("also remember ZEBRA-7");
    expect(JSON.stringify(w.fake.requests[0]?.inputs.messages)).not.toContain("ZEBRA-7");
    // A reload draws both of the person's messages and both replies.
    const again = await adaPage(w);
    const drawn = again.p.bubbles();
    for (const b of [["m you", "check my notes"], ["m you", "also remember ZEBRA-7"], ["m agent", "Looking now."], ["m agent", "About ZEBRA-7: yes, I have it noted."]]) expect(drawn).toContainEqual(b);
  });

  it("Stop shows only while a turn is shown working; a click says it is stopping, and the turn ends at its next step boundary with no further model call", async () => {
    // Step one's message is committed and sent; step two is in flight when Stop is clicked, so what it proposes is never sent.
    const w = world([{ toolCall: { name: "send_to_user", arguments: { text: "Step one is done." } } }, toolStep("hold", "Step two, never sent.")]);
    const { p } = await adaPage(w);
    expect(p.byId("stop").hidden).toBe(true);
    await p.type("do the long thing");
    await w.fake.reached("hold");
    expect([p.busy(), p.byId("stop").hidden, p.byId("stop").disabled, p.byId("busy").text()]).toEqual([true, false, false, WORKING_TEXT.background]);
    await p.byId("stop").onclick?.();
    await settle();
    // Asked, not yet stopped: the step in flight finishes first.
    expect([p.busy(), p.byId("stop").disabled, p.byId("busy").text()]).toEqual([true, true, STOP_TEXT.stopping]);
    w.fake.release("hold");
    await settle();
    expect([p.busy(), p.byId("stop").hidden]).toEqual([false, true]);
    expect(w.fake.requests).toHaveLength(2);
    expect(w.fake.remaining).toBe(0);
    const last = p.log.children.at(-1);
    expect(last?.className).toBe("m note stopped");
    // What the stopped turn already did is listed under it: the message it sent before the stop.
    expect(last?.children.filter((c) => c.className === "effect").map((c) => c.text())).toEqual(['sent you: "Step one is done."']);
    expect(p.bubbles()).toContainEqual(["m agent", "Step one is done."]);
    expect(JSON.stringify(p.bubbles())).not.toContain("Step two, never sent.");
  });

  it("the stopped entry is drawn again after a reload, with the message queued during the turn still drawn as the person's", async () => {
    const w = world([toolStep("hold", "Step one is done.")]);
    const { p } = await adaPage(w);
    await p.type("do the long thing");
    await w.fake.reached("hold");
    await p.type("and then this, please");
    await settle();
    await p.byId("stop").onclick?.();
    w.fake.release("hold");
    await settle();
    const live = p.log.children.find((c) => c.className === "m note stopped");
    expect(live).toBeDefined();
    const again = await adaPage(w);
    const reloaded = again.p.log.children.find((c) => c.className === "m note stopped");
    expect(reloaded?.text()).toBe(live?.text());
    expect(again.p.bubbles()).toContainEqual(["m you", "and then this, please"]);
    expect(again.p.busy()).toBe(false);
    // The queued message was never taken up: no model request ever held it.
    expect(JSON.stringify(w.fake.requests.map((r) => r.inputs.messages))).not.toContain("and then this, please");
  });
});

// M29.1 took Compact out of the person's app: the route stays for operators, and the Chat still decides there.
describe("[M24.2] compaction is asked for through the route, where the Chat decides", () => {
  it("Ada's manual compaction runs and is recorded; Bo's is refused 403 CHAT_NOT_OWNER with no model call and no record", async () => {
    const w = world([{ text: "one" }, { text: "two" }, { text: "Ada asked two things; both answered." }]);
    await w.chat.instance.send({ person: ada.email, text: "first question" });
    await w.chat.instance.send({ person: ada.email, text: "second question" });
    const refused = (await w.compactRoute(other.email)) as Response;
    expect([refused.status, ((await refused.json()) as { code: string }).code]).toEqual([403, "CHAT_NOT_OWNER"]);
    expect(w.chat.instance.compactionsFor(ada.email)).toEqual([]);
    expect(w.fake.requests).toHaveLength(2);
    const done = (await w.compactRoute(ada.email)) as Response;
    expect([done.status, ((await done.json()) as { ok: boolean }).ok]).toEqual([200, true]);
    const records = w.chat.instance.compactionsFor(ada.email) ?? [];
    expect(records.map((r) => r.trigger)).toEqual(["manual"]);
    expect(w.fake.requests).toHaveLength(3);
  });

  it("a compaction the Chat cannot run is refused with its code, never as done", async () => {
    const w = world([{ text: "only one" }]);
    await w.chat.instance.send({ person: ada.email, text: "just one question" });
    const out = (await w.compactRoute(ada.email)) as Response;
    const body = (await out.json()) as { ok?: boolean; code?: string };
    expect([body.ok, body.code]).toEqual([false, "NOTHING_TO_COMPACT"]);
    expect(w.chat.instance.compactionsFor(ada.email)?.filter((r) => r.trigger === "manual" && (r as { status?: string }).status !== "failed")).toEqual([]);
  });
});

/** A former member's label: rows and files keyed by a person who is not on the roster (fletch's fixtures hold one person). */
const other = { ...ada, id: "former-member", email: "former-member", name: "Pat" };
