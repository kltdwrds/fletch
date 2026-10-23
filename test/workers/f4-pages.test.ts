// F4: the page grammar on the server (D-0009). `serve()` answers the page for a GET on exactly the grammar's paths,
// a browser on any other path under a session the page with a 404 (the shell draws the not-found page), and an API
// caller the JSON code; a path nobody serves is never answered as home (D-0001). The grammar and the route table
// never overlap: no API sub-router claims a page path and no API path is a page. A notification opens a chat's page.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { passkeyIdentity, SESSION_COOKIE } from "@qyvr/host-cloudflare";
import { adminRoutes } from "../../packages/agent/src/http/admin-routes.ts";
import { appRoutes } from "../../packages/agent/src/http/app-routes.ts";
import { authorityRoutes } from "../../packages/agent/src/http/authority-routes.ts";
import { dashboardRoutes } from "../../packages/agent/src/http/dashboard-routes.ts";
import { deliveryRoutes } from "../../packages/agent/src/http/delivery-routes.ts";
import { pushRoutes } from "../../packages/agent/src/http/ingress-routes.ts";
import { lifecycleRoutes } from "../../packages/agent/src/http/lifecycle-routes.ts";
import { APP_PAGE } from "../../packages/agent/src/http/page.ts";
import { chatPath, PAGES, pageOf } from "../../packages/agent/src/http/pages.ts";
import type { Directory } from "../../packages/agent/src/http/routes.ts";
import { serve } from "../../packages/agent/src/http/serve.ts";
import { vaultRoutes } from "../../packages/agent/src/http/vault-routes.ts";
import { ada, authorityWorld, person, TENANT } from "./support/authority-world.ts";
import { deliveryWorld, ada as deliveryAda } from "./support/delivery-world.ts";

const pat = person("pat-solo");
const ORIGIN = `https://${TENANT}.example`;
const HTML = { accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" };
const JSON_ONLY = { accept: "application/json" };

/** Sam's and Pat's sessions on one world, and a `serve()` call as either, as `f1-login` makes it. */
async function signedIn() {
  const w = authorityWorld({ seed: [ada, pat] });
  const company = w.companyHarness().instance;
  const identity = passkeyIdentity({ call: async (c) => company.loginCall(c) as never, owner: ada.email, tenant: TENANT, now: () => w.clock.now });
  const env = { ...w.env, OWNER_EMAIL: ada.email, HOST: { identity } };
  const mint = async (email: string) => (await company.loginCall({ op: "mint", email, needsPasskey: false })) as string;
  const sessions = { sam: await mint(ada.email), pat: await mint(pat.email) };
  const get = (p: string, cookie: string | undefined, headers: Record<string, string> = {}, method = "GET") =>
    serve(new Request(`${ORIGIN}${p}`, { method, headers: { ...headers, ...(cookie ? { cookie: `${SESSION_COOKIE}=${cookie}` } : {}) } }), env as never, { tenant: TENANT }, { dir: w.dir, now: () => w.clock.now });
  return { w, sessions, get };
}

/** Every route source under `http/`, whose path tests are the route table. */
const HTTP = path.resolve(import.meta.dirname, "../../packages/agent/src/http");
const routeSources = () => readdirSync(HTTP).filter((f) => /(^routes|-routes|^serve)\.ts$/.test(f)).map((f) => readFileSync(path.join(HTTP, f), "utf8"));

describe("[F4] the page grammar on the server", () => {
  it("a GET on each grammar path with a session answers the page with 200 and text/html, for Sam and for Pat", async () => {
    const { sessions, get } = await signedIn();
    for (const cookie of [sessions.sam, sessions.pat]) {
      for (const row of PAGES) {
        // A page is the page whatever the caller accepts: no API answers on its path.
        for (const headers of [HTML, JSON_ONLY]) {
          const r = await get(row.example, cookie, headers);
          expect([row.name, r.status, r.headers.get("content-type")]).toEqual([row.name, 200, "text/html; charset=utf-8"]);
          expect(await r.text()).toBe(APP_PAGE);
        }
      }
    }
  });

  it("a browser GET on a path that is no page answers the page with 404, an API GET the JSON code; never 200 and never a redirect home", async () => {
    const { sessions, get } = await signedIn();
    const id = "6f1c2a4e-8b3d-4c5e-9f70-1a2b3c4d5e6f";
    for (const p of ["/nowhere", "/library/", `/chats/${id}/`, "/chats/not-a-uuid", "/feed/x", "/goals/"]) {
      const page = await get(p, sessions.sam, HTML);
      expect([p, page.status, page.headers.get("location"), page.headers.get("content-type")]).toEqual([p, 404, null, "text/html; charset=utf-8"]);
      expect(await page.text()).toBe(APP_PAGE);
      const api = await get(p, sessions.sam, JSON_ONLY);
      expect([p, api.status, await api.json()]).toEqual([p, 404, { code: "NOT_FOUND" }]);
    }
    // Signed out, a browser on a page path or not is sent to sign in, as before (F7 brings it back after).
    for (const p of ["/chats/" + id, "/nowhere"]) expect((await get(p, undefined, HTML)).headers.get("location")).toBe("/login");
    // `/library/` and `/chats/<id>/` are not pages in the grammar either.
    expect([pageOf("/library/"), pageOf(`/chats/${id}/`), pageOf("/")?.row.name, pageOf(`/chats/${id}`)?.id]).toEqual([null, null, "home", id]);
  });

  it("no API sub-router claims a page path, and no API path in the route table is a page", async () => {
    const { w } = await signedIn();
    const dir = w.dir as Directory;
    const routers: Array<[string, (r: Request, u: URL) => Promise<Response | null>]> = [
      ["push", (r, u) => pushRoutes(r, u, ada.email, dir.ingress, dir.mail)],
      ["authority", (r, u) => authorityRoutes(r, u, ada.email, dir.authority)],
      ["dashboard", (r, u) => dashboardRoutes(r, u, ada.email, dir.dashboard)],
      ["admin", (r, u) => adminRoutes(r, u, ada.email, dir.admin)],
      ["lifecycle", (r, u) => lifecycleRoutes(r, u, ada.email, dir.lifecycle)],
      ["vault", (r, u) => vaultRoutes(r, u, ada.email, dir.vault)],
      ["delivery", (r, u) => deliveryRoutes(r, u, ada.email, dir.delivery)],
      ["app", (r, u) => appRoutes(r, u, ada.email, dir.app)],
    ];
    for (const row of PAGES) {
      for (const method of ["GET", "POST", "PUT", "DELETE"]) {
        for (const [name, run] of routers) {
          const url = new URL(row.example, ORIGIN);
          const claimed = await run(new Request(url, { method, headers: { origin: ORIGIN, ...JSON_ONLY } }), url);
          expect([row.name, method, name, claimed?.status ?? null]).toEqual([row.name, method, name, null]);
        }
      }
    }
    // The table itself: every literal path a route compares with, and every pattern a route matches, read from the
    // route sources. None is a page, and no route pattern matches a grammar row's example.
    const sources = routeSources().join("\n");
    const literals = [...sources.matchAll(/pathname(?: === |\.startsWith\()"(\/[^"]*)"/g)].map((m) => m[1] as string);
    const patterns = [...sources.matchAll(/pathname\.match\((\/\^\\\/.*?\$\/)\)/g), ...sources.matchAll(/= (\/\^\\\/[^;]*?\$\/);/g)].map((m) => new Function(`return ${m[1]}`)() as RegExp);
    expect(literals).toEqual(expect.arrayContaining(["/app/chats", "/me", "/sw.js", "/admin", "/vault"]));
    expect(patterns.map((p) => p.source)).toEqual(expect.arrayContaining(["^\\/chats\\/([^/]+)\\/ws$", "^\\/hooks\\/([^/]+)$"]));
    for (const l of literals) expect([l, pageOf(l)]).toEqual([l, null]);
    for (const p of patterns) for (const row of PAGES) expect([p.source, row.example, p.test(row.example)]).toEqual([p.source, row.example, false]);
    // A chat's sub-paths are the API's, never its page.
    const id = "6f1c2a4e-8b3d-4c5e-9f70-1a2b3c4d5e6f";
    for (const api of [`/chats/${id}/ws`, `/chats/${id}/cards`, `/chats/${id}/compact`, "/chats", "/app/library", "/app/search"]) expect([api, pageOf(api)]).toEqual([api, null]);
  });

  it("a notification's address is the chat's page, /chats/<id>", async () => {
    const w = deliveryWorld();
    const chat = w.openChat(deliveryAda.email);
    const browser = await w.push.browser();
    expect((await w.http(deliveryAda.email, "POST", "/push/subscribe", { subscription: browser.subscription })).status).toBe(200);
    const r = await w.deliver(deliveryAda.email, { id: "f4:notice:1", kind: "requested", category: "job:f4", chat, source: "job:f4", text: "Done." });
    expect(r).toMatchObject({ ok: true, channels: ["chat", "push"] });
    expect(w.push.received).toHaveLength(1);
    const url = (w.push.received[0]?.payload as { url?: string } | undefined)?.url;
    expect(url).toBe(`/chats/${chat}`);
    expect(url).toBe(chatPath(chat));
    // A real chat id is a uuid, and its address is a page of the grammar.
    const uuid = "6f1c2a4e-8b3d-4c5e-9f70-1a2b3c4d5e6f";
    expect(pageOf(chatPath(uuid))).toMatchObject({ row: { name: "chat" }, id: uuid });
  });
});
