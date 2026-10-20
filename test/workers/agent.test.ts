// Runs the agent script's production fetch handler and object classes under Node, with the
// `cloudflare:workers` shim from vitest.config.ts. Type-checked by packages/agent/tsconfig.json.
import { describe, expect, it } from "vitest";
import worker, * as agent from "../../packages/agent/src/index.ts";
import { ObjectHarness } from "../support/object-harness.ts";

/** AD-1's seven classes, written out here so the test does not trust the code's own list. */
const AD1_OBJECTS = ["Person", "Company", "Chat", "Job", "Ingress", "Ledger", "Vault"] as const;

const env = { TENANT_ID: "solo-sam", QYVR_ENV: "staging" } as unknown as Env;
const call = (path: string, init?: RequestInit, props: Record<string, unknown> = { tenant: "solo-sam" }) =>
  worker.fetch(new Request(`https://solo-sam.qyvr-staging.dev${path}`, init) as Request<unknown, IncomingRequestCfProperties>, env, {
    props,
  } as unknown as ExecutionContext);

describe("[M0.1] agent script", () => {
  it("/health names the seven object classes from AD-1", async () => {
    const res = await call("/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, tenant: "solo-sam", objects: [...AD1_OBJECTS] });
  });

  it("exports each object class; those no part has built yet answer NOT_IMPLEMENTED with their name", async () => {
    for (const name of AD1_OBJECTS) expect(typeof agent[name]).toBe("function");
    for (const name of ["Company", "Job", "Ingress", "Ledger"] as const) {
      const instance = new ObjectHarness(name, (ctx, e) => new agent[name](ctx as DurableObjectState, e as Env), env as unknown as Record<string, unknown>).instance;
      const res = await instance.fetch();
      expect([res.status, await res.json()]).toEqual([501, { code: "NOT_IMPLEMENTED", object: name }]);
    }
  });

  it("answers every route but /health only to a verified session; a person in props names nobody", async () => {
    // From M4.1 the person comes from the tenant's Access token alone (test/workers/m4-identity.test.ts
    // covers the token paths and NOT_FOUND for a signed-in member).
    const ada = { tenant: "solo-sam", person: "sam@solo-sam.example" };
    const res = await call("/nope", undefined, ada);
    expect([res.status, ((await res.json()) as { code: string }).code]).toEqual([503, "ACCESS_NOT_CONFIGURED"]);
    const post = await call("/health", { method: "POST" }, ada);
    expect([post.status, ((await post.json()) as { code: string }).code]).toEqual([503, "ACCESS_NOT_CONFIGURED"]);
  });
});
