// F1: the deploy's owner is a Company member. `singleAccountHost` derives the member seed from OWNER_EMAIL and the
// Company applies it, so the owner's passkey session passes `serve()`'s membership check (no NOT_A_MEMBER) at /app/chats.
import { describe, expect, it } from "vitest";
import { passkeyIdentity, SESSION_COOKIE, singleAccountHost } from "@qyvr/host-cloudflare";
import { serve } from "../../packages/agent/src/http/serve.ts";
import { ada, authorityWorld, TENANT } from "./support/authority-world.ts";

const OWNER = ada.email.toUpperCase();

describe("[F1] the owner is a member", () => {
  it("OWNER_EMAIL seeds the Company, so the owner's session reaches /app/chats", async () => {
    const seed = singleAccountHost({ TENANT_ID: TENANT, OWNER_EMAIL: OWNER, COMPANY: {} as DurableObjectNamespace }).memberSeed;
    const w = authorityWorld({ companyEnv: { HOST: { memberSeed: seed } } });
    const company = w.companyHarness().instance;
    expect(await company.lookup(` ${ada.email} `)).toMatchObject({ email: ada.email, role: "owner" });
    expect(await company.lookup(`x-${ada.email}`)).toBeNull();

    const identity = passkeyIdentity({ call: async (c) => company.loginCall(c) as never, owner: ada.email, tenant: TENANT, now: () => w.clock.now });
    const env = { ...w.env, OWNER_EMAIL: OWNER, HOST: { identity } };
    const token = (await company.loginCall({ op: "mint", email: ada.email, needsPasskey: false })) as string;
    const res = await serve(new Request(`https://${TENANT}.example/app/chats`, { headers: { cookie: `${SESSION_COOKIE}=${token}` } }), env as never, { tenant: TENANT }, { dir: w.dir, now: () => w.clock.now });
    expect(res.status).toBe(200);
  });
});
