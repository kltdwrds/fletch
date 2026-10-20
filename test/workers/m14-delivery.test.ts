// M14.1: the outbox's pacing and feedback. Requested results go at once into their chat; proactive items
// wait for waking hours in the person's zone and a quiet stretch after they last wrote, and at most one
// proactive delivery goes out a day, carrying everything then held. Feedback is a journal row of ids and
// codes in the Ledger, written before anything changes; a reject is a one-time dismissal, a stop a
// stated preference. Two members: Ada's preferences and feedback never touch Bo's delivery.
import { describe, expect, it } from "vitest";
import { checkJournalRow } from "../../packages/agent/src/grants/journal.ts";
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

  it("pacing test: one proactive delivery a day carries everything held; requested results never wait", async () => {
    const w = deliveryWorld();
    const chat = w.openChat(ada.email);
    await w.http(ada.email, "POST", "/push/subscribe", { subscription: (await w.push.browser()).subscription });
    // Ada wrote a minute ago: the first offer waits for the quiet stretch.
    w.clock.now = T0;
    w.person(ada.email).activity();
    w.clock.now = T0 + 60_000;
    expect(await w.deliver(ada.email, offer("offer:1"))).toMatchObject({ state: "held", code: "DELIVERY_NOT_QUIET" });
    expect(w.flushAt.get(ada.email)).toBe(T0 + QUIET_MS);
    // A requested result is not paced: it arrives now, in its chat, while the offer still waits.
    expect(await w.deliver(ada.email, { id: "hn-watch:notice:9", kind: "requested", category: "job:hn-watch", chat, source: "job:hn-watch", text: "Edition 9." })).toMatchObject({ state: "delivered" });
    await w.flush(ada.email);
    expect(w.clock.now).toBe(T0 + QUIET_MS);
    expect(w.notices(ada.email).map((n) => n.id)).toEqual(["hn-watch:notice:9", "offer:1"]);
    // The day's proactive delivery has gone: two more offers wait for tomorrow's waking hours.
    w.clock.now += H;
    expect(await w.deliver(ada.email, offer("offer:2"))).toMatchObject({ state: "held", code: "DELIVERY_DAILY_CAP" });
    w.clock.now += H;
    expect(await w.deliver(ada.email, offer("offer:3"))).toMatchObject({ state: "held", code: "DELIVERY_DAILY_CAP" });
    expect(w.flushAt.get(ada.email)).toBe(Date.UTC(2026, 9, 14, 8, 0));
    const pushesBefore = w.push.delivered().length;
    await w.flush(ada.email);
    // Both arrive together at 08:00 the next day: two chat notices, one push naming both.
    expect(w.notices(ada.email).map((n) => n.id)).toEqual(["hn-watch:notice:9", "offer:1", "offer:2", "offer:3"]);
    expect(w.push.delivered()).toHaveLength(pushesBefore + 1);
    expect(w.push.delivered().at(-1)?.payload).toMatchObject({ title: "2 updates", items: ["offer:2", "offer:3"] });
    // No chat yet for Bo: a proactive item opens one rather than being lost.
    expect(await w.deliver(other.email, offer("offer:bo"))).toMatchObject({ state: "delivered" });
    expect(w.notices(other.email).map((n) => n.id)).toEqual(["offer:bo"]);
  });
});

describe("[M14.1] feedback", () => {
  it("accept, edit, reject and stop are journal rows of ids and codes, with no content", async () => {
    const w = deliveryWorld();
    const chat = w.openChat(ada.email);
    const marker = "Quarterly figures for the Lisbon office are 4.2 million";
    for (const n of [1, 2, 3, 4]) await w.deliver(ada.email, { id: `hn-watch:notice:${n}`, kind: "requested", category: "job:hn-watch", chat, source: "job:hn-watch", text: `${marker} (${n})` });
    const verdicts = ["accept", "edit", "reject", "stop"];
    for (const [i, v] of verdicts.entries()) {
      const r = await w.http(ada.email, "POST", "/delivery/feedback", { id: `hn-watch:notice:${i + 1}`, verdict: v, text: marker, edited: `${marker}, edited` });
      expect(r.status, v).toBe(200);
    }
    const rows = await w.ledger().journalRows({ principal: ada.email });
    expect(rows.map((r) => [r.id, r.outcome])).toEqual(verdicts.map((v, i) => [`feedback:hn-watch:notice:${i + 1}:${v}`, `FEEDBACK_${v.toUpperCase()}`]));
    for (const row of rows) {
      expect(checkJournalRow(row)).toEqual({ ok: true });
      expect(row).toMatchObject({ actor: `person:${ada.email}`, actionKind: "delivery.feedback", counterpart: "own-agent", grantId: null, tokens: 0 });
    }
    // Nothing the item said, nor what came with the request, is in any row.
    expect(JSON.stringify(rows)).not.toMatch(/Lisbon|4\.2|figures/);
    // Bo's journal is untouched.
    expect(await w.ledger().journalRows({ principal: other.email })).toEqual([]);
  });

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

  it("a one-time dismissal does not suppress the category; a stated preference does, until allowed again", async () => {
    const w = deliveryWorld();
    w.openChat(ada.email);
    w.openChat(other.email);
    const day = (n: number) => Date.UTC(2026, 9, 13 + n, 10, 0);
    w.clock.now = day(0);
    await w.deliver(ada.email, offer("offer:d0"));
    // "Not now" on today's offer: tomorrow's offer of the same kind still arrives.
    expect((await w.http(ada.email, "POST", "/delivery/feedback", { id: "offer:d0", verdict: "reject" })).status).toBe(200);
    w.clock.now = day(1);
    expect(await w.deliver(ada.email, offer("offer:d1"))).toMatchObject({ state: "delivered" });
    // "Stop these": the next one is suppressed and says why; Bo's of the same kind still arrive.
    expect((await w.http(ada.email, "POST", "/delivery/feedback", { id: "offer:d1", verdict: "stop" })).status).toBe(200);
    w.clock.now = day(2);
    expect(await w.deliver(ada.email, offer("offer:d2"))).toMatchObject({ state: "suppressed", code: "DELIVERY_STOPPED" });
    expect(await w.deliver(other.email, offer("offer:bo-d2"))).toMatchObject({ state: "delivered" });
    expect(w.notices(ada.email).map((n) => n.id)).toEqual(["offer:d0", "offer:d1"]);
    // A stop stated in settings reaches items already held, too.
    w.clock.now = Date.UTC(2026, 9, 15, 23, 0);
    await w.deliver(ada.email, { ...offer("offer:held"), category: "loop:reflection" });
    expect((await w.http(ada.email, "POST", "/delivery/preferences", { stop: "loop:reflection" })).status).toBe(200);
    await w.flush(ada.email);
    expect((await (await w.http(ada.email, "GET", "/delivery")).json()) as unknown).toMatchObject({ items: expect.arrayContaining([expect.objectContaining({ id: "offer:held", state: "suppressed", code: "DELIVERY_STOPPED" })]) });
    // Allowed again in settings: the kind arrives again.
    expect((await w.http(ada.email, "POST", "/delivery/preferences", { allow: "loop:skill-review" })).status).toBe(200);
    w.clock.now = day(4);
    expect(await w.deliver(ada.email, offer("offer:d4"))).toMatchObject({ state: "delivered" });
    const view = (await (await w.http(ada.email, "GET", "/delivery")).json()) as { stopped: string[]; dismissals: Array<{ item: string }> };
    expect(view.stopped).toEqual(["loop:reflection"]);
    expect(view.dismissals.map((d) => d.item)).toEqual(["offer:d0"]);
    expect(await (await w.http(ada.email, "POST", "/delivery/preferences", { zone: "Mars/Olympus" })).json()).toMatchObject({ code: "DELIVERY_ZONE_INVALID" });
    expect(await (await w.http(ada.email, "POST", "/delivery/preferences", { stop: "Bad Category" })).json()).toMatchObject({ code: "DELIVERY_CATEGORY_INVALID" });
  });
});

/** A former member's label: rows and files keyed by a person who is not on the roster (fletch's fixtures hold one person). */
const other = { ...ada, id: "former-member", email: "former-member", name: "Pat" };
