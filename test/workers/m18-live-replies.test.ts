// M18.1: every reply reaches the page live, and a reload restores every turn (QYVR-164, QYVR-151
// reopened). The causes the staging spike found (DECISIONS-LOG M18.1), rewritten with the fictional
// set: the chat said nothing while a minutes-long model call ran, the page drew a message as sent
// before the chat took it (a refused send looked sent and vanished on reload), a turn that ended on a
// card came back without it, and the page's socket had no bound on a connect and no proof it answered.
// Two members wherever frames or history are read: Bo's socket on Ada's chat gets none of it.
import { describe, expect, it, vi } from "vitest";
import { ChatEngine, type EngineCtx } from "../../packages/agent/src/chat/engine.ts";
import { connectFrame, ownerOnly } from "../../packages/agent/src/chat/protocol.ts";
import { answerFrame } from "../../packages/agent/src/chat/socket.ts";
import { APP_PAGE, NOT_SENT_TEXT } from "../../packages/agent/src/http/page.ts";
import { page, type ScriptedSocket, timers } from "./support/page-harness.ts";
import { ANSWER_TIMEOUT_MS, OPEN_TIMEOUT_MS, RECONNECT_DELAYS_MS, RECONNECT_SCRIPT } from "../../packages/agent/src/http/reconnect.ts";
import { Ledger } from "../../packages/agent/src/objects/ledger.ts";
import { FakeModel, type FakeStep } from "../support/fake-model.ts";
import { harnessNamespace, ObjectHarness } from "../support/object-harness.ts";
import { ada, authorityWorld } from "./support/authority-world.ts";

const T0 = Date.UTC(2026, 9, 15, 4, 34, 0);
type Frame = Record<string, unknown>;

/** A connection as the SDK keeps it: the person from the session, and what it was sent. */
interface Conn {
  state: { person: string };
  frames: Frame[];
  send(data: string): void;
}

/** Ada's chat over the production engine; frames go to the owner's connections only, as `objects/chat.ts` sends them. */
function world(script: FakeStep[]) {
  const fake = new FakeModel(script);
  const clock = { now: T0 };
  const ledgers = harnessNamespace((name) =>
    new ObjectHarness(name, (ctx, env) => new Ledger(ctx as DurableObjectState, env as Env), {}, (l) => {
      l.now = () => clock.now;
    }),
  );
  const env = { TENANT_ID: ada.company, QYVR_ENV: "staging", AI: fake.binding, LEDGER: ledgers.binding };
  const conns: Conn[] = [];
  const chat: ObjectHarness<ChatEngine> = new ObjectHarness(
    "chat-ada",
    (ctx, e) => new ChatEngine(ctx as EngineCtx, e as Env, { sockets: () => ownerOnly(conns, chat.instance.owner()) }),
    env,
    (c) => {
      c.now = () => clock.now;
      c.wait = async () => {};
    },
  );
  const socketOf = (person: string, onFrame?: (data: string) => void): Conn => {
    const c: Conn = { state: { person }, frames: [], send: (d) => { c.frames.push(JSON.parse(d)); onFrame?.(d); } };
    conns.push(c);
    return c;
  };
  // Ada's Person claimed the chat when it opened it, as `/chats` does before the page connects.
  chat.instance.claim(ada.email);
  const ledger = () => ledgers.harness(ada.company).instance;
  const spend = (person: string, tokens: number) =>
    ledger().record({ tenant: ada.company, person, runId: "earlier", route: "chat", model: "@cf/zai-org/glm-5.3-flash", attempt: 1, status: "ok", code: null, httpStatus: 200, inputTokens: tokens, outputTokens: 0, reasoningTokens: 0, cachedTokens: 0, at: clock.now, startedAt: null, firstTokenAt: null, finishedAt: null });
  /** What `onConnect` sends, and a `sync` is answered with: the production `connectFrame` over the engine's history. */
  const resync = (person: string) => connectFrame(person, chat.instance.owner(), () => chat.instance.history());
  return { fake, clock, chat, socketOf, ledger, spend, resync };
}

const snapshot = (r: ReturnType<typeof connectFrame>) => (r.ok && r.frame.type === "history" ? r.frame : null);
const send = (text: string, id?: string) => JSON.stringify({ type: "send", text, ...(id ? { id } : {}) });

describe("[M18.1] the chat says a turn started and is running, to its owner only (QYVR-164)", () => {
  it("Ada's turn is announced the moment her message is stored, and a reconnect mid-turn says it is running; Bo's socket gets none of it", async () => {
    const w = world([{ checkpoint: "slow-model", step: { text: "Your Tuesday is free." } }]);
    const adaSocket = w.socketOf(ada.email);
    // The send goes through the socket's production answer, as `onMessage` hands it over.
    const answered = answerFrame(ada.email, send("Is my Tuesday free?", "send-1"), w.chat.instance);
    await w.fake.reached("slow-model");

    // The model call is still running (minutes, on staging): the page already knows the message is in.
    const started = adaSocket.frames.find((f) => f.type === "turn_started");
    expect(started).toMatchObject({ type: "turn_started", id: "send-1", text: "Is my Tuesday free?" });
    const during = snapshot(w.resync(ada.email));
    expect(during?.running).toEqual({ turn: started?.turn, since: T0 });
    expect(during?.entries).toEqual([{ kind: "you", text: "Is my Tuesday free?", at: T0, id: "send-1", mid: "m1" }]);

    w.fake.release("slow-model");
    expect(await answered).toBeNull();
    const kinds = adaSocket.frames.map((f) => f.type);
    expect(kinds.indexOf("turn_started")).toBeLessThan(kinds.indexOf("delta"));
    expect(adaSocket.frames.at(-1)).toEqual({ type: "turn_done", turn: started?.turn, chars: "Your Tuesday is free.".length });
    // A finished turn is never running: the next re-sync says so.
    const after = snapshot(w.resync(ada.email));
    expect(after?.running).toBeNull();
    expect(after?.entries.map((e) => e.kind)).toEqual(["you", "agent"]);
    const read = vi.fn(() => w.chat.instance.history());
    expect(read).not.toHaveBeenCalled();
  });

  it("every person-turn path keeps the marker history draws the person's words by, the refused-at-admission turn included", async () => {
    const w = world([{ text: "Hello Ada." }]);
    const socket = w.socketOf(ada.email);
    await answerFrame(ada.email, send("Hello.", "send-1"), w.chat.instance);
    await w.ledger().setBudgets({ personDailyMicros: 150 });
    await w.spend(ada.email, 1_000);
    w.clock.now += 1_000;
    await answerFrame(ada.email, send("And now?", "send-2"), w.chat.instance);
    expect(socket.frames.filter((f) => f.type === "turn_started").map((f) => f.id)).toEqual(["send-1", "send-2"]);
    expect(snapshot(w.resync(ada.email))?.entries.map((e) => [e.kind, "id" in e ? e.id : undefined])).toEqual([
      ["you", "send-1"],
      ["agent", undefined],
      ["you", "send-2"],
      ["failed", undefined],
    ]);
    // Planted: a turn without the marker (an older Main, written before M15.5) is not drawn as the person's.
    w.chat.db.prepare("DELETE FROM chat_meta WHERE key LIKE 'typed:%'").run();
    expect(snapshot(w.resync(ada.email))?.entries.map((e) => e.kind)).toEqual(["agent", "failed"]);
  });

  it("a send from a page with no id is still drawn as the person's, with no id", async () => {
    const w = world([{ text: "Hi." }]);
    await w.chat.instance.send({ person: ada.email, text: "Hello." });
    expect(snapshot(w.resync(ada.email))?.entries[0]).toEqual({ kind: "you", text: "Hello.", at: T0, mid: "m1" });
  });

  it("a sync is answered with the history, and a frame the chat cannot read with its reason", async () => {
    const w = world([{ text: "Hi." }]);
    await answerFrame(ada.email, send("Hello.", "send-1"), w.chat.instance);
    expect(await answerFrame(ada.email, JSON.stringify({ type: "sync" }), w.chat.instance)).toEqual({ type: "history", ...w.chat.instance.history() });
    expect(await answerFrame(ada.email, send("Hello.", "not an id!"), w.chat.instance)).toMatchObject({ type: "error", code: "FRAME_UNPARSEABLE", reason: expect.stringContaining("id") });
  });
});

describe("[M18.1] a reload draws every persisted turn, the latest one and its card included (QYVR-151)", () => {
  it("Ada's three turns, the last ending on an approval card, are drawn alike by a reload and after the object restarts; Bo reads none", async () => {
    const w = authorityWorld({ script: [{ text: "Your Tuesday is free." }, { text: "Wednesday too." }, { toolCall: { id: "m1", name: "mail_send", arguments: {  } } }] });
    const { chatId } = await w.say(ada.email, "Is my Tuesday free?");
    await w.say(ada.email, "And Wednesday?", chatId);
    const last = await w.say(ada.email, "Mail Cal the report.", chatId);
    expect(last.result).toMatchObject({ status: "done", awaiting: true });
    const chat = w.chats.harness(chatId);
    const draw = () => {
      const r = connectFrame(ada.email, chat.instance.owner(), () => chat.instance.history());
      return r.ok && r.frame.type === "history" ? r.frame.entries.map((e) => (e.kind === "card" ? ["card", e.card.state, e.card.title] : [e.kind, "text" in e ? e.text : ""])) : null;
    };
    const drawn = draw();
    expect(drawn?.filter((e) => e[0] === "you").map((e) => e[1])).toEqual(["Is my Tuesday free?", "And Wednesday?", "Mail Cal the report."]);
    expect(drawn?.at(-1)).toEqual(["card", "pending", expect.any(String)]);
    chat.evict();
    expect(draw()).toEqual(drawn);
    const read = vi.fn(() => chat.instance.history());
    expect(read).not.toHaveBeenCalled();
  });
});

function keeper() {
  const t = timers();
  const states: string[] = [];
  const made: ScriptedSocket[] = [];
  const keep = new Function(`${RECONNECT_SCRIPT}; return keepConnected;`)() as (
    open: () => unknown,
    onState: (s: string, i: Record<string, unknown>) => void,
    o: unknown,
  ) => { send(d: string): boolean; nudge(check: boolean): void; stop(): void; connected(): boolean };
  const conn = keep(
    () => {
      const s: ScriptedSocket = {
        readyState: 0,
        sent: [],
        send(d) {
          this.sent.push(d);
        },
        close(code, reason) {
          this.readyState = 3;
          this.closed = { code, reason };
        },
      };
      made.push(s);
      return s;
    },
    (s, i) => states.push(i.code !== undefined ? `${s}:${i.code}:${i.inMs}` : s),
    { delays: RECONNECT_DELAYS_MS, openTimeoutMs: OPEN_TIMEOUT_MS, answerTimeoutMs: ANSWER_TIMEOUT_MS, probe: "SYNC", onmessage: () => {}, schedule: t.schedule, cancel: t.cancel },
  );
  const open = (n: number) => {
    const s = made[n] as ScriptedSocket;
    s.readyState = 1;
    s.onopen?.();
  };
  const answer = (n: number) => made[n]?.onmessage?.({ data: "{}" });
  return { t, states, made, conn, open, answer };
}

describe("[M18.1] the page's socket proves it answers, on the person's action and never on a timer (QYVR-164, Q33)", () => {
  it("a connect that hangs is given up after its bound and another opens; the page said it was not connected", () => {
    const k = keeper();
    expect(k.states).toEqual(["connecting"]);
    k.t.fire(OPEN_TIMEOUT_MS);
    expect(k.made[0]?.closed).toMatchObject({ code: 4001 });
    expect(k.states).toEqual(["connecting", "reconnecting:4001:0", "connecting"]);
    k.open(1);
    expect(k.conn.connected()).toBe(true);
    // Planted: the hung socket opening late changes nothing; only the live one counts.
    k.made[0]?.onopen?.();
    expect(k.states.at(-1)).toBe("connected");
  });

  it("an open socket asked once on the person's action is dropped when it does not answer, and a new one opens at once", () => {
    const k = keeper();
    k.open(0);
    expect(k.t.live()).toEqual([]);
    k.conn.nudge(true);
    expect(k.made[0]?.sent).toEqual(["SYNC"]);
    // A second action while the check waits sends nothing more.
    k.conn.nudge(true);
    expect(k.made[0]?.sent).toEqual(["SYNC"]);
    k.t.fire(ANSWER_TIMEOUT_MS);
    expect(k.made[0]?.closed).toMatchObject({ code: 4002 });
    expect(k.made).toHaveLength(2);
    k.open(1);
    // A socket that answers its check is kept, and nothing is left scheduled.
    k.conn.nudge(true);
    k.answer(1);
    expect(k.t.live()).toEqual([]);
    expect(k.made).toHaveLength(2);
    expect(k.states).toEqual(["connecting", "connected", "reconnecting:4002:0", "connecting", "connected"]);
  });

  it("a send whose socket never answers drops it; a send that is answered keeps it", () => {
    const k = keeper();
    k.open(0);
    expect(k.conn.send("hello")).toBe(true);
    k.answer(0);
    expect(k.t.live()).toEqual([]);
    expect(k.conn.send("again")).toBe(true);
    k.t.fire(ANSWER_TIMEOUT_MS);
    expect(k.made[0]?.closed).toMatchObject({ code: 4003 });
    expect(k.made).toHaveLength(2);
  });

  it("a socket that is down reconnects on the person's next action instead of waiting out a 30 s backoff", () => {
    const k = keeper();
    k.open(0);
    // Six closes in a row walk the backoff to its 30 s step.
    for (let i = 0; i < 6; i++) {
      k.made.at(-1)?.onclose?.({ code: 1006 });
      if (i < 5) k.t.fire(RECONNECT_DELAYS_MS[i] as number);
    }
    expect(k.states.at(-1)).toBe(`reconnecting:1006:${RECONNECT_DELAYS_MS[5]}`);
    const before = k.made.length;
    k.conn.nudge(false);
    expect(k.made).toHaveLength(before + 1);
    expect(k.states.at(-1)).toBe("connecting");
    // The overtaken backoff never fires a second socket.
    expect(k.t.live().map((x) => x.ms)).toEqual([OPEN_TIMEOUT_MS]);
  });

  it("an idle open socket has nothing scheduled: no keepalive, no timed check", () => {
    const k = keeper();
    k.open(0);
    k.answer(0);
    expect(k.t.live()).toEqual([]);
    expect(k.made[0]?.sent).toEqual([]);
  });
});

describe("[M18.1] the page draws what the chat answered, never more (QYVR-164, QYVR-151)", () => {
  it("Ada's message is faint until the chat takes it, the page says the agent is working until the turn ends, and a reload mid-turn says so too", async () => {
    const w = world([{ checkpoint: "slow-model", step: { text: "Your Tuesday is free." } }]);
    let turn: Promise<unknown> = Promise.resolve();
    // Each page socket is the owner's connection; what it sends goes through the production answer.
    const bridge = (p: Awaited<ReturnType<typeof page>>, s: ScriptedSocket) => w.socketOf(ada.email, (d) => p.deliver(s, d));
    const chat = {
      p: undefined as Awaited<ReturnType<typeof page>> | undefined,
      onSend(data: string, s: ScriptedSocket) {
        turn = answerFrame(ada.email, data, w.chat.instance).then((reply) => reply && chat.p?.deliver(s, reply));
      },
    };
    const p = await page(chat);
    chat.p = p;
    const s0 = p.sockets[0] as ScriptedSocket;
    p.open(s0);
    bridge(p, s0);
    p.deliver(s0, (w.resync(ada.email) as { frame: unknown }).frame);
    expect(p.busy()).toBe(false);

    await p.type("Is my Tuesday free?");
    await w.fake.reached("slow-model");
    // The chat stored it and the turn runs: drawn as sent, and the page says the agent is working.
    expect(p.bubbles()).toEqual([["m you", "Is my Tuesday free?"]]);
    expect(p.busy()).toBe(true);

    // A reload while the model call runs: a new page draws the message and says the turn is running.
    // It joined after the reply began streaming, so when the turn ends it asks once for the whole of it.
    const rchat = {
      p: undefined as Awaited<ReturnType<typeof page>> | undefined,
      onSend(data: string, s: ScriptedSocket) {
        void answerFrame(ada.email, data, w.chat.instance).then((reply) => reply && rchat.p?.deliver(s, reply));
      },
    };
    const reload = await page(rchat);
    rchat.p = reload;
    const r0 = reload.sockets[0] as ScriptedSocket;
    reload.open(r0);
    w.socketOf(ada.email, (d) => reload.deliver(r0, d));
    reload.deliver(r0, (w.resync(ada.email) as { frame: unknown }).frame);
    expect(reload.bubbles()).toEqual([["m you", "Is my Tuesday free?"]]);
    expect(reload.busy()).toBe(true);

    w.fake.release("slow-model");
    await turn;
    for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
    expect(r0.sent.map((d) => JSON.parse(d).type)).toEqual(["sync"]);
    for (const x of [p, reload]) {
      expect(x.busy()).toBe(false);
      expect(x.bubbles().at(-1)).toEqual(["m agent", "Your Tuesday is free."]);
    }
    // A page opened after the turn ended never shows it as working.
    const later = await page({ onSend() {} });
    const l0 = later.sockets[0] as ScriptedSocket;
    later.open(l0);
    later.deliver(l0, (w.resync(ada.email) as { frame: unknown }).frame);
    expect(later.busy()).toBe(false);
    expect(later.bubbles()).toEqual([["m you", "Is my Tuesday free?"], ["m agent", "Your Tuesday is free."]]);
  });

  it("a send lost with a dead socket is said not sent after the new socket's history, and a stored one is drawn once, as sent", async () => {
    const w = world([{ text: "Noted." }]);
    // The first socket swallows what it is sent, as a socket that died silently does.
    const p = await page({ onSend() {} });
    const s0 = p.sockets[0] as ScriptedSocket;
    p.open(s0);
    p.deliver(s0, (w.resync(ada.email) as { frame: unknown }).frame);
    await p.type("Remember the dentist.");
    expect(p.bubbles()).toEqual([["m you pending", "Remember the dentist."]]);
    // No answer: the page drops the socket and opens another, whose history does not hold the send.
    p.t.fire(ANSWER_TIMEOUT_MS);
    const s1 = p.sockets[1] as ScriptedSocket;
    p.open(s1);
    p.deliver(s1, (w.resync(ada.email) as { frame: unknown }).frame);
    expect(p.bubbles()).toEqual([["m you unsent", "Remember the dentist."], ["m note", NOT_SENT_TEXT.LOST]]);

    // The same, but the chat did store it before the socket died: the history draws it once, as sent.
    await w.chat.instance.send({ person: ada.email, text: "Remember the vet.", clientId: "send-2" });
    await p.type("Remember the vet.");
    p.t.fire(ANSWER_TIMEOUT_MS);
    const s2 = p.sockets[2] as ScriptedSocket;
    p.open(s2);
    p.deliver(s2, (w.resync(ada.email) as { frame: unknown }).frame);
    expect(p.bubbles().filter(([, text]) => text === "Remember the vet.")).toEqual([["m you", "Remember the vet."]]);
    // The lost one stays said, once.
    expect(p.bubbles().filter(([, text]) => text === "Remember the dentist." || text === NOT_SENT_TEXT.LOST)).toEqual([["m you unsent", "Remember the dentist."], ["m note", NOT_SENT_TEXT.LOST]]);
  });

  it("while the socket is down a send is said not sent, and the socket is already reconnecting rather than waiting out its backoff", async () => {
    const p = await page({ onSend() {} });
    const s0 = p.sockets[0] as ScriptedSocket;
    p.open(s0);
    s0.onclose?.({ code: 1006 });
    await p.type("Hello?");
    // Said not sent, and a new socket is already opening, not waiting for its backoff.
    expect(p.bubbles()).toEqual([["m note", NOT_SENT_TEXT.DOWN]]);
    expect(p.sockets).toHaveLength(2);
  });

  it("the shipped page checks its socket on the person's coming back, never on a timer", () => {
    expect(APP_PAGE).toContain('document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") act(true); })');
    expect(APP_PAGE).toContain('probe: JSON.stringify({ type: "sync" })');
    expect(APP_PAGE).not.toMatch(/setInterval/);
    expect(RECONNECT_SCRIPT).not.toMatch(/setInterval/);
  });
});
