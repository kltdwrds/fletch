// The host for one owner on one deploy (F1): keys from the `MASTER_KEY` secret, the owner from `OWNER_EMAIL`,
// no cross-tenant budget, and every platform service refused with its code and a reason the UI shows.
import { type Host, unavailable } from "@qyvr/host";
import { normalizeEmail } from "./email.ts";
import { secretKeyService } from "./keys.ts";

export interface SingleAccountEnv {
  TENANT_ID: string;
  TENANT_SHAPE?: string;
  QYVR_ENV?: string;
  OWNER_EMAIL: string;
  MASTER_KEY?: string;
  /** Where sessions and passkeys live: the sign-in calls the Company by name (Tasks 7-9). */
  COMPANY: DurableObjectNamespace;
}

const notInBuild = (feature: string) => `${feature} is not part of the self-host build; see README`;

export function singleAccountHost(env: SingleAccountEnv): Host {
  return {
    tenant: { id: env.TENANT_ID, shape: env.TENANT_SHAPE === "company" ? "company" : "standalone", env: "self-host" },
    keys: secretKeyService(env.MASTER_KEY, env.TENANT_ID),
    budget: null,
    // Until the passkey login lands no session verifies.
    identity: {
      verify: async () => ({ ok: false, code: "IDENTITY_UNAVAILABLE", reason: "sign-in is not set up on this deploy yet", status: 503 }),
      routes: async () => null,
    },
    mail: unavailable("mail", notInBuild("mail")),
    workspace: unavailable("workspace", notInBuild("workspace")),
    provisioning: unavailable("provisioning", notInBuild("provisioning")),
    members: unavailable("members", notInBuild("members")),
    reporter: { report: (event, fields) => console.log(JSON.stringify({ event, ...fields })) },
    render: unavailable("render", notInBuild("render")),
    memberSeed: JSON.stringify([{ email: normalizeEmail(env.OWNER_EMAIL), role: "owner" }]),
  };
}
