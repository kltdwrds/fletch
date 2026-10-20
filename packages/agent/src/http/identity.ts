// Who a request is from (F1). The host's identity (`hostOf(env).identity`) verifies the request (a
// passkey session on a self-host deploy) and asks the `Company` whether the address is a member; the
// person is never read from anything the request names. The agent script then passes the person to
// its objects in PERSON_HEADER, which it overwrites on every forward.
import type { IdentityVerdict } from "@qyvr/host";
import type { Member } from "../company/members.ts";
import { hostOf } from "../host.ts";

export const PERSON_HEADER = "x-qyvr-person";

/** What the script's props carry where something in front of it sets them; nothing a request carries can change them. */
export interface DispatchProps {
  tenant: string;
  /** Set only by a platform in front of the script for its own calls, never for edge traffic. */
  platform?: true;
}

export function propsOf(ctx: { props?: unknown } | undefined): DispatchProps | null {
  const p = ctx?.props as Record<string, unknown> | undefined;
  if (!p || typeof p.tenant !== "string") return null;
  return { tenant: p.tenant, ...(p.platform === true ? { platform: true as const } : {}) };
}

/** The session the routes serve, from the host's verdict: this tenant, a member the `Company` lists, and their role. */
export async function identify(request: Request, env: Env, lookup: (email: string) => Promise<Member | null>): Promise<IdentityVerdict> {
  const verdict = await hostOf(env).identity.verify(request, lookup);
  if (!verdict.ok) return verdict;
  // The host's session names a tenant: this script serves only its own.
  if (verdict.session.tenant !== env.TENANT_ID) return { ok: false, code: "NOT_A_MEMBER", reason: `not a member of ${env.TENANT_ID}`, status: 403 };
  return verdict;
}
