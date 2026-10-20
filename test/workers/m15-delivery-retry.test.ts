// M15.2 delivery bookkeeping (Muse spec §14.4, §16.3): every item keeps its attempts, its next attempt
// and its disposition, `delivered | failed | null`. A push or a mail that fails on a transient code is
// retried once, at its next attempt; a channel never gets a second retry, and a failure that is not
// transient falls through at once. Ada and Bo each have their own items, read back by each alone.
import { describe, expect, it } from "vitest";
import { DELIVERY_RETRY_MS } from "../../packages/agent/src/delivery/service.ts";
import { ada, deliveryWorld, T0 } from "./support/delivery-world.ts";

const job = (id: string, chat: string) => ({ id, kind: "requested" as const, category: "job:hn-watch", chat, source: "job:hn-watch", text: `Edition ${id} is out.` });

async function subscribed(w: ReturnType<typeof deliveryWorld>, email: string) {
  const b = await w.push.browser();
  expect((await w.http(email, "POST", "/push/subscribe", { subscription: b.subscription })).status).toBe(200);
  return b.subscription.endpoint;
}

const itemOf = (w: ReturnType<typeof deliveryWorld>, email: string, id: string) => {
  const v = w.person(email).view(email);
  if (!v.ok) throw new Error(v.code);
  return v.items.find((i) => i.id === id);
};

describe("[M15.2] delivery retries", () => {

  it("a failure that is not transient is not retried: a gone subscription falls through to mail at once", async () => {
    const w = deliveryWorld();
    const chat = w.openChat(ada.email);
    w.push.statuses.set(await subscribed(w, ada.email), 410);
    expect(await w.deliver(ada.email, job("hn:3", chat))).toMatchObject({ channels: ["chat", "mail"], code: "PUSH_HTTP_410" });
    expect(itemOf(w, ada.email, "hn:3")).toMatchObject({ attempts: 1, nextAttempt: null, disposition: "delivered", retried: [] });
    // A deterministic mail refusal settles failed with no retry.
    w.mailFailures.push("MAIL_QUOTA_EXHAUSTED");
    expect(await w.deliver(ada.email, job("hn:4", chat))).toMatchObject({ channels: ["chat"], code: "MAIL_QUOTA_EXHAUSTED" });
    expect(itemOf(w, ada.email, "hn:4")).toMatchObject({ attempts: 1, nextAttempt: null, disposition: "failed" });
    expect(w.flushAt.has(ada.email)).toBe(false);
  });

  it("an item whose person is in the app at its retry is delivered there, with no second push", async () => {
    const w = deliveryWorld();
    const chat = w.openChat(ada.email);
    const endpoint = await subscribed(w, ada.email);
    w.push.statuses.set(endpoint, 500);
    await w.deliver(ada.email, job("hn:5", chat));
    w.connect(chat);
    await w.flush(ada.email);
    expect(w.push.received).toHaveLength(1);
    expect(itemOf(w, ada.email, "hn:5")).toMatchObject({ attempts: 2, disposition: "delivered", nextAttempt: null });
  });

  it("one alarm serves held items and retries: it is armed for the earlier, then for the later", async () => {
    const w = deliveryWorld();
    const chat = w.openChat(ada.email);
    const endpoint = await subscribed(w, ada.email);
    // The day's one proactive delivery goes, so the next proactive item is held until tomorrow.
    await w.deliver(ada.email, { id: "tip:1", kind: "proactive", category: "loop:skill-review", source: "loop:skill-review", text: "Drafts are ready." });
    await w.deliver(ada.email, { id: "tip:2", kind: "proactive", category: "loop:skill-review", source: "loop:skill-review", text: "More drafts are ready." });
    const held = itemOf(w, ada.email, "tip:2");
    expect(held).toMatchObject({ state: "held", disposition: null });
    expect(held?.holdUntil).toBeGreaterThan(T0 + DELIVERY_RETRY_MS);
    w.push.statuses.set(endpoint, 503);
    await w.deliver(ada.email, job("hn:6", chat));
    expect(w.flushAt.get(ada.email)).toBe(T0 + DELIVERY_RETRY_MS);
    w.push.statuses.delete(endpoint);
    await w.flush(ada.email);
    expect(itemOf(w, ada.email, "hn:6")).toMatchObject({ disposition: "delivered" });
    expect(itemOf(w, ada.email, "tip:2")).toMatchObject({ state: "held" });
    expect(w.flushAt.get(ada.email)).toBe(held?.holdUntil);
  });
});
