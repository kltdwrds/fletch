// F10: reactions, full circuit, on the shipped page. The page under the page harness with frames delivered by hand:
// a bubble collects the agent's and the person's reaction in one pill, keyed by who put it there, and the person's
// bubble is named as soon as the chat says it stored it. No Chromium: the pill is DOM, and the M29.4 Chromium suite
// covers the picker's geometry. The engine's side of the naming runs on the production engine at the bottom.
import { describe, expect, it } from "vitest";
import { ChatEngine, type EngineCtx } from "../../packages/agent/src/chat/engine.ts";
import { ownerOnly } from "../../packages/agent/src/chat/protocol.ts";
import { HOLD_MS, MESSAGE_TEXT } from "../../packages/agent/src/http/app/message-actions.ts";
import { Ledger } from "../../packages/agent/src/objects/ledger.ts";
import people from "../fixtures/people.json" with { type: "json" };
import { FakeModel, type FakeStep } from "../support/fake-model.ts";
import { harnessNamespace, ObjectHarness } from "../support/object-harness.ts";
import { type El, page } from "./support/page-harness.ts";

type Plant = Parameters<typeof page>[2];

/** A page on fixed answers (no world), its socket opened on an empty chat. */
async function threadPage(plant?: Plant) {
  const p = await page({ onSend() {} }, {}, plant);
  const s = p.sockets[0] as NonNullable<(typeof p.sockets)[0]>;
  p.open(s);
  p.deliver(s, { type: "history", entries: [], running: null });
  return { ...p, s };
}
const pillOf = (n: El | undefined) => n?.children.find((c) => c.className === "reaction-pill")?.textContent ?? null;

/** Ada's message m1 with the agent's 👍, then her 🙏, then the agent's taken off: the pill after each. m2 is the agent's answer. */
async function collected(plant?: Plant) {
  const p = await threadPage(plant);
  p.deliver(p.s, { type: "history", running: null, entries: [{ kind: "you", text: "Is the orchard walk on?", id: "a", mid: "m1", at: 1, reactions: [{ by: "agent", emoji: "👍" }] }, { kind: "agent", text: "Yes, Saturday at ten.", mid: "m2", at: 2 }] });
  const m1 = () => p.log.children[0];
  const pills = [pillOf(m1())];
  p.deliver(p.s, { type: "reaction", mid: "m1", by: "you", emoji: "🙏" });
  pills.push(pillOf(m1()));
  p.deliver(p.s, { type: "reaction", mid: "m1", by: "agent", emoji: null });
  pills.push(pillOf(m1()));
  return { p, m1: m1() as El, pills };
}

describe("[F10] reactions on the page", () => {
  it("a bubble collects the agent's and the person's reaction in one pill, the person's own marks the picker, and taking one off leaves the other", async () => {
    const { p, m1, pills } = await collected();
    expect(pills).toEqual(["👍", "👍🙏", "🙏"]);
    const hold = (n: El) => {
      (n.children.find((c) => c.className.startsWith("qf-bubble")) as El & { onpointerdown: (e: unknown) => void }).onpointerdown({ pointerType: "touch", clientX: 0, clientY: 0 });
      p.t.fire(HOLD_MS);
      return p.byId("msg-emos").children.map((b) => [b.attrs["aria-label"], b.attrs["aria-pressed"] === "true"] as const);
    };
    // Ada's own message offers no reaction in the held-touch popover (F21), though its pill still draws.
    expect(hold(m1)).toEqual([]);
    p.key("Escape");
    // On the agent's m2 the popover (all six; the phone sheet stops at five) marks Ada's own pick alone.
    p.deliver(p.s, { type: "reaction", mid: "m2", by: "you", emoji: "🙏" });
    const pressed = hold(p.log.children[1] as El).filter(([, on]) => on).map(([l]) => l);
    expect(pressed).toEqual([`${MESSAGE_TEXT.reactWith}folded hands`]);
  });

  it("planted: a page whose setReaction keeps one slot, ignoring who reacted, fails the collected pill", async () => {
    const oneSlot: Plant = (js) => {
      const at = js.indexOf("function setReaction(d, by, emoji) {");
      expect(at).toBeGreaterThan(-1);
      return js.replace("function setReaction(d, by, emoji) {", "function setReaction(d, by, emoji) { if (d.reactions) for (const k of Object.keys(d.reactions)) delete d.reactions[k];");
    };
    const { pills } = await collected(oneSlot);
    expect(pills).not.toEqual(["👍", "👍🙏", "🙏"]);
    expect(pills[1]).toBe("🙏");
  });
});

/** Ada's send, the page's id for it, and its bubble: drawn faint until the chat answers. */
async function sentPage(plant?: Plant) {
  const p = await threadPage(plant);
  await p.type("Plan my week.");
  const id = (JSON.parse(p.s.sent.at(-1) as string) as { id: string }).id;
  return { p, id, bubble: p.log.children.at(-1) as El };
}

describe("[F10] the person's message is named at once", () => {
  it("the person's bubble is named when the chat says it is stored, so a reaction frame on it lands mid-turn; a queued send is named by its mailbox mid", async () => {
    const { p, id, bubble } = await sentPage();
    p.deliver(p.s, { type: "turn_started", turn: "t1", text: "Plan my week.", id, mid: "m3" });
    expect([bubble.className, bubble.dataset.mid, p.log.children.filter((c) => c.className.startsWith("m you")).length]).toEqual(["m you", "m3", 1]);
    p.deliver(p.s, { type: "reaction", mid: "m3", by: "agent", emoji: "👍" });
    expect(pillOf(bubble)).toBe("👍");
    // Its actions are drawn once, and the turn's named frame at its end leaves it as it is.
    const acts = () => bubble.children.filter((c) => c.className.startsWith("acts")).length;
    expect(acts()).toBe(1);
    // A send the page drew while the turn runs, and one it did not (another tab's), each named by the mailbox.
    await p.type("Also the dentist.");
    const queuedId = (JSON.parse(p.s.sent.at(-1) as string) as { id: string }).id;
    const own = p.log.children.at(-1) as El;
    p.deliver(p.s, { type: "queued", turn: "t1", ordinal: 2, text: "Also the dentist.", id: queuedId, mid: "q2" });
    p.deliver(p.s, { type: "queued", turn: "t1", ordinal: 3, text: "And the vet.", mid: "q3" });
    expect([own.dataset.mid, p.log.children.at(-1)?.dataset.mid, p.log.children.at(-1)?.text()]).toEqual(["q2", "q3", expect.stringContaining("And the vet.")]);
    // The same words sent again, not yet answered: the turn's named frame for m3 is not that bubble's.
    await p.type("Plan my week.");
    const again = p.log.children.at(-1) as El;
    p.deliver(p.s, { type: "named", turn: "t1", messages: [{ mid: "m3", who: "you", text: "Plan my week.", at: 3 }] });
    expect([bubble.dataset.mid, acts(), pillOf(bubble), again.dataset.mid]).toEqual(["m3", 1, "👍", undefined]);
    again.remove();
    // A queued send that waited past the turn's end starts its own: the same bubble, named as the transcript draws it.
    const before = p.log.children.length;
    p.deliver(p.s, { type: "turn_done", turn: "t1", chars: 0 });
    p.deliver(p.s, { type: "turn_started", turn: "t2", text: "Also the dentist.", id: queuedId, mid: "m6" });
    expect([own.dataset.mid, p.log.children.length, own.children.filter((c) => c.className.startsWith("acts")).length]).toEqual(["m6", before, 1]);
  });

  it("a turn_started from another tab's send draws the bubble named", async () => {
    const p = await threadPage();
    p.deliver(p.s, { type: "turn_started", turn: "t1", text: "Plan my week.", mid: "m1" });
    expect(p.log.children.at(-1)?.dataset.mid).toBe("m1");
  });

  it("planted: a turn_started handler that ignores mid leaves the reaction frame without a bubble", async () => {
    const ignore: Plant = (js) => {
      const at = js.indexOf("nameSent(");
      expect(at).toBeGreaterThan(-1);
      return js.replace('else if (f.type === "turn_started") {', 'else if (f.type === "turn_started") { delete f.mid;');
    };
    const { p, id, bubble } = await sentPage(ignore);
    p.deliver(p.s, { type: "turn_started", turn: "t1", text: "Plan my week.", id, mid: "m3" });
    p.deliver(p.s, { type: "reaction", mid: "m3", by: "agent", emoji: "👍" });
    expect([bubble.dataset.mid, pillOf(bubble)]).toEqual([undefined, null]);
  });
});

const ada = people.people.find((p) => p.id === "sam-solo")!;
type Frame = Record<string, unknown>;

/** Ada's chat over the production engine (as M24.2's world), one socket collecting its frames. */
function engineWorld(script: FakeStep[]) {
  const fake = new FakeModel(script);
  const ledgers = harnessNamespace((name) => new ObjectHarness(name, (ctx, env) => new Ledger(ctx as DurableObjectState, env as Env), {}));
  const socket = { state: { person: ada.email }, frames: [] as Frame[], send: (d: string) => void socket.frames.push(JSON.parse(d)) };
  const chat: ObjectHarness<ChatEngine> = new ObjectHarness(
    "chat-ada",
    (ctx, e) => new ChatEngine(ctx as EngineCtx, e as Env, { sockets: () => ownerOnly([socket], chat.instance.owner()) }),
    { TENANT_ID: ada.company, QYVR_ENV: "staging", AI: fake.binding, LEDGER: ledgers.binding },
    (c) => {
      c.wait = async () => {};
    },
  );
  chat.instance.claim(ada.email);
  const send = (text: string, clientId: string) => chat.instance.send({ person: ada.email, text, clientId });
  const midOf = (text: string) => ((e) => (e && "mid" in e ? e.mid : undefined))(chat.instance.history().entries.find((e) => e.kind === "you" && e.text === text));
  const framed = (type: string, id: string) => socket.frames.find((f) => f.type === type && f.id === id)?.mid;
  return { fake, chat, send, midOf, framed };
}
const held = (name: string, step: FakeStep): FakeStep => ({ checkpoint: name, step });

describe("[F10] the engine names the person's message on its frames", () => {
  it("turn_started carries the mid history draws for the message, and a queued send the mid it keeps once steered", async () => {
    const w = engineWorld([held("busy", { toolCall: { name: "send_to_user", arguments: { text: "On it." } } }), { text: "Both handled." }]);
    const first = w.send("Plan my week.", "s1");
    await w.fake.reached("busy");
    await w.send("Also the dentist.", "s2");
    const started = w.framed("turn_started", "s1");
    expect(started).toMatch(/^m\d+$/);
    expect(w.midOf("Plan my week.")).toBe(started);
    expect(w.framed("queued", "s2")).toBe("q2");
    w.fake.release("busy");
    expect(await first).toMatchObject({ status: "done" });
    expect([w.midOf("Plan my week."), w.midOf("Also the dentist.")]).toEqual([started, "q2"]);
  });
});
