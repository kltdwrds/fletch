// The host for one owner on one deploy (F1): keys from the `MASTER_KEY` secret, the owner from `OWNER_EMAIL`,
// no cross-tenant budget, and every platform service refused with its code and a reason the UI shows.
import { type Host, unavailable } from "@qyvr/host";
import { normalizeEmail } from "./email.ts";
import { secretKeyService } from "./keys.ts";
import type { LoginCall, LoginResultOf } from "./passkeys/call.ts";
import { passkeyIdentity } from "./passkeys/identity.ts";

export interface SingleAccountEnv {
  TENANT_ID: string;
  TENANT_SHAPE?: string;
  QYVR_ENV?: string;
  OWNER_EMAIL: string;
  MASTER_KEY?: string;
  /** Where sessions and passkeys live: the sign-in calls the Company named by TENANT_ID (`loginCall`, R3). */
  COMPANY: DurableObjectNamespace;
}

const notInBuild = (feature: string) => `${feature} is not part of the self-host build; see README`;

/** The Company's login storage method, as the RPC stub exposes it. */
type LoginStub = { loginCall(c: LoginCall): Promise<unknown> };

export function singleAccountHost(env: SingleAccountEnv): Host {
  const call = async <C extends LoginCall>(c: C): Promise<LoginResultOf<C>> => {
    const company = env.COMPANY.get(env.COMPANY.idFromName(env.TENANT_ID)) as unknown as LoginStub;
    return (await company.loginCall(c)) as LoginResultOf<C>;
  };
  return {
    tenant: { id: env.TENANT_ID, shape: env.TENANT_SHAPE === "company" ? "company" : "standalone", env: "self-host" },
    keys: secretKeyService(env.MASTER_KEY, env.TENANT_ID),
    budget: null,
    identity: passkeyIdentity({ call, owner: normalizeEmail(env.OWNER_EMAIL), tenant: env.TENANT_ID, now: Date.now }),
    mail: unavailable("mail", notInBuild("mail")),
    workspace: unavailable("workspace", notInBuild("workspace")),
    provisioning: unavailable("provisioning", notInBuild("provisioning")),
    members: unavailable("members", notInBuild("members")),
    reporter: { report: (event, fields) => console.log(JSON.stringify({ event, ...fields })) },
    render: unavailable("render", notInBuild("render")),
    memberSeed: JSON.stringify([{ email: normalizeEmail(env.OWNER_EMAIL), role: "owner" }]),
  };
}
