// M14.1: Web Push with VAPID. A subscription is stored in the person's object through the app's route;
// a staged notification reaches the fake push service with a VAPID authorization it verifies and a body
// the subscribed browser decrypts; nothing is pushed while a client of the person is connected; the
// endpoint policy holds at the route, at every send and at the Vault's signer; the VAPID private key
// never leaves the Vault in the clear. Two members throughout: Ada's subscription never gets Bo's items.
import { describe, expect, it } from "vitest";
import { checkSubscription, encryptPayload, PAYLOAD_MAX } from "../../packages/agent/src/delivery/webpush.ts";
import { ada, deliveryWorld, HOST } from "./support/delivery-world.ts";
import { checkVapid } from "./support/push-service.ts";

const job = (id: string, chat: string, text = `Edition ${id} is out.`) => ({ id, kind: "requested" as const, category: "job:hn-watch", chat, source: "job:hn-watch", text });

describe("[M14.1] push subscriptions", () => {
  it("a push subscription is stored and a staged notification is delivered, decrypted by the browser", async () => {
    const w = deliveryWorld();
    const chat = w.openChat(ada.email);
    const browser = await w.push.browser();
    const key = await w.http(ada.email, "GET", "/push/key");
    const { key: vapid } = (await key.json()) as { key: string };
    expect(vapid).toMatch(/^[A-Za-z0-9_-]{87}$/);
    const sub = await w.http(ada.email, "POST", "/push/subscribe", { subscription: browser.subscription });
    expect(sub.status).toBe(200);
    expect(w.personDb(ada.email).prepare("SELECT endpoint, p256dh, auth FROM push_subscriptions").all()).toEqual([
      { endpoint: browser.subscription.endpoint, p256dh: browser.subscription.keys.p256dh, auth: browser.subscription.keys.auth },
    ]);

    const r = await w.deliver(ada.email, job("hn-watch:notice:0001", chat));
    expect(r).toMatchObject({ ok: true, state: "delivered", channels: ["chat", "push"] });
    expect(w.push.delivered()).toHaveLength(1);
    const got = w.push.received[0]!;
    expect(got.why).toBeNull();
    expect(got.headers).toMatchObject({ "content-encoding": "aes128gcm", ttl: "86400", urgency: "normal" });
    expect(got.headers.authorization).toContain(`k=${vapid}`);
    expect(got.payload).toEqual({ title: "job:hn-watch", body: "Edition hn-watch:notice:0001 is out.", items: ["hn-watch:notice:0001"], url: `/chats/${chat}` });
    // The chat has it too, once, as the record the next turn sees.
    expect(w.notices(ada.email).map((n) => n.id)).toEqual(["hn-watch:notice:0001"]);
    // Delivered again (an unknown outcome at the sender): nothing is shown or pushed twice.
    expect(await w.deliver(ada.email, job("hn-watch:notice:0001", chat))).toMatchObject({ ok: true, duplicate: true });
    expect(w.push.received).toHaveLength(1);
    expect(w.notices(ada.email)).toHaveLength(1);
  });

  it("nothing is pushed while a client of the person is connected; once it closes, the next item is", async () => {
    const w = deliveryWorld();
    const chat = w.openChat(ada.email);
    const other = w.openChat(ada.email);
    await w.http(ada.email, "POST", "/push/subscribe", { subscription: (await w.push.browser()).subscription });
    // The app is open on another of Ada's chats: still in the app, so no push and no mail.
    w.connect(other);
    expect(await w.deliver(ada.email, job("hn-watch:notice:0002", chat))).toMatchObject({ state: "delivered", channels: ["chat"] });
    expect(w.push.received).toEqual([]);
    expect(w.mail).toEqual([]);
    w.disconnect(other);
    expect(await w.deliver(ada.email, job("hn-watch:notice:0003", chat))).toMatchObject({ channels: ["chat", "push"] });
    expect(w.push.delivered()).toHaveLength(1);
  });

  it("a gone subscription (410) is removed and the item falls back to mail; with mail off it waits in the chat", async () => {
    const w = deliveryWorld();
    const chat = w.openChat(ada.email);
    const b = await w.push.browser();
    await w.http(ada.email, "POST", "/push/subscribe", { subscription: b.subscription });
    w.push.statuses.set(b.subscription.endpoint, 410);
    expect(await w.deliver(ada.email, job("hn-watch:notice:0004", chat))).toMatchObject({ channels: ["chat", "mail"], code: "PUSH_HTTP_410" });
    expect(w.personDb(ada.email).prepare("SELECT * FROM push_subscriptions").all()).toEqual([]);
    expect(w.mail).toMatchObject([{ person: ada.email, chat, subject: "qyvr: job:hn-watch" }]);
    expect((await w.http(ada.email, "POST", "/delivery/preferences", { mail: false })).status).toBe(200);
    // No subscription and no mail: the chat holds it, and the item says why nothing else went.
    expect(await w.deliver(ada.email, job("hn-watch:notice:0005", chat))).toMatchObject({ channels: ["chat"], code: "PUSH_NO_SUBSCRIPTION" });
    expect(w.mail).toHaveLength(1);
    // The person's own mail is never mailed back to them.
    await w.http(ada.email, "POST", "/delivery/preferences", { mail: true });
    expect(await w.deliver(ada.email, { ...job("mail:abc", chat), category: "mail", source: "mail:person" })).toMatchObject({ channels: ["chat"] });
    expect(w.mail).toHaveLength(1);
  });

  it("the endpoint policy holds at the route, at every send (planted row), and at the Vault's signer", async () => {
    const w = deliveryWorld();
    const chat = w.openChat(ada.email);
    const b = await w.push.browser();
    for (const endpoint of ["http://fcm.googleapis.com/x", "https://169.254.169.254/latest", "https://solo-sam.qyvr-staging.dev/hooks/x", "https://fcm.googleapis.com:8443/x", "https://evil.example/fcm.googleapis.com", ["https://user:pw", "fcm.googleapis.com/x"].join("@")]) {
      const r = await w.http(ada.email, "POST", "/push/subscribe", { subscription: { ...b.subscription, endpoint } });
      expect(r.status, endpoint).toBe(400);
      expect(await r.json()).toMatchObject({ code: "PUSH_ENDPOINT_POLICY" });
    }
    expect(checkSubscription({ ...b.subscription, keys: { ...b.subscription.keys, auth: "AAAA" } })).toMatchObject({ ok: false, code: "PUSH_SUBSCRIPTION_INVALID" });
    expect(checkSubscription({ ...b.subscription, keys: { ...b.subscription.keys, p256dh: b.subscription.keys.auth } })).toMatchObject({ ok: false, code: "PUSH_SUBSCRIPTION_INVALID" });
    // Planted: a row written past the route, aimed at an internal host. The send re-checks and never posts.
    w.person(ada.email).view(ada.email);
    w.personDb(ada.email).prepare("INSERT INTO push_subscriptions (endpoint, p256dh, auth, created_at) VALUES (?, ?, ?, 0)").run("https://internal.example/push", b.subscription.keys.p256dh, b.subscription.keys.auth);
    expect(await w.deliver(ada.email, job("hn-watch:notice:0006", chat))).toMatchObject({ code: "PUSH_ENDPOINT_POLICY", channels: ["chat", "mail"] });
    expect(w.push.received).toEqual([]);
    // Refused before the Vault is asked: the send's own check, not only the signer's.
    expect(w.signed).toEqual([]);
    // The Vault signs for push services only.
    expect(await w.vault().vapid.authorization("https://internal.example/push")).toMatchObject({ ok: false, code: "PUSH_ENDPOINT_POLICY" });
    const ok = await w.vault().vapid.authorization(b.subscription.endpoint);
    expect(ok.ok && (await checkVapid(ok.header, b.subscription.endpoint, w.clock.now))).toBeNull();
  });

  it("the VAPID key pair is created once, sealed, and its private half is never stored or returned in the clear", async () => {
    const w = deliveryWorld();
    const first = await w.vault().vapid.publicKey();
    const second = await w.vault().vapid.publicKey();
    expect(first).toEqual(second);
    const rows = w.vaultDb.prepare("SELECT * FROM vapid_key").all() as Array<{ public: string; ct: Uint8Array }>;
    expect(rows).toHaveLength(1);
    // PKCS#8 for P-256 starts with this DER prefix; the stored blob is ciphertext, so it does not.
    const der = Uint8Array.from([0x30, 0x81, 0x87, 0x02, 0x01, 0x00]);
    expect(Buffer.from(rows[0]!.ct).includes(Buffer.from(der))).toBe(false);
    // A fresh instance over the same storage opens the same key and signs verifiably.
    const b = await w.push.browser();
    const auth = await w.vault().vapid.authorization(b.subscription.endpoint);
    expect(auth.ok && auth.header.endsWith(`k=${rows[0]!.public}`)).toBe(true);
    // A Vault that cannot unwrap its key signs nothing, and the item says so rather than claiming a push.
    const locked = deliveryWorld({ vaultLocked: true });
    const chat = locked.openChat(ada.email);
    await locked.http(ada.email, "POST", "/push/subscribe", { subscription: (await locked.push.browser()).subscription });
    await locked.http(ada.email, "POST", "/delivery/preferences", { mail: false });
    expect(await locked.deliver(ada.email, job("hn-watch:notice:0007", chat))).toMatchObject({ channels: ["chat"], code: "VAULT_LOCKED" });
    expect(locked.push.received).toEqual([]);
    expect(await (await locked.http(ada.email, "GET", "/push/key")).json()).toEqual({ code: "VAULT_LOCKED" });
  });

  it("subscription writes come from the app's own page, and an oversized payload is refused before encryption", async () => {
    const w = deliveryWorld();
    const b = await w.push.browser();
    expect((await w.http(ada.email, "POST", "/push/subscribe", { subscription: b.subscription }, "https://evil.example")).status).toBe(403);
    expect((await w.http(ada.email, "POST", "/push/subscribe", { subscription: b.subscription }, null)).status).toBe(403);
    expect(w.personDb(ada.email).prepare("SELECT name FROM sqlite_master WHERE name = 'push_subscriptions'").all()).toEqual([]);
    // One record of at most 4096 bytes on the wire: 86 bytes of header, the payload, its delimiter and the tag.
    expect(PAYLOAD_MAX).toBe(4096 - 86 - 1 - 16);
    const sub = { endpoint: b.subscription.endpoint, ...b.subscription.keys };
    expect(await encryptPayload(sub, new Uint8Array(PAYLOAD_MAX + 1))).toMatchObject({ ok: false, code: "PUSH_PAYLOAD_TOO_LARGE" });
    const fits = await encryptPayload(sub, new Uint8Array(PAYLOAD_MAX));
    expect(fits.ok && fits.body.length).toBe(4096);
    expect(new URL(HOST).protocol).toBe("https:");
  });
});
