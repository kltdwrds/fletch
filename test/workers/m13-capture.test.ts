// M13: the secure capture form and the one-time-code flow. The form posts to the tenant's own host as
// the signed-in person and never sends the value back, whatever happens; a one-time code in a person's
// mail becomes a ten-minute credential the chat sees only by reference, typed only into the
// verification-code field under the person's fresh one-shot approval.
import { describe, expect, it } from "vitest";
import type { ParsedMail } from "../../packages/agent/src/mail/mime.ts";
import { PersonMail } from "../../packages/agent/src/person/mail.ts";
import { findOneTimeCodes, OTP_FIELD } from "../../packages/agent/src/vault/otp.ts";
import { ObjectHarness } from "../support/object-harness.ts";
import { ada, SHOP_API, SHOP_LOGIN, seedShop, vaultWorld } from "./support/vault-world.ts";

describe("[M13] capture form", () => {
  it("the capture form never echoes the value: the form, a save, a refusal, a value in the wrong field, and the settings list", async () => {
    const w = vaultWorld();
    const form = { ref: "cred://shop-api", label: "Shop API", host: SHOP_API, methods: "GET", header: "authorization", prefix: "Bearer ", permission: "standing", kind: "secret", value: w.token };
    const blank = await w.http(ada.email, "GET", `/vault/capture?ref=cred://shop-api&host=${SHOP_API}&value=${w.token}`);
    expect(blank.status).toBe(200);
    expect(blank.text).toContain('type="password"');
    expect(blank.text).not.toContain(w.token);
    const saved = await w.http(ada.email, "POST", "/vault/capture", { form });
    expect(saved.status).toBe(201);
    expect(saved.text).toContain("Saved <code>cred://shop-api</code>");
    const refused = await w.http(ada.email, "POST", "/vault/capture", { form: { ...form, ref: "cred://shop-two", host: "10.0.0.9" } });
    expect(refused.status).toBe(400);
    expect(refused.text).toContain("VAULT_HOST_IP_LITERAL");
    // Typed into the description and the host by mistake: those fields are shown back, the value is not.
    const misplaced = await w.http(ada.email, "POST", "/vault/capture", { form: { ...form, ref: "cred://shop-three", label: `key ${w.token}`, host: w.token } });
    expect(misplaced.status).toBe(400);
    const listed = await w.http(ada.email, "GET", "/vault");
    expect(JSON.parse(listed.text)).toMatchObject({ credentials: [{ ref: "cred://shop-api", label: "Shop API", status: "active", hosts: [{ host: SHOP_API }] }] });
    for (const [what, r] of Object.entries({ blank, saved, refused, misplaced, listed })) {
      expect({ what, echoed: r.text.includes(w.token) }).toEqual({ what, echoed: false });
      expect({ what, cache: r.headers.get("cache-control") }).toEqual({ what, cache: "no-store" });
    }
    expect(saved.headers.get("content-security-policy")).toContain("form-action 'self'");
    // The value it took is the one sealed: it resolves at egress for Ada, in its header.
    expect(await w.egress(ada.email, `https://${SHOP_API}/orders`, "cred://shop-api")).toMatchObject({ ok: true });
    expect(w.requests.map((r) => r.authorization)).toEqual([`Bearer ${w.token}`]);
    expect(w.vault().events(ada.email)).toMatchObject([{ event: "captured", by: ada.email, detail: `capture-form; ${SHOP_API}` }]);
  });

  it("the redaction is the guard: the same misplaced post, rendered without it, shows the value", async () => {
    const { captureForm } = await import("../../packages/agent/src/http/vault-routes.ts");
    const w = vaultWorld();
    const html = captureForm({ ref: "cred://x", label: `key ${w.token}`, host: "", methods: "GET", header: "authorization", prefix: "", fills: false, permission: "standing", kind: "secret" }, { code: "VAULT_HOST_INVALID", reason: "a host is a DNS name" });
    expect(html).toContain(w.token);
  });
});

/** Ada's mail store with her real Vault keeping the codes, and the notices her mail chat received. */
function mailWorld(w: ReturnType<typeof vaultWorld>, hold: "vault" | "failing" = "vault") {
  const notices: Array<{ id: string; text: string }> = [];
  const h = new ObjectHarness(`mail-${ada.id}`, (ctx) =>
    new PersonMail((ctx as DurableObjectState).storage, {
      person: ada.email,
      now: () => w.clock.now,
      openChat: async () => ({ ok: true, chatId: "chat-mail" }),
      ownsChat: (c) => c === "chat-mail",
      notify: async (_chat, n) => {
        notices.push(n);
        return { ok: true, duplicate: false };
      },
      mailOut: { send: async () => ({ ok: false, code: "MAIL_OUT_UNUSED", reason: "not in this test" }) },
      holdCode: hold === "vault" ? (code, source) => w.vault().captureOneTimeCode({ person: ada.email, code, source }) : async () => ({ ok: false, code: "VAULT_LOCKED", reason: "the key is unavailable" }),
    }), {});
  const receive = (text: string, subject = "Your sign-in code") =>
    h.instance.receive({ kind: "person", from: "sam@solo-sam.example", digest: `d-${notices.length}-${text.length}`, message: { from: "Sam Solo <sam@solo-sam.example>", subject, text } as ParsedMail });
  return { notices, receive };
}

const refIn = (text: string) => text.match(/\[credential:(cred:\/\/otp-[0-9a-f]{16})\]/)?.[1] as string;

describe("[M13] one-time codes", () => {
  it("a code in mail reaches the chat only as a reference, and is typed once, into the code field, after the person's approval", async () => {
    const w = vaultWorld();
    await seedShop(w);
    const mail = mailWorld(w);
    expect(await mail.receive("Hello Ada,\nYour verification code is 482913.\nIt expires in 10 minutes.\nOrder 2026 ships Friday.")).toMatchObject({ ok: true });
    const text = mail.notices[0]!.text;
    const ref = refIn(text);
    expect(ref).toBeDefined();
    expect(text).not.toContain("482913");
    expect(text).toContain("Order 2026 ships Friday.");
    expect(text).toContain("kept for ten minutes");
    // Before the person approves, nothing types it.
    expect(await w.fill(ada.email, ref, SHOP_LOGIN, OTP_FIELD)).toMatchObject({ ok: false, code: "EGRESS_GRANT_REQUIRED" });
    expect(await w.http(ada.email, "POST", "/vault/otp/approve", { json: { ref, host: SHOP_LOGIN } })).toMatchObject({ status: 201 });
    expect(await w.fill(ada.email, ref, SHOP_LOGIN)).toMatchObject({ ok: false, code: "EGRESS_FILL_FIELD" });
    expect(await w.fill(ada.email, ref, SHOP_LOGIN, OTP_FIELD)).toEqual({ ok: true, host: SHOP_LOGIN });
    expect(await w.fill(ada.email, ref, SHOP_LOGIN, OTP_FIELD)).toMatchObject({ ok: false, code: "EGRESS_GRANT_SPENT" });
    expect(w.typed).toEqual([{ session: "s1", selector: "#field", value: "482913" }]);
    const audit = w.vault().audit();
    expect(audit.map((a) => a.outcome)).toEqual(["EGRESS_GRANT_SPENT", "resolved", "EGRESS_GRANT_REQUIRED"]);
    expect(audit[1]).toMatchObject({ method: "FILL", host: SHOP_LOGIN, grant: expect.stringMatching(/^[0-9a-f]{32}$/) });
    expect(JSON.stringify([audit, w.vault().list(ada.email), w.vault().events(ada.email)])).not.toContain("482913");
  });

  it("a code that cannot be kept is withheld from the chat, never shown", async () => {
    const w = vaultWorld();
    const mail = mailWorld(w, "failing");
    await mail.receive("Your one-time passcode: 551 204");
    expect(mail.notices[0]!.text).toContain("[one-time code withheld]");
    expect(mail.notices[0]!.text).not.toMatch(/551.?204/);
    expect(mail.notices[0]!.text).toContain("1 could not be kept and was withheld");
  });

  it("only lines that name a code lose their numbers", () => {
    expect(findOneTimeCodes("Invoice 48213 is attached.\nTotal 1200.")).toEqual([]);
    expect(findOneTimeCodes("Your code: 482913\nIn 2026 we moved.").map((f) => f.code)).toEqual(["482913"]);
    expect(findOneTimeCodes("Verification code 2026 4417-8820").map((f) => f.code)).toEqual(["44178820"]);
  });
});
