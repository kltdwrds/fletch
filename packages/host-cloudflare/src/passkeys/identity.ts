// `passkeyIdentity` (F1): the self-host Identity. A request is identified by its `fletch_session` cookie,
// which names a session the Company holds (only its hash is stored); the session's address must still be a
// member. A session minted by a recovery code is good only under /login until a passkey is added. The
// login storage is one async call (R3), an RPC to the Company on a deploy and a direct call in tests.
import type { Identity } from "@qyvr/host";
import { normalizeEmail } from "../email.ts";
import type { LoginCall, LoginResultOf } from "./call.ts";
import { loginRoutes, readSession } from "./routes.ts";
import type { Verifier } from "./webauthn.ts";

export { SESSION_COOKIE } from "./routes.ts";

export interface PasskeyDeps {
  call: <C extends LoginCall>(c: C) => Promise<LoginResultOf<C>>;
  /** The normalised OWNER_EMAIL: the one address that registers passkeys and signs in. */
  owner: string;
  /** The tenant the verified session names. */
  tenant: string;
  now: () => number;
  /** The WebAuthn ceremony; `simpleWebAuthn` unless a test injects another. */
  verifier?: Verifier;
}

const underLogin = (path: string) => path === "/login" || path.startsWith("/login/");

export function passkeyIdentity(input: PasskeyDeps): Identity {
  const deps = { ...input, owner: normalizeEmail(input.owner) };
  return {
    async verify(request, lookup) {
      const s = await readSession(deps, request);
      if (!s.ok) return { ok: false, code: s.code, reason: s.reason, status: 401 };
      if (s.needsPasskey && !underLogin(new URL(request.url).pathname)) {
        return { ok: false, code: "PASSKEY_REQUIRED", reason: "signed in with a recovery code; add a passkey at /login first", status: 403 };
      }
      const member = await lookup(s.email);
      if (!member) return { ok: false, code: "NOT_A_MEMBER", reason: `${s.email} is not a member here`, status: 403 };
      return { ok: true, session: { tenant: deps.tenant, person: member.email, role: member.role } };
    },
    routes: (request, url) => loginRoutes(deps, request, url),
  };
}
