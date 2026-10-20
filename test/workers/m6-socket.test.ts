// M6.1: one outbound socket source with alarm-driven reconnect, against a fake server. Its messages
// are events like a webhook's (one gate evaluation per id); a drop waits out a doubling backoff and
// the alarm reconnects; an eviction loses the socket and the heartbeat alarm reconnects it.
import { describe, expect, it } from "vitest";
import { HEARTBEAT_MS, RECONNECT_BASE_MS } from "../../packages/agent/src/ingress/engine.ts";
import { ada } from "./support/job-world.ts";
import { eventJob, ingressWorld, SOURCE, settle } from "./support/ingress-world.ts";

const URL_ = "wss://events.solo-sam.example/stream";

async function started() {
  const w = ingressWorld();
  w.ada.claimChat("chat-ada", ada.email);
  await w.ada.define(eventJob());
  expect(await w.ingress.engine().create({ id: SOURCE, owner: ada.email, kind: "socket", jobs: ["deploys"], url: URL_ })).toMatchObject({ ok: true, kind: "socket" });
  expect(await w.ingress.engine().start(ada.email)).toMatchObject({ ok: true, socket: { state: "connected", connects: 1 } });
  return w;
}

const evaluations = (w: ReturnType<typeof ingressWorld>) => w.ada.engine().events.list().map((e) => e.eventId);
const socketOf = (w: ReturnType<typeof ingressWorld>) => {
  const s = w.ingress.engine().inspect(ada.email);
  if (!s.ok) throw new Error(s.code);
  return s.socket;
};

describe("[M6.1] socket source", () => {
  it("turns each message into one evaluation, reconnects after the server drops it, and dedupes a resent id", async () => {
    const w = await started();
    expect(w.server.urls).toEqual([URL_]);
    w.server.live?.send('{"id":"e1","deploy":"web"}');
    await settle();
    expect(evaluations(w)).toEqual(["e1"]);
    // While connected, the alarm is the heartbeat.
    expect(w.ingress.alarm).toBe(w.clock.now + HEARTBEAT_MS);

    w.server.live?.close(1012);
    await settle();
    expect(socketOf(w)).toMatchObject({ state: "waiting", attempts: 1, drops: 1, lastCode: "INGRESS_SOCKET_CLOSED" });
    expect(w.ingress.alarm).toBe(w.clock.now + RECONNECT_BASE_MS);
    await w.ingress.fire();
    expect(socketOf(w)).toMatchObject({ state: "connected", connects: 2, attempts: 0 });
    expect(w.server.servers).toHaveLength(2);

    // The server resends what it sent before the drop, then a new event.
    w.server.live?.send('{"id":"e1","deploy":"web"}');
    w.server.live?.send('{"id":"e2","deploy":"api"}');
    await settle();
    expect(evaluations(w)).toEqual(["e1", "e2"]);
    expect(w.logs.filter((l) => l.event === "ingress.socket_down")).toHaveLength(1);
  });

  it("backs off a refusing server 1 s, 2 s, 4 s, then connects", async () => {
    const w = await started();
    w.server.refuse = true;
    w.server.live?.close();
    await settle();
    const waits: number[] = [];
    for (let i = 0; i < 3; i++) {
      const before = w.clock.now;
      waits.push((w.ingress.alarm as number) - before);
      await w.ingress.fire();
    }
    expect(waits).toEqual([1000, 2000, 4000]);
    expect(socketOf(w)).toMatchObject({ state: "waiting", attempts: 4, lastCode: "INGRESS_SOCKET_CONNECT_FAILED" });
    w.server.refuse = false;
    await w.ingress.fire();
    expect(socketOf(w)).toMatchObject({ state: "connected", attempts: 0, connects: 2 });
  });

  it("reconnects from the heartbeat alarm after an eviction drops the socket, and a stopped source stays down", async () => {
    const w = await started();
    w.ingress.harness.evict();
    await w.ingress.fire();
    expect(socketOf(w)).toMatchObject({ state: "connected", connects: 2 });
    w.server.live?.send('{"id":"e9"}');
    await settle();
    expect(evaluations(w)).toEqual(["e9"]);

    expect(await w.ingress.engine().stop(ada.email)).toEqual({ ok: true });
    expect(w.ingress.alarm).toBeNull();
    expect(socketOf(w)).toMatchObject({ wanted: false, state: "idle" });
  });

  it("refuses and logs a message without an event id, and evaluates nothing for it", async () => {
    const w = await started();
    w.server.live?.send('{"deploy":"web"}');
    w.server.live?.send("not json");
    await settle();
    const s = w.ingress.engine().inspect(ada.email);
    expect(s.ok && s.rejects.map((r) => r.code)).toEqual(["INGRESS_EVENT_ID_MISSING", "INGRESS_EVENT_ID_MISSING"]);
    expect(evaluations(w)).toEqual([]);
  });

  it("refuses a socket source whose url is not wss", async () => {
    const w = ingressWorld();
    expect(await w.ingress.engine().create({ id: SOURCE, owner: ada.email, kind: "socket", jobs: ["deploys"], url: "ws://plain.example/" })).toMatchObject({ ok: false, code: "INGRESS_URL_INVALID" });
  });
});
