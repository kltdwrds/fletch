// M14.2: the app's pages and the chat topology (muse spec section 14.1). The page script runs as shipped
// against a minimal DOM whose fetch is the agent script's real `route` over the authority world, so
// "the page reopens the main chat" is what the page does, not what its text says. Chats, approvals,
// jobs, the library and the loops are read through the real objects; delivery targets the person's
// main chat when the addressed chat is archived, gone, or a request chat for a proactive item.
import { describe, expect, it } from "vitest";
import { ANSWER_TIMEOUT_MS, OPEN_TIMEOUT_MS, RECONNECT_DELAYS_MS, RECONNECT_SCRIPT } from "../../packages/agent/src/http/reconnect.ts";
import { ada, } from "./support/authority-world.ts";
import { deliveryWorld } from "./support/delivery-world.ts";

describe("[M14.2] chat topology", () => {
  it("a planted proactive item never lands in a colleague's request chat", async () => {
    const w = deliveryWorld();
    const main = w.openChat(ada.email);
    const request = w.openChat(ada.email, "request");
    const mail = w.openChat(ada.email, "mail");
    expect(w.chatList(ada.email).entries().map((c) => c.kind)).toEqual(["main", "request", "mail"]);
    // Planted: proactive items addressed to the request chat and the mail chat.
    for (const [id, chat] of [["offer:planted-request", request], ["offer:planted-mail", mail]] as const) {
      expect(await w.deliver(ada.email, { id, kind: "proactive", category: "loop:skill-review", chat, source: "loop:skill-review", text: id })).toMatchObject({ state: "delivered" });
      w.clock.now += 86_400_000;
    }
    // A requested result for the request chat still belongs there.
    await w.deliver(ada.email, { id: "reply:1", kind: "requested", category: "colleague", chat: request, source: "colleague", text: "done" });
    expect(w.notices(ada.email).map((n) => [n.chat, n.id])).toEqual([[main, "offer:planted-request"], [main, "offer:planted-mail"], [request, "reply:1"]]);
    // Plant the guard: with the kind check gone (the row marked side), the same item would land there.
    w.personChatsDb(ada.email).prepare("UPDATE chats SET kind = 'side' WHERE id = ?").run(request);
    expect(await w.chatList(ada.email).target(request, "proactive", w.clock.now)).toEqual({ ok: true, chatId: request });
  });
});

describe("[M14.2] app pages", () => {
  it("the socket reconnects after a 1006 close with a backoff, says so, and refuses to send while down", () => {
    const states: string[] = [];
    // The page's timers: a cancelled one never fires (M18.1 cancels a backoff the person's action overtakes).
    const later: Array<{ f: () => void; ms: number; cancelled?: boolean }> = [];
    const live = () => later.filter((l) => !l.cancelled);
    const fire = (ms: number) => {
      const t = live().find((l) => l.ms === ms);
      if (!t) throw new Error(`no live timer of ${ms} ms`);
      t.cancelled = true;
      t.f();
    };
    const made: Array<{ readyState: number; sent: string[]; onopen?: () => void; onclose?: (e: { code: number; reason?: string }) => void; close(): void }> = [];
    const keep = new Function(`${RECONNECT_SCRIPT}; return keepConnected;`)() as (open: () => unknown, onState: (s: string, i: Record<string, unknown>) => void, o: unknown) => { send(d: string): boolean; stop(): void };
    const conn = keep(
      () => {
        const s = { readyState: 0, sent: [] as string[], send(d: string) { this.sent.push(d); }, close() { this.readyState = 3; } } as (typeof made)[number] & { send(d: string): void };
        made.push(s);
        return s;
      },
      (s, i) => states.push(i.inMs !== undefined ? `${s}:${i.code}:${i.inMs}` : s),
      {
        delays: RECONNECT_DELAYS_MS, openTimeoutMs: OPEN_TIMEOUT_MS, answerTimeoutMs: ANSWER_TIMEOUT_MS, probe: "{}", onmessage: () => {},
        schedule: (f: () => void, ms: number) => { const t = { f, ms }; later.push(t); return t; },
        cancel: (t: { cancelled?: boolean }) => { t.cancelled = true; },
      },
    );
    const open = (n: number) => {
      (made[n] as { readyState: number }).readyState = 1;
      made[n]?.onopen?.();
    };
    open(0);
    expect(conn.send("one")).toBe(true);
    made[0]?.onclose?.({ code: 1006 });
    // Refused while down, and the person's send is the action that reconnects at once (M18.1).
    expect(conn.send("lost")).toBe(false);
    made[1]?.onclose?.({ code: 1006 });
    fire(RECONNECT_DELAYS_MS[1] as number);
    open(2);
    expect(conn.send("two")).toBe(true);
    expect(states).toEqual(["connecting", "connected", `reconnecting:1006:${RECONNECT_DELAYS_MS[0]}`, "connecting", `reconnecting:1006:${RECONNECT_DELAYS_MS[1]}`, "connecting", "connected"]);
    expect(made.map((m) => m.sent)).toEqual([["one"], [], ["two"]]);
    // Stopped (switching chats): a late close does not reconnect.
    conn.stop();
    made[2]?.onclose?.({ code: 1000 });
    expect(live()).toEqual([]);
    expect(states.at(-1)).toBe("closed");
  });
});
