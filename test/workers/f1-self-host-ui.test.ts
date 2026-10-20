// F1: what a self-host owner's app offers. Log out is the host's own `/logout` (a same-origin POST), not the
// platform's Access logout; and the spec's section 4 cut holds in the UI and the route: a standalone deploy has one
// owner, so the Company group (members, invites) and the header's Invite are not drawn, and `/admin/invites`
// refuses with the host's members code and its reason. A company tenant keeps all of it. The page is the shipped
// script in the page harness, its requests answered by the authority world's real routes.
import { describe, expect, it } from "vitest";
import { SETTINGS_TEXT, settingsMarkup } from "../../packages/agent/src/http/app/settings.ts";
import { APP_PAGE } from "../../packages/agent/src/http/page.ts";
import { ada, authorityWorld, TENANT } from "./support/authority-world.ts";
import { page } from "./support/page-harness.ts";

const settle = async () => {
  for (let i = 0; i < 40; i++) await new Promise((r) => setImmediate(r));
};
type World = ReturnType<typeof authorityWorld>;

/** Ada's page on a desktop, her requests answered by the world's routes; `over` answers a path first. */
async function pageOf(w: World, over: Record<string, () => Response> = {}) {
  const sent: Array<{ path: string; method: string }> = [];
  const p = await page(
    {
      onSend() {},
      fetch: async (path, init) => {
        sent.push({ path, method: init?.method ?? "GET" });
        if (over[path]) return over[path]();
        const r = await w.http(ada.email, init?.method ?? "GET", path, init?.body ? JSON.parse(init.body) : undefined);
        return new Response(JSON.stringify(r.body), { status: r.status });
      },
    },
    { desktop: true },
  );
  await settle();
  return { p, sent };
}
const click = async (p: Awaited<ReturnType<typeof pageOf>>["p"], id: string) => {
  await p.byId(id).onclick?.();
  await settle();
};

describe("[F1] Log out", () => {
  it("is a button for the host's /logout, and nothing in the page names the platform's Access logout", () => {
    const dlg = settingsMarkup({ connectors: "", connector: "", permissions: "" });
    expect(dlg).toMatch(/<button id="logout" class="set-logout" type="button">/);
    expect(APP_PAGE).not.toContain("cdn-cgi");
    expect(APP_PAGE).toContain('fetch("/logout", { method: "POST" })');
    expect(APP_PAGE).toContain('location.assign("/login")');
  });

  it("a logout the host refuses says so in words with its code, and the page stays", async () => {
    const w = authorityWorld({ shape: "standalone" });
    const { p, sent } = await pageOf(w, { "/logout": () => Response.json({ ok: false, code: "LOGIN_ORIGIN", reason: "no" }, { status: 403 }) });
    await click(p, "logout");
    expect(sent).toContainEqual({ path: "/logout", method: "POST" });
    expect([p.byId("logout-result").textContent, p.byId("logout-result").dataset.code]).toEqual([SETTINGS_TEXT.logoutFailed, "LOGIN_ORIGIN"]);
  });
});

describe("[F1] members and invites are a company's (spec section 4)", () => {
  it("a standalone deploy draws no Company group and no Invite pill, even for its owner", async () => {
    const w = authorityWorld({ shape: "standalone" });
    expect((await w.http(ada.email, "GET", "/me")).body).toMatchObject({ shape: "standalone", role: "admin" });
    const { p, sent } = await pageOf(w);
    await click(p, "close-sheet");
    expect(p.byId("head-invite").hidden).toBe(true);
    await click(p, "to-settings");
    await click(p, "settings-menu-open");
    expect(p.byId("admin").hidden).toBe(true);
    expect(sent.some((s) => s.path === "/admin/members")).toBe(false);
  });

  it("a company tenant's admin keeps the Company group and Invite", async () => {
    const w = authorityWorld({ shape: "company" });
    const { p, sent } = await pageOf(w);
    await click(p, "close-sheet");
    expect(p.byId("head-invite").hidden).toBe(false);
    await click(p, "to-settings");
    await click(p, "settings-menu-open");
    expect(p.byId("admin").hidden).toBe(false);
    expect(sent.some((s) => s.path === "/admin/members")).toBe(true);
  });

  it("/admin/invites on a standalone deploy refuses HOST_MEMBERS_UNAVAILABLE with the host's reason; a company's invites", async () => {
    const solo = authorityWorld({ shape: "standalone" });
    const refused = await solo.http(ada.email, "POST", "/admin/invites", { email: `pat@${TENANT}.example`, role: "member" });
    expect(refused).toEqual({ status: 501, body: { ok: false, code: "HOST_MEMBERS_UNAVAILABLE", reason: "members is not part of the test host; a test names it on env.HOST" } });
    expect((await solo.company().list()).map((m) => m.email)).toEqual([ada.email]);
    const company = authorityWorld({ shape: "company" });
    expect((await company.http(ada.email, "POST", "/admin/invites", { email: `pat@${TENANT}.example`, role: "member" })).status).toBe(201);
  });
});
