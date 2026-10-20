// M15.5: "Send a test notification" in Settings pushes one owner-only item to the person's subscribed
// devices, past pacing and the connected check, and leaves no chat or ledger content beyond its
// delivery row. Two members: Bo's test reaches Bo's device alone, and nobody can aim one at another
// person's devices. A failed push says its code and is never shown as sent.
import { describe, expect, it } from "vitest";
import { ada, deliveryWorld } from "./support/delivery-world.ts";

describe("[M15.5] test notification", () => {
  it("reaches each subscribed device of the person once, with no chat notice, no journal row and a delivered row", async () => {
    const w = deliveryWorld();
    const chat = w.openChat(ada.email);
    const phone = await w.push.browser();
    const laptop = await w.push.browser("updates.push.services.mozilla.com");
    for (const b of [phone, laptop]) await w.http(ada.email, "POST", "/push/subscribe", { subscription: b.subscription });
    // The app is open: ordinary delivery would send no push, a test does anyway (it bypasses the connected check).
    w.connect(chat);

    const r = await w.http(ada.email, "POST", "/push/test", {});
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ ok: true });
    expect(w.push.delivered().map((d) => d.endpoint).sort()).toEqual([phone.subscription.endpoint, laptop.subscription.endpoint].sort());
    expect(w.push.received[0]?.payload).toMatchObject({ title: "qyvr", url: "/" });
    expect(w.notices(ada.email)).toEqual([]);
    expect(await w.ledger().journalRows()).toEqual([]);
    const row = w.personDb(ada.email).prepare("SELECT category, state, disposition, attempts, channels FROM delivery_items").all();
    expect(row).toEqual([{ category: "test", state: "delivered", disposition: "delivered", attempts: 1, channels: '["push"]' }]);
    // It is not a delivery the dashboards count.
    expect(w.person(ada.email).counts(0, Number.MAX_SAFE_INTEGER)).toMatchObject({ items: 0, delivered: 0 });
  });

  it("bypasses pacing: a stated stop and the quiet stretch do not hold it", async () => {
    const w = deliveryWorld();
    w.openChat(ada.email);
    await w.http(ada.email, "POST", "/push/subscribe", { subscription: (await w.push.browser()).subscription });
    await w.http(ada.email, "POST", "/delivery/preferences", { stop: "test" });
    w.person(ada.email).activity();
    const r = await w.http(ada.email, "POST", "/push/test", {});
    expect(await r.json()).toMatchObject({ ok: true });
    expect(w.push.delivered()).toHaveLength(1);
  });

  it("with no subscribed device or a push the service refuses, it says so with the code, never sent", async () => {
    const w = deliveryWorld();
    w.openChat(ada.email);
    const none = await w.http(ada.email, "POST", "/push/test", {});
    expect(none.status).toBe(400);
    expect(await none.json()).toMatchObject({ ok: false, code: "PUSH_NO_SUBSCRIPTION" });
    const b = await w.push.browser();
    await w.http(ada.email, "POST", "/push/subscribe", { subscription: b.subscription });
    w.push.statuses.set(b.subscription.endpoint, 503);
    const down = await w.http(ada.email, "POST", "/push/test", {});
    expect(await down.json()).toMatchObject({ ok: false, code: "PUSH_HTTP_503" });
    expect(w.personDb(ada.email).prepare("SELECT disposition, code FROM delivery_items WHERE category = 'test' ORDER BY created_at").all()).toEqual([
      { disposition: "failed", code: "PUSH_NO_SUBSCRIPTION" },
      { disposition: "failed", code: "PUSH_HTTP_503" },
    ]);
  });
});
