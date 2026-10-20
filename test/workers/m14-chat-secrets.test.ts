// M14.2 (Q24): a secret the person types in chat is held in the Vault as a one-shot reference before the
// turn is stored, so the transcript, the model, logs and memory see only the reference; and an
// allow-once card on a fill naming a credential mints a matching one-shot credential grant, which a
// second use refuses. Run in the two-member browse world: the real gate, grants, journal, chats,
// memory and files, and the real `VaultCore`, with the hold and the mint wired as the objects wire them.
import { afterEach, describe, expect, it, vi } from "vitest";
import { findTypedSecrets, holdTypedSecrets } from "../../packages/agent/src/vault/typed.ts";
import type { FakeRequest, FakeStep } from "../support/fake-model.ts";
import { ada } from "./support/authority-world.ts";
import { browseWorld, FILL_ENTRY, LOGIN_HOST, sinks } from "./support/browse-world.ts";
import { asPerson } from "./support/vault-harness.ts";

const SECRET = "Zebra-Quartz-7781";
const load: FakeStep = { toolCall: { name: "tool_search", arguments: { load: ["browse"] } } };
const login = { [LOGIN_HOST]: { page: { title: "Sign in", text: "Username and password." }, echoTyped: true } };
const TYPED = /cred:\/\/typed-[0-9a-f]{16}/;
/** The reference the model was shown, read from the request it answers. */
const refShown = (r: FakeRequest) => JSON.stringify(r.inputs.messages).match(TYPED)?.[0] ?? "cred://typed-missing";
/** A copying model: it writes the person's last message into their daily memory, as it was shown. */
const copyToMemory: FakeStep = {
  fromRequest: (r) => {
    const user = [...r.inputs.messages].reverse().find((m) => m.role === "user");
    return { toolCall: { id: "c1", name: "memory_write", arguments: { target: "daily", text: `Ada said: ${typeof user?.content === "string" ? user.content : JSON.stringify(user?.content)}` } } };
  },
};

/** Every console line a test produced, as text. */
function captureLogs() {
  const lines: string[] = [];
  for (const level of ["log", "info", "warn", "error", "debug"] as const) vi.spyOn(console, level).mockImplementation((...a: unknown[]) => void lines.push(a.map(String).join(" ")));
  return lines;
}
afterEach(() => vi.restoreAllMocks());

/** Everything the person's stores hold, as text: the Person's SQLite and every R2 object. */
function stores(w: Awaited<ReturnType<typeof browseWorld>>, person: string): string {
  const h = w.personHarness(person);
  const tables = h ? h.rows("SELECT name FROM sqlite_master WHERE type = 'table'").map((r) => String(r.name)) : [];
  const rows = h ? JSON.stringify(tables.flatMap((t) => h.rows(`SELECT * FROM "${t}"`))) : "";
  return rows + JSON.stringify([...w.r2.objects.entries()]);
}

describe("[M14.2] chat secrets", () => {
  it("finds credential-shaped and labeled values, and leaves plain words and references alone", () => {
    const text = `my password is ${SECRET}, the token is ghp_${"a1".repeat(18)}, pin: 4821, the token is ready, see [credential:cred://typed-0123456789abcdef].`;
    expect(findTypedSecrets(text).map((f) => text.slice(f.start, f.end))).toEqual([SECRET, `ghp_${"a1".repeat(18)}`, "4821"]);
  });

  it("a secret typed in chat never reaches the transcript, logs or memory and is used once", async () => {
    const logs = captureLogs();
    const w = await browseWorld({
      sites: login,
      stores: true,
      script: [
        copyToMemory,
        load,
        { toolCall: { id: "p1", name: "browse_live", arguments: { url: `https://${LOGIN_HOST}/` } } },
        { fromRequest: (r) => ({ toolCall: { id: "p2", name: "browse_fill", arguments: { selector: "#password", credential: refShown(r), site: LOGIN_HOST } } }) },
        { fromRequest: (r) => ({ toolCall: { id: "p3", name: "browse_fill", arguments: { selector: "#password", credential: refShown(r), site: LOGIN_HOST } } }) },
        { text: "Asked again." },
      ],
    });
    const { chatId } = await w.say(ada.email, `My shop password is ${SECRET}, please sign me in at https://${LOGIN_HOST}/`);
    // The message was stored with the reference; the Vault holds the value as Ada's typed credential.
    const stored = w.transcriptOf(ada.email).join("\n");
    const ref = stored.match(TYPED)?.[0] as string;
    expect(ref).toBeDefined();
    expect(stored).toContain(`[credential:${ref}]`);
    expect(w.vault.instance.list(ada.email).find((c) => c.ref === ref)).toMatchObject({ kind: "typed", permission: "grant", status: "active", hosts: [] });
    // Nothing typed yet: the fill waits on Ada's card, which shows the site and the reference.
    expect(w.browser.typed).toEqual([]);
    const card = w.cardsOf(ada.email).find((c) => c.id === "p2");
    expect(card).toMatchObject({ state: "pending", proposed: { credential: ref, site: LOGIN_HOST } });
    // Ada allows it once: the commit mints a one-shot fill grant for that site, and the value is typed once.
    const decided = await w.http(ada.email, "POST", `/chats/${chatId}/cards/decide`, { ids: ["p2"], choice: "once" });
    expect(decided).toMatchObject({ status: 200, body: { results: [{ ok: true, state: "approved", outcome: "DONE" }] } });
    expect(w.browser.typed).toEqual([{ session: "sess-1", selector: "#password", value: SECRET }]);
    expect(w.vault.instance.grants(ada.email)).toMatchObject([{ ref, hosts: [LOGIN_HOST], fill: true, oneShot: true, usedAt: expect.any(Number) }]);
    expect(w.vault.instance.list(ada.email).find((c) => c.ref === ref)?.status).toBe("spent");
    // Used once: straight at the Vault again it is refused, and a new card's grant cannot be minted on it.
    expect(await w.vault.instance.fill({ session: "sess-1", url: `https://${LOGIN_HOST}/`, selector: "#password", ref }, { person: ada.email, purpose: "browse_fill" })).toMatchObject({ ok: false, code: "EGRESS_CRED_SPENT" });
    expect(await w.vault.instance.grantForAction({ person: ada.email, ref, site: LOGIN_HOST, card: "g_planted" })).toMatchObject({ ok: false, code: "VAULT_CRED_INACTIVE" });
    // The model asks again through the gate: a fresh card, and allowed once more it fails with the code, typing nothing.
    await w.say(ada.email, "Try that once more.", chatId);
    expect(w.cardsOf(ada.email).find((c) => c.id === "p3")?.state).toBe("pending");
    expect(await w.http(ada.email, "POST", `/chats/${chatId}/cards/decide`, { ids: ["p3"], choice: "once" })).toMatchObject({ body: { results: [{ ok: true, state: "failed", outcome: "VAULT_CRED_INACTIVE" }] } });
    expect(w.browser.typed).toHaveLength(1);
    // The copying model wrote what it was shown into memory: the reference, never the value.
    expect(stores(w, ada.email)).toContain(`[credential:${ref}]`);
    for (const [sink, text] of Object.entries({ ...(await sinks(w)), memory: stores(w, ada.email), logs: logs.join("\n"), vault: JSON.stringify([w.vault.instance.audit(), w.vault.instance.events(ada.email), w.vault.instance.list(ada.email)]) })) {
      expect({ sink, leaked: text.includes(SECRET) }).toEqual({ sink, leaked: false });
    }
  });

  it("plant the guard: without the hold, the typed value is stored in the transcript and shown to the model", async () => {
    const w = await browseWorld({ sites: login, script: [{ text: "Noted." }, { text: "Noted." }] });
    // The same world's chats with the hook removed, as a chat built without it would run.
    const unheld = await holdTypedSecrets(`My shop password is ${SECRET}`, async () => ({ ok: true, ref: "cred://typed-0000000000000000" }));
    expect(unheld).toMatchObject({ ok: true, text: "My shop password is [credential:cred://typed-0000000000000000]" });
    const { chatId } = await w.say(ada.email, "hello");
    const engine = w.chats.harness(chatId).instance as unknown as { hooks: { secrets?: unknown } };
    delete engine.hooks.secrets;
    await w.say(ada.email, `My shop password is ${SECRET}`, chatId);
    expect(w.transcriptOf(ada.email).join("\n")).toContain(SECRET);
    expect(JSON.stringify(w.fake.requests.at(-1)?.inputs.messages)).toContain(SECRET);
  });

  it("a value that cannot be held is not stored at all: the message is refused with its code", async () => {
    const w = await browseWorld({ sites: login, script: [{ text: "unused" }] });
    const { chatId } = await w.say(ada.email, "hello");
    const engine = w.chats.harness(chatId).instance as unknown as { hooks: { secrets?: (p: string, t: string) => Promise<unknown> } };
    engine.hooks.secrets = (_p, t) => holdTypedSecrets(t, async () => ({ ok: false, code: "VAULT_LOCKED" }));
    const before = w.transcriptOf(ada.email).length;
    const r = await w.chats.harness(chatId).instance.send({ person: ada.email, text: `pin: 4821-${SECRET}` });
    expect(r).toEqual({ status: "refused", code: "SECRET_NOT_HELD" });
    expect(w.transcriptOf(ada.email)).toHaveLength(before);
    expect(JSON.stringify(w.fake.requests)).not.toContain(SECRET);
  });
});

describe("[M14.2] card credential grants", () => {
  const SHOP_LOGIN = "cred://shop-login";
  const script: FakeStep[] = [
    load,
    { toolCall: { id: "p1", name: "browse_live", arguments: { url: `https://${LOGIN_HOST}/` } } },
    { toolCall: { id: "p2", name: "browse_fill", arguments: { selector: "#password", credential: SHOP_LOGIN } } },
    { toolCall: { id: "p3", name: "browse_fill", arguments: { selector: "#password", credential: SHOP_LOGIN } } },
    { text: "Asked again." },
  ];
  /** Ada's login that resolves only under a credential grant, registered to fill on the login page. */
  async function seeded(o: { noMint?: boolean } = {}) {
    const w = await browseWorld({ sites: login, script, ...o });
    const put = await w.vault.instance.capture({ ref: SHOP_LOGIN, value: `${w.token}-shop`, kind: "login", permission: "grant", hosts: [{ ...FILL_ENTRY }] }, asPerson(ada.email, "capture-form"));
    if (!put.ok) throw new Error(put.code);
    return w;
  }

  it("an allow-once card yields a one-shot credential grant that a second use refuses", async () => {
    const w = await seeded();
    const { chatId } = await w.say(ada.email, `Sign in at https://${LOGIN_HOST}/ with my shop login.`);
    expect(w.vault.instance.grants(ada.email)).toEqual([]);
    expect(await w.http(ada.email, "POST", `/chats/${chatId}/cards/decide`, { ids: ["p2"], choice: "once" })).toMatchObject({ body: { results: [{ ok: true, state: "approved", outcome: "DONE" }] } });
    expect(w.browser.typed).toEqual([{ session: "sess-1", selector: "#password", value: `${w.token}-shop` }]);
    const [grant] = w.vault.instance.grants(ada.email);
    expect(grant).toMatchObject({ ref: SHOP_LOGIN, hosts: [LOGIN_HOST], methods: [], fill: true, oneShot: true, usedAt: expect.any(Number) });
    // The fill's audit row cites that grant's nonce, and the Vault's event names the card's M7 grant.
    expect(w.vault.instance.audit()).toMatchObject([{ ref: SHOP_LOGIN, outcome: "resolved", grant: grant?.nonce }]);
    const m7 = (await w.journal()).find((r) => r.id.endsWith("p2:decision"))?.grantId as string;
    expect(w.vault.instance.events(ada.email)[0]).toMatchObject({ event: "grant-issued", detail: `card ${m7}; ${grant?.nonce}; one-shot` });
    // A second use of the same grant, straight at the Vault, is refused.
    expect(await w.vault.instance.fill({ session: "sess-1", url: `https://${LOGIN_HOST}/`, selector: "#password", ref: SHOP_LOGIN }, { person: ada.email, purpose: "browse_fill" })).toMatchObject({ ok: false, code: "EGRESS_GRANT_SPENT" });
    // A second use through the gate: the once grant is spent too, so it asks again; nothing more is typed.
    await w.say(ada.email, "Again please.", chatId);
    expect(w.cardsOf(ada.email).find((c) => c.id === "p3")?.state).toBe("pending");
    expect(w.browser.typed).toHaveLength(1);
  });

  it("plant the guard: a Person that commits without asking the Vault leaves the allowed fill without a credential grant", async () => {
    const w = await seeded({ noMint: true });
    const { chatId } = await w.say(ada.email, `Sign in at https://${LOGIN_HOST}/ with my shop login.`);
    expect(await w.http(ada.email, "POST", `/chats/${chatId}/cards/decide`, { ids: ["p2"], choice: "once" })).toMatchObject({ body: { results: [{ ok: true, state: "failed", outcome: "EGRESS_GRANT_REQUIRED" }] } });
    expect(w.browser.typed).toEqual([]);
  });
});
