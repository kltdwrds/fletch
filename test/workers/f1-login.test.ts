// F1: the login lives in the Company. Sessions and passkeys are rows of its storage, reached through one RPC method
// (`loginCall`); the host's passkey identity is the one `serve()` asks, so a minted cookie opens the app and a
// request without one is refused. `loginCall` is a Durable Object RPC method: only code holding the namespace binding
// (the host) can call it, and no HTTP route forwards to it.
import { describe, expect, it } from "vitest";
import { passkeyIdentity, SESSION_COOKIE } from "@qyvr/host-cloudflare";
import { serve } from "../../packages/agent/src/http/serve.ts";
import { ada, authorityWorld, TENANT } from "./support/authority-world.ts";

const ORIGIN = `https://${TENANT}.example`;

function login() {
  const w = authorityWorld();
  const company = w.companyHarness().instance;
  const identity = passkeyIdentity({ call: async (c) => company.loginCall(c) as never, owner: ada.email, tenant: TENANT, now: () => w.clock.now });
  const env = { ...w.env, OWNER_EMAIL: ada.email, HOST: { identity } };
  const get = (path: string, cookie?: string) => serve(new Request(`${ORIGIN}${path}`, { headers: cookie ? { cookie: `${SESSION_COOKIE}=${cookie}` } : {} }), env as never, { tenant: TENANT }, { dir: w.dir, now: () => w.clock.now });
  return { w, company, get };
}

describe("[F1] login through the Company", () => {
  it("mints a session and looks it up, on the Company's own storage", async () => {
    const { company } = login();
    const token = await company.loginCall({ op: "mint", email: ada.email, needsPasskey: false });
    expect(await company.loginCall({ op: "lookup", token: token as string })).toEqual({ email: ada.email, needsPasskey: false });
    expect(await company.loginCall({ op: "lookup", token: "nope" })).toBe("unknown");
  });

  it("the f1-passkeys migration is applied", async () => {
    const { w, company } = login();
    expect(w.companyHarness().rows("SELECT name FROM migrations WHERE name = 'f1-passkeys'")).toEqual([{ name: "f1-passkeys" }]);
    expect(await company.migrationProbe()).toMatchObject({ object: "company", behind: [] });
  });

  it("serve(): a minted cookie reaches /app/chats; no cookie is 401 SESSION_MISSING; /login is the public page", async () => {
    const { company, get } = login();
    const token = (await company.loginCall({ op: "mint", email: ada.email, needsPasskey: false })) as string;
    expect((await get("/app/chats", token)).status).toBe(200);
    const none = await get("/app/chats");
    expect(none.status).toBe(401);
    expect(await none.json()).toMatchObject({ code: "SESSION_MISSING" });
    const page = await get("/login");
    expect(page.status).toBe(200);
    expect(page.headers.get("content-type")).toContain("text/html");
  });
});
