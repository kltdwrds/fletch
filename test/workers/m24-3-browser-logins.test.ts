// M24.3 item 7, browser logins that persist: a live session's `storageState` saved per person per site,
// sealed in the Vault as a `browser-state` credential (the real `VaultCore` sealing under the
// dispatcher's real key service), restored into a fresh session only under the person's own RESTORE
// grant, removed by the person's forget path and by offboarding's departure; and the live lane, over
// the production `browse/binding.ts` and a CDP-level fake binding, restores before its first navigation
// and then navigates on the URL it was spawned for. Ada and Bo of solo-sam throughout.
import { describe, expect, it } from "vitest";
import { browseNamespace } from "../../packages/agent/src/browse/tools.ts";
import { bindingPort, captureState, restoreState } from "../../packages/agent/src/browse/binding.ts";
import { UrlTable } from "../../packages/agent/src/browse/urls.ts";
import { BrowserStateVault, browserRef, RESTORE } from "../../packages/agent/src/vault/browser-state.ts";
import { ObjectHarness } from "../support/object-harness.ts";
import { FakeCdpBrowser } from "./support/fake-cdp-browser.ts";
import { asPerson, keysFor, testMasterKey } from "./support/vault-harness.ts";
import { ada, T0, TENANT } from "./support/authority-world.ts";

const SITE = "login.solo-sam.example";
const OTHER = "shop.tide.example";
const SPAWN = `https://${SITE}/account/orders`;
const SESSION_COOKIE = { name: "session", value: "fixture-session-a1b2", domain: `.${SITE.split(".").slice(1).join(".")}`, path: "/", expires: 1_900_000_000, httpOnly: true, secure: true, sameSite: "Lax" };
const OTHER_COOKIE = { name: "cart", value: "fixture-cart-9", domain: OTHER, path: "/", expires: -1, httpOnly: false, secure: true, sameSite: "Lax" };

function world() {
  const browser = new FakeCdpBrowser();
  const clock = { now: T0 };
  const h = new ObjectHarness("vault-solo-sam", (ctx) => new BrowserStateVault(ctx as never, {
    tenant: TENANT, keys: keysFor(TENANT, testMasterKey()), fetch: async () => new Response(""), now: () => clock.now,
    browserState: { capture: (s) => captureState(browser.binding, s), restore: (s, state) => restoreState(browser.binding, s, state) },
  }), {});
  const v = () => h.instance;
  /** Ada signed in on the live page of a session: what saving reads. */
  const signedIn = async () => {
    const { sessionId } = await browser.binding.acquire();
    browser.seed(sessionId, `https://${SITE}/home`, [SESSION_COOKIE, OTHER_COOKIE], { theme: "dark" });
    return sessionId;
  };
  const grant = (person: string, ref: string) => v().issueGrant({ ref, hosts: [SITE], methods: [RESTORE] }, asPerson(person));
  return { browser, clock, h, v, signedIn, grant };
}

describe("[M24.3] saved browser logins", () => {
  it("round trip: saved for one site and sealed, then restored into a fresh session only under Ada's grant, and the restored cookies are the saved ones", async () => {
    const w = world();
    const s1 = await w.signedIn();
    const saved = await w.v().saveBrowserState({ session: s1, url: `https://${SITE}/home` }, { person: ada.email });
    const ref = await browserRef(SITE);
    expect(saved).toEqual({ ok: true, site: SITE, ref, cookies: 1, origins: 1 });
    // Sealed: the row holds ciphertext, and no stored byte carries the cookie's value.
    const row = w.h.rows("SELECT owner, kind, permission, ct FROM secrets")[0];
    expect(row).toMatchObject({ owner: ada.email, kind: "browser-state", permission: "grant" });
    expect(new TextDecoder().decode(row?.ct as Uint8Array)).not.toContain(SESSION_COOKIE.value);
    expect(JSON.stringify(w.h.rows("SELECT * FROM vault_events"))).not.toContain(SESSION_COOKIE.value);
    expect(w.v().list(ada.email)).toMatchObject([{ ref, label: `browser login for ${SITE}`, kind: "browser-state", status: "active" }]);

    // A fresh session, no grant: refused with a code, and nothing reaches the browser.
    const { sessionId: s2 } = await w.browser.binding.acquire();
    expect(await w.v().restoreBrowserState({ session: s2, url: SPAWN }, { person: ada.email })).toMatchObject({ ok: false, code: "EGRESS_GRANT_REQUIRED" });
    expect(w.browser.methods(s2)).toEqual([]);

    // Ada's grant, from settings: a RESTORE on that site, signed as every credential grant is.
    expect(await w.grant(ada.email, ref)).toMatchObject({ ok: true, grant: { ref, hosts: [SITE], methods: [RESTORE], fill: false } });
    const restored = await w.v().restoreBrowserState({ session: s2, url: SPAWN }, { person: ada.email });
    expect(restored).toMatchObject({ ok: true, restored: true, site: SITE, ref, cookies: 1 });
    const jar = w.browser.sessions.get(s2)?.cookies;
    expect(jar).toEqual([SESSION_COOKIE]);
    expect([...(w.browser.sessions.get(s2)?.storage.get(`https://${SITE}`) ?? new Map()).entries()]).toEqual([["theme", "dark"]]);
    // The other site's cookie in the same session was never kept.
    expect(JSON.stringify(jar)).not.toContain(OTHER_COOKIE.value);
  });

  it("a saved login never leaves as a request credential or a fill, and no one can write a browser- reference", async () => {
    const w = world();
    const s1 = await w.signedIn();
    await w.v().saveBrowserState({ session: s1, url: `https://${SITE}/home` }, { person: ada.email });
    const ref = await browserRef(SITE);
    await w.grant(ada.email, ref);
    const sent = await w.v().egress({ url: `https://${SITE}/api/me`, method: "GET", credential: ref } as never, { person: ada.email, purpose: "test" });
    expect(sent).toMatchObject({ ok: false });
    expect(JSON.stringify(sent)).not.toContain(SESSION_COOKIE.value);
    // Its grant is a RESTORE alone: an HTTP method or a fill on it is refused at issue.
    expect(await w.v().issueGrant({ ref, hosts: [SITE], methods: ["GET"] }, asPerson(ada.email))).toMatchObject({ ok: false, code: "VAULT_GRANT_INVALID" });
    expect(await w.v().issueGrant({ ref, hosts: [OTHER], methods: [RESTORE] }, asPerson(ada.email))).toMatchObject({ ok: false, code: "VAULT_GRANT_INVALID" });
    expect(await w.v().capture({ ref: "cred://browser-0011223344556677", value: "x", hosts: [SITE] }, asPerson(ada.email))).toMatchObject({ ok: false, code: "VAULT_REF_INVALID" });
  });
});

describe("[M24.3] the live lane on a fresh session", () => {
  async function lane(o: { grant: boolean; logins?: boolean }) {
    const w = world();
    const s1 = await w.signedIn();
    await w.v().saveBrowserState({ session: s1, url: `https://${SITE}/home` }, { person: ada.email });
    if (o.grant) await w.grant(ada.email, await browserRef(SITE));
    const cell = { v: null as string | null };
    const urls = new UrlTable({ get: () => cell.v, set: (x) => { cell.v = x; } });
    urls.add([SPAWN]);
    const session = { id: null as string | null };
    const ns = browseNamespace({
      port: bindingPort(w.browser.binding),
      memory: { get: async () => null, record: async () => {} },
      urls,
      session: { get: () => session.id, set: (x) => { session.id = x; } },
      ...(o.logins === false ? {} : { logins: { save: (req) => w.v().saveBrowserState(req, { person: ada.email }), restore: (req) => w.v().restoreBrowserState(req, { person: ada.email }) } }),
      now: () => w.clock.now,
    });
    const live = ns.tools.find((t) => t.name === "browse_live");
    if (!live) throw new Error("no browse_live tool");
    const out = await live.execute("c1", { url: SPAWN } as never, undefined as never, undefined as never);
    return { w, out: (out.content[0] as { text: string }).text, session: session.id as string };
  }

  it("restores the saved login after acquire and before the first navigation, then navigates on the URL it was spawned for", async () => {
    const { w, out, session } = await lane({ grant: true });
    const calls = w.browser.calls.filter((c) => c.session === session);
    const navigate = calls.findIndex((c) => c.method === "Page.navigate");
    const restore = calls.findIndex((c) => c.method === "Storage.setCookies");
    expect(restore).toBeGreaterThanOrEqual(0);
    expect(navigate).toBeGreaterThan(restore);
    expect(calls.filter((c) => c.method === "Page.navigate").map((c) => c.params.url)).toEqual([SPAWN]);
    expect(calls[restore]?.params).toEqual({ cookies: [SESSION_COOKIE] });
    // The page it read is the spawn URL's, signed in.
    expect(out).toContain(`${SPAWN} (live session; title: Account;`);
    expect(out).toContain(`Signed in with the login kept for ${SITE}.`);
  });

  it("without the grant it says so and still navigates on the spawn URL, signed out", async () => {
    const { w, out, session } = await lane({ grant: false });
    expect(w.browser.methods(session)).not.toContain("Storage.setCookies");
    expect(w.browser.calls.filter((c) => c.session === session && c.method === "Page.navigate").map((c) => c.params.url)).toEqual([SPAWN]);
    expect(out).toContain("LOGIN_NOT_RESTORED (EGRESS_GRANT_REQUIRED)");
    expect(out).toContain("title: Sign in;");
  });

  it("a lane that skips the restore opens the spawn URL signed out, which the restored case is not", async () => {
    const { out } = await lane({ grant: true, logins: false });
    expect(out).toContain(`${SPAWN} (live session; title: Sign in;`);
  });
});
