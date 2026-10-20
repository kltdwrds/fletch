// M14.1: the outbox's pacing and feedback. Requested results go at once into their chat; proactive items
// wait for waking hours in the person's zone and a quiet stretch after they last wrote, and at most one
// proactive delivery goes out a day, carrying everything then held. Feedback is a journal row of ids and
// codes in the Ledger, written before anything changes; a reject is a one-time dismissal, a stop a
// stated preference. Two members: Ada's preferences and feedback never touch Bo's delivery.
import { describe, expect, it } from "vitest";
import { decide, QUIET_MS } from "../../packages/agent/src/delivery/pacing.ts";
import { ada, deliveryWorld, T0 } from "./support/delivery-world.ts";

const H = 3_600_000;
const offer = (id: string, text = `Offer ${id}: a draft skill to review.`) => ({ id, kind: "proactive" as const, category: "loop:skill-review", source: "loop:skill-review", text });
const state = (o: Partial<Parameters<typeof decide>[1]> = {}) => ({ zone: "UTC", lastActivityAt: null, lastProactiveAt: null, stopped: new Set<string>(), ...o });
const item = (o: Partial<Parameters<typeof decide>[0]> = {}) => ({ kind: "proactive" as const, category: "loop:skill-review", urgent: false, ...o });

describe("[M14.1] pacing", () => {
  it("decides by the rules, in order: requested, stop, urgent, waking hours, daily cap, quiet stretch", () => {
    const night = Date.UTC(2026, 9, 13, 3, 0);
    expect(decide(item({ kind: "requested" }), state({ stopped: new Set(["loop:skill-review"]) }), night)).toEqual({ action: "deliver" });
    expect(decide(item({ urgent: true }), state({ stopped: new Set(["loop:skill-review"]) }), night)).toEqual({ action: "suppress", code: "DELIVERY_STOPPED" });
    expect(decide(item({ urgent: true }), state(), night)).toEqual({ action: "deliver" });
    expect(decide(item(), state(), night)).toEqual({ action: "hold", until: Date.UTC(2026, 9, 13, 8, 0), code: "DELIVERY_WAITING_HOURS" });
    expect(decide(item(), state(), Date.UTC(2026, 9, 13, 21, 30))).toEqual({ action: "hold", until: Date.UTC(2026, 9, 14, 8, 0), code: "DELIVERY_WAITING_HOURS" });
    expect(decide(item(), state({ lastProactiveAt: T0 - H }), T0)).toEqual({ action: "hold", until: Date.UTC(2026, 9, 14, 8, 0), code: "DELIVERY_DAILY_CAP" });
    expect(decide(item(), state({ lastProactiveAt: T0 - 24 * H }), T0)).toEqual({ action: "deliver" });
    expect(decide(item(), state({ lastActivityAt: T0 - 5 * 60_000 }), T0)).toEqual({ action: "hold", until: T0 - 5 * 60_000 + QUIET_MS, code: "DELIVERY_NOT_QUIET" });
    expect(decide(item(), state({ lastActivityAt: T0 - QUIET_MS }), T0)).toEqual({ action: "deliver" });
    // In the person's zone: 10:00 UTC is 23:00 in Auckland (NZDT), so it waits for 08:00 there.
    expect(decide(item(), state({ zone: "Pacific/Auckland" }), T0)).toEqual({ action: "hold", until: Date.UTC(2026, 9, 13, 19, 0), code: "DELIVERY_WAITING_HOURS" });
  });
});

describe("[M14.1] feedback", () => {

  it("feedback is refused on an unknown or undelivered item, from another origin, and when the Ledger refuses its row nothing changes", async () => {
    const w = deliveryWorld();
    const chat = w.openChat(ada.email);
    await w.deliver(ada.email, { id: "hn-watch:notice:1", kind: "requested", category: "job:hn-watch", chat, source: "job:hn-watch", text: "one" });
    w.clock.now = Date.UTC(2026, 9, 13, 23, 0);
    await w.deliver(ada.email, offer("offer:night"));
    expect((await w.http(ada.email, "POST", "/delivery/feedback", { id: "nope", verdict: "accept" })).status).toBe(404);
    expect(await (await w.http(ada.email, "POST", "/delivery/feedback", { id: "offer:night", verdict: "accept" })).json()).toMatchObject({ code: "DELIVERY_NOT_DELIVERED" });
    expect(await (await w.http(ada.email, "POST", "/delivery/feedback", { id: "hn-watch:notice:1", verdict: "love" })).json()).toMatchObject({ code: "DELIVERY_FEEDBACK_INVALID" });
    expect((await w.http(ada.email, "POST", "/delivery/feedback", { id: "hn-watch:notice:1", verdict: "stop" }, "https://evil.example")).status).toBe(403);
    // Planted: the Ledger refuses the row. The stop is not recorded, so the category is not stopped.
    w.ledger().journal = async () => ({ ok: false, code: "JOURNAL_ROW_INVALID", reason: "planted" });
    expect(await (await w.http(ada.email, "POST", "/delivery/feedback", { id: "hn-watch:notice:1", verdict: "stop" })).json()).toMatchObject({ code: "JOURNAL_ROW_INVALID" });
    const view = (await (await w.http(ada.email, "GET", "/delivery")).json()) as { stopped: string[]; items: Array<{ id: string; feedback: string | null }> };
    expect(view.stopped).toEqual([]);
    expect(view.items.find((i) => i.id === "hn-watch:notice:1")?.feedback).toBeNull();
  });
});
