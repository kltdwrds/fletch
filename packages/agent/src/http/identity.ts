// Who a request is from (M4.1). The dispatcher names the tenant in props; the person comes only from
// this tenant's Access token, verified here (`access.ts`), whose email claim the `Company` must list
// as a member. The agent script then passes the person to its objects in PERSON_HEADER, which the
// dispatcher strips from client traffic and the script overwrites on every forward.
//
// Staging's live lane alone has a second form: a verified service-token token from the staging
// service token (`ACCESS_LIVE_CLIENT_ID`), carrying no email, plus the dispatcher's development
// session naming the person in props. Neither half is enough on its own, and outside staging the
// development session is ignored.
import type { Member } from "../company/members.ts";
import { ACCESS_JWT_HEADER, type AccessRefusal, type KeySource, verifyAccessJwt } from "./access.ts";

export const PERSON_HEADER = "x-qyvr-person";

/** What the dispatcher puts in props; nothing a request carries can change it. */
export interface DispatchProps {
  tenant: string;
  /** Staging only: the person of a development session the dispatcher verified. */
  devPerson?: string;
  /** Set by the dispatcher for its own provisioning-API calls, never for edge traffic. */
  platform?: true;
}

export function propsOf(ctx: { props?: unknown } | undefined): DispatchProps | null {
  const p = ctx?.props as Record<string, unknown> | undefined;
  if (!p || typeof p.tenant !== "string") return null;
  return {
    tenant: p.tenant,
    ...(typeof p.devPerson === "string" && p.devPerson ? { devPerson: p.devPerson } : {}),
    ...(p.platform === true ? { platform: true as const } : {}),
  };
}

/** The resolved session the routes serve: a member of this tenant and their role. */
export interface Session {
  tenant: string;
  person: string;
  role: Member["role"];
}

export type IdentityRefusal = AccessRefusal | "ACCESS_EMAIL_MISSING" | "NOT_A_MEMBER";
export type IdentityVerdict = { ok: true; session: Session } | { ok: false; code: IdentityRefusal; reason: string; status: 401 | 403 | 503 };

export interface IdentityDeps {
  keys: KeySource;
  lookup(email: string): Promise<Member | null>;
  now(): number;
}

type IdentityEnv = Pick<Env, "TENANT_ID" | "QYVR_ENV" | "ACCESS_ISSUER" | "ACCESS_AUD" | "ACCESS_LIVE_CLIENT_ID">;

export async function identify(request: Request, env: IdentityEnv, props: DispatchProps, deps: IdentityDeps): Promise<IdentityVerdict> {
  const verdict = await verifyAccessJwt(request.headers.get(ACCESS_JWT_HEADER), { issuer: env.ACCESS_ISSUER, audience: env.ACCESS_AUD }, deps.keys, deps.now());
  if (!verdict.ok) {
    const status = verdict.code === "ACCESS_KEYS_UNAVAILABLE" || verdict.code === "ACCESS_NOT_CONFIGURED" ? 503 : 401;
    return { ok: false, code: verdict.code, reason: verdict.reason, status };
  }
  let email = verdict.claims.email;
  if (!email) {
    const liveLane =
      env.QYVR_ENV === "staging" && !!env.ACCESS_LIVE_CLIENT_ID && verdict.claims.common_name === env.ACCESS_LIVE_CLIENT_ID && !!props.devPerson;
    if (!liveLane) return { ok: false, code: "ACCESS_EMAIL_MISSING", reason: "the token names no email", status: 401 };
    email = props.devPerson;
  }
  const member = await deps.lookup(email as string);
  if (!member) return { ok: false, code: "NOT_A_MEMBER", reason: `not a member of ${env.TENANT_ID}`, status: 403 };
  return { ok: true, session: { tenant: env.TENANT_ID, person: member.email, role: member.role } };
}
