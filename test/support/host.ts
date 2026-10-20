// The hermetic lane's Host (F1): what `hostOf(env)` answers in every test. The agent's entry module
// installs its own factory when it is imported; `installTestHost` replaces it before each file's tests run
// (host.setup.ts), so no test reaches a self-host or platform service it did not name. A test names the
// services it wants on its env as `HOST` (a partial Host); whatever it leaves out is refused with its code,
// exactly as a self-host deploy refuses it, and the budget is null (no cross-tenant cap).
import type { Host, Identity } from "@qyvr/host";
import { unavailable } from "@qyvr/host";
import { secretKeyService } from "@qyvr/host-cloudflare";
import { __resetHostForTests, setHost } from "../../packages/agent/src/host.ts";

/** What a test may put on its env to shape the host; anything left out is the default below. */
export type TestHostOverrides = Partial<Omit<Host, "tenant">> & { tenant?: Partial<Host["tenant"]> };

/** No session is ever verified: the test drives routes with a resolved session, or expects this refusal. */
export const refusingIdentity: Identity = {
  verify: async () => ({ ok: false, code: "IDENTITY_UNAVAILABLE", reason: "the test host verifies no session", status: 503 }),
  routes: async () => null,
};

const reason = (feature: string) => `${feature} is not part of the test host; a test names it on env.HOST`;

/** The test host for one env: its tenant from the env's vars, every optional service refused, then the env's `HOST`. */
export function testHost(env: Record<string, unknown>): Host {
  const over = (env.HOST ?? {}) as TestHostOverrides;
  const id = typeof env.TENANT_ID === "string" ? env.TENANT_ID : "solo-sam";
  const base: Host = {
    tenant: { id, shape: env.TENANT_SHAPE === "company" ? "company" : "standalone", env: "self-host" },
    keys: secretKeyService(typeof env.MASTER_KEY === "string" ? env.MASTER_KEY : undefined, id),
    budget: null,
    identity: refusingIdentity,
    mail: unavailable("mail", reason("mail")),
    workspace: unavailable("workspace", reason("workspace")),
    provisioning: unavailable("provisioning", reason("provisioning")),
    members: unavailable("members", reason("members")),
    reporter: { report: () => {} },
    render: unavailable("render", reason("render")),
    memberSeed: "[]",
  };
  return { ...base, ...over, tenant: { ...base.tenant, ...(over.tenant ?? {}) } };
}

/** Replaces whatever factory is installed with the test host; safe to call more than once. */
export function installTestHost(): void {
  __resetHostForTests();
  setHost((env) => testHost(env as unknown as Record<string, unknown>));
}
