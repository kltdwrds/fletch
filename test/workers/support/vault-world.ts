// A tenant's real `VaultCore` for M13 (solo-sam, two members): the dispatcher's real key service, a
// recording vendor that echoes the authorization header it was sent, a recording browser injector,
// one clock, and the app's routes over a `Directory` whose vault is this core, so the capture form and
// settings are driven as a signed-in person's requests.
import { route, type Directory } from "../../../packages/agent/src/http/routes.ts";
import type { VaultDirectory } from "../../../packages/agent/src/http/vault-routes.ts";
import { VaultCore } from "../../../packages/agent/src/vault/core.ts";
import { ObjectHarness } from "../../support/object-harness.ts";
import { seededToken } from "../../support/vendors/index.ts";
import people from "../../fixtures/people.json" with { type: "json" };
import { keysFor, testMasterKey } from "./vault-harness.ts";

export const ada = people.people.find((p) => p.id === "sam-solo")!;
export const TENANT = ada.company;
export const T0 = Date.UTC(2026, 9, 13, 12, 0);
export const SHOP_API = "api.shop.example";
export const SHOP_LOGIN = "login.shop.example";

export function vaultWorld(name = "vault-m13") {
  const clock = { now: T0 };
  const requests: Array<{ url: string; method: string; authorization: string | null; redirect: string | undefined }> = [];
  const typed: Array<{ session: string; selector: string; value: string }> = [];
  const harness = new ObjectHarness(
    name,
    (ctx) =>
      new VaultCore(ctx as never, {
        tenant: TENANT,
        keys: keysFor(TENANT, testMasterKey()),
        fetch: async (url, init) => {
          const authorization = new Headers(init.headers).get("authorization");
          requests.push({ url, method: String(init.method ?? "GET"), authorization, redirect: init.redirect });
          // A hostile vendor: it echoes the credential it was sent.
          return new Response(JSON.stringify({ ok: true, echo: authorization }), { headers: { "content-type": "application/json" } });
        },
        now: () => clock.now,
        inject: async (session, selector, value) => void typed.push({ session, selector, value }),
      }),
    {},
  );
  const vault = () => harness.instance;
  const dir: VaultDirectory = {
    capture: async (i, w) => vault().capture(i, w),
    registerHost: async (i, w) => vault().registerHost(i, w),
    removeHost: async (r, h, w) => vault().removeHost(r, h, w),
    revoke: async (r, w) => vault().revoke(r, w),
    issueGrant: async (i, w) => vault().issueGrant(i, w),
    revokeGrant: async (n, w) => vault().revokeGrant(n, w),
    approveOneTimeCode: async (i, w) => vault().approveOneTimeCode(i, w),
    list: async (p) => vault().list(p),
    grants: async (p) => vault().grants(p),
    // This world has no `Person`, so no authority grant names a credential (F36's disconnect reads none here).
    revokeNaming: async () => ({ ok: true, revoked: [] }),
    dismissCapture: async (r, w, s) => vault().dismissCapture(r, w, s),
    captureState: async (p, r, s) => vault().captureState(p, r, s),
  };
  const origin = `https://${TENANT}.example`;
  /** One request to the agent script as `as`; `from` is the page's origin unless a test plants another. */
  const http = async (as: string, method: string, path: string, body?: { form?: Record<string, string>; json?: unknown }, from: string | null = origin) => {
    const headers = new Headers(from ? { origin: from } : {});
    let payload: string | undefined;
    if (body?.form) {
      headers.set("content-type", "application/x-www-form-urlencoded");
      payload = new URLSearchParams(body.form).toString();
    } else if (body?.json !== undefined) {
      headers.set("content-type", "application/json");
      payload = JSON.stringify(body.json);
    }
    const res = await route(new Request(`${origin}${path}`, { method, headers, ...(payload !== undefined ? { body: payload } : {}) }), { TENANT_ID: TENANT, QYVR_ENV: "staging", TENANT_SHAPE: "company" } as never, { tenant: TENANT, person: as, role: "member" }, { vault: dir } as unknown as Directory);
    return { status: res.status, headers: res.headers, text: await res.text() };
  };
  const egress = (person: string, url: string, ref: string, method = "GET") => vault().egress({ url, method, headers: [["authorization", `Bearer ${ref}`]] }, { person, purpose: "m13_test" });
  const fill = (person: string, ref: string, host = SHOP_LOGIN, field?: string) =>
    vault().fill({ session: "s1", url: `https://${host}/signin`, selector: "#field", ref, ...(field ? { field } : {}) }, { person, purpose: "browse_fill" });
  return { clock, requests, typed, harness, vault, dir, http, egress, fill, token: seededToken() };
}

/** The writer the routes pass for a signed-in person. */
export const by = (person: string, via: "capture-form" | "settings" = "settings") => ({ kind: "person" as const, person, via });

/** Ada's API key for the shop, usable only under a grant, and her shop login, which fills. */
export async function seedShop(w: ReturnType<typeof vaultWorld>, permission: "standing" | "grant" = "grant") {
  const api = await w.vault().capture({ ref: "cred://shop-api", value: w.token, permission, hosts: [{ host: SHOP_API, methods: ["GET", "POST"], header: "authorization", prefix: "Bearer " }] }, by(ada.email, "capture-form"));
  const login = await w.vault().capture({ ref: "cred://shop-login", value: `${w.token}-pw`, kind: "login", hosts: [{ host: SHOP_LOGIN, methods: ["GET"], header: "authorization", prefix: "", fills: true }] }, by(ada.email, "capture-form"));
  if (!api.ok || !login.ok) throw new Error(`seed refused: ${JSON.stringify([api, login])}`);
}
