// The login routes (F1), all answered before any session exists. One owner per deploy: the first passkey is
// registered only with the SETUP_TOKEN secret (the `?setup=` link init prints; no token configured fails
// closed), after which registering needs the owner's session and the token grants nothing. A
// challenge is minted by an options route, kept in the Company under a random id that the options response
// carries (`challengeId`), and taken (single use, 300 s) by the matching verify route, which the page calls
// with that id echoed back. State-changing routes accept only a same-origin `Origin`. rpId and origin come
// from each request's URL. Every refusal is JSON `{ ok: false, code, reason }` with the reason in words.
import { sha256 } from "@noble/hashes/sha2.js";
import { normalizeEmail } from "../email.ts";
import { b64u } from "../keys.ts";
import type { PasskeyDeps } from "./identity.ts";
import { loginPage, PAGE_CSP } from "./page.ts";
import { simpleWebAuthn } from "./webauthn.ts";

export const SESSION_COOKIE = "fletch_session";
const COOKIE_ATTRS = "HttpOnly; Secure; SameSite=Lax; Path=/";
const COOKIE_MAX_AGE = 2_592_000;

const NO_STORE = { "cache-control": "no-store", "x-content-type-options": "nosniff" };

export const sessionCookie = (token: string) => `${SESSION_COOKIE}=${token}; ${COOKIE_ATTRS}; Max-Age=${COOKIE_MAX_AGE}`;
export const clearedCookie = () => `${SESSION_COOKIE}=; ${COOKIE_ATTRS}; Max-Age=0`;

/** The session token the request's cookie carries, or null. */
export function tokenOf(request: Request): string | null {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const at = part.indexOf("=");
    if (at > 0 && part.slice(0, at).trim() === SESSION_COOKIE) return part.slice(at + 1).trim() || null;
  }
  return null;
}

export type SessionRead =
  | { ok: true; token: string; email: string; needsPasskey: boolean }
  | { ok: false; code: "SESSION_MISSING" | "SESSION_UNKNOWN" | "SESSION_EXPIRED"; reason: string };

/** The request's session as the Company holds it; no lookup when the request carries no cookie. */
export async function readSession(deps: PasskeyDeps, request: Request): Promise<SessionRead> {
  const token = tokenOf(request);
  if (!token) return { ok: false, code: "SESSION_MISSING", reason: "not signed in" };
  const found = await deps.call({ op: "lookup", token });
  if (found === "unknown") return { ok: false, code: "SESSION_UNKNOWN", reason: "this session is not known; sign in again" };
  if (found === "expired") return { ok: false, code: "SESSION_EXPIRED", reason: "this session has expired; sign in again" };
  return { ok: true, token, ...found };
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => Response.json(body, { status, headers: { ...NO_STORE, ...headers } });
const refuse = (code: string, reason: string, status: number) => json({ ok: false, code, reason }, status);

const CHALLENGE_EXPIRED = () => refuse("LOGIN_CHALLENGE_EXPIRED", "the sign-in request expired or was already used; start again", 400);

/** A user handle that names no one: derived from the owner's address, never the address itself. */
const userIdOf = (owner: string) => sha256(new TextEncoder().encode(`fletch-user:${owner}`)).slice(0, 16);
const random = () => b64u(crypto.getRandomValues(new Uint8Array(32)));

async function readBody(request: Request): Promise<Record<string, unknown> | null> {
  const body = await request.json().catch(() => null);
  return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
}

/** `{ challengeId, credential }` as the page sends it to the verify routes, the credential's id a string. */
async function ceremonyBody(request: Request): Promise<{ challengeId: string; credential: Record<string, unknown> & { id: string }; setup: unknown } | null> {
  const body = await readBody(request);
  const credential = body?.credential;
  if (typeof body?.challengeId !== "string" || !credential || typeof credential !== "object") return null;
  if (typeof (credential as { id?: unknown }).id !== "string") return null;
  return { challengeId: body.challengeId, credential: credential as Record<string, unknown> & { id: string }, setup: body.setup };
}

/** Constant time over SHA-256 digests, so neither the token's bytes nor its length leak through timing. */
function sameSecret(given: unknown, expected: string): boolean {
  if (typeof given !== "string") return false;
  const a = sha256(new TextEncoder().encode(given));
  const b = sha256(new TextEncoder().encode(expected));
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= (a[i] as number) ^ (b[i] as number);
  return diff === 0;
}

const BODY_INVALID = () => refuse("LOGIN_BODY_INVALID", "the request body is not what the login page sends", 400);

export async function loginRoutes(deps: PasskeyDeps, request: Request, url: URL): Promise<Response | null> {
  const path = url.pathname;
  const method = request.method;
  const verifier = deps.verifier ?? simpleWebAuthn;
  const rpId = url.hostname;
  const origin = url.origin;

  if (path === "/login" && method === "GET") {
    const count = await deps.call({ op: "count" });
    const session = count > 0 && tokenOf(request) ? await readSession(deps, request) : null;
    // Before the first passkey, only the setup link opens registration; any other visit gets the same page.
    const setupOk = !!deps.setupToken && sameSecret(url.searchParams.get("setup"), deps.setupToken);
    const state = count === 0 ? (setupOk ? "register" : "setup") : session?.ok && session.email === deps.owner ? "add" : "authenticate";
    return new Response(loginPage(state), {
      headers: { "content-type": "text/html; charset=utf-8", "content-security-policy": PAGE_CSP, "referrer-policy": "no-referrer", ...NO_STORE },
    });
  }

  const passkeyPath = path.match(/^\/login\/passkeys(?:\/([^/]+))?$/);
  const known =
    (method === "POST" && ["/login/register/options", "/login/register/verify", "/login/options", "/login/verify", "/login/recover", "/logout"].includes(path)) ||
    (passkeyPath && ((method === "GET" && !passkeyPath[1]) || (method === "DELETE" && passkeyPath[1])));
  if (!known) return null;

  // CSRF: a state change is accepted only from a page on this origin.
  if (method !== "GET" && request.headers.get("origin") !== origin) return refuse("LOGIN_ORIGIN", "this request did not come from this site's login page", 403);

  /** The owner's session, needed to add a passkey once one exists (a recovery session counts). */
  const ownerSession = async () => {
    const s = await readSession(deps, request);
    return s.ok && s.email === deps.owner ? s : null;
  };
  /** Before the first passkey: the setup token. After: the owner's session. Nothing about the owner is answered before this passes. */
  const registerGate = async (setup: unknown) => {
    const count = await deps.call({ op: "count" });
    const no = (refused: Response) => ({ ok: false as const, refused });
    if (count === 0) {
      if (!deps.setupToken) {
        return no(refuse("LOGIN_SETUP_UNAVAILABLE", "first sign-in is not set up on this deploy: run `npm create fletch`, or set a setup token with `wrangler secret put SETUP_TOKEN`, then open the printed setup link", 503));
      }
      if (!sameSecret(setup, deps.setupToken)) return no(refuse("LOGIN_SETUP_REQUIRED", "creating the first passkey needs the setup link printed when this deploy was set up", 403));
      return { ok: true as const, count, session: await ownerSession() };
    }
    const session = await ownerSession();
    if (!session) return no(refuse("LOGIN_ALREADY_REGISTERED", "a passkey is already registered on this deploy; sign in with it, or use your recovery code", 403));
    return { ok: true as const, count, session };
  };
  /** The request's own session, revoked before a new one replaces it. */
  const revokeCarried = async () => {
    const token = tokenOf(request);
    if (token) await deps.call({ op: "revoke", token });
  };

  if (path === "/login/register/options") {
    const gate = await registerGate((await readBody(request))?.setup);
    if (!gate.ok) return gate.refused;
    const challengeId = random();
    const challenge = random();
    await deps.call({ op: "putChallenge", id: challengeId, challenge, kind: "register" });
    const exclude = (await deps.call({ op: "list" })).map((p) => ({ id: p.id }));
    const options = await verifier.registrationOptions({ rpId, userName: deps.owner, userId: userIdOf(deps.owner), challenge, exclude });
    return json({ ok: true, challengeId, options });
  }

  if (path === "/login/register/verify") {
    const body = await ceremonyBody(request);
    if (!body) return BODY_INVALID();
    const gate = await registerGate(body.setup);
    if (!gate.ok) return gate.refused;
    const challenge = await deps.call({ op: "takeChallenge", id: body.challengeId, kind: "register" });
    if (!challenge) return CHALLENGE_EXPIRED();
    const v = await verifier.verifyRegistration({ response: body.credential, challenge, origin, rpId });
    if (!v.ok) return refuse("LOGIN_PASSKEY_INVALID", v.reason, 400);
    const added = await deps.call({ op: "addPasskey", ...v.credential, email: deps.owner, requireEmpty: gate.count === 0 });
    if (!added.ok) {
      return added.code === "LOGIN_PASSKEY_EXISTS"
        ? refuse(added.code, "this passkey is already registered", 409)
        : refuse(added.code, "a passkey was registered on this deploy a moment ago; sign in with it", 403);
    }
    // A new recovery code on the first passkey, and after a recovery (the old code is spent).
    const recoveryCode = gate.count === 0 || gate.session?.needsPasskey ? await deps.call({ op: "issueRecovery", email: deps.owner }) : null;
    if (gate.session) await deps.call({ op: "revoke", token: gate.session.token });
    const token = await deps.call({ op: "mint", email: deps.owner, needsPasskey: false });
    return json(recoveryCode ? { ok: true, recoveryCode } : { ok: true }, 200, { "set-cookie": sessionCookie(token) });
  }

  if (path === "/login/options") {
    const passkeys = await deps.call({ op: "list" });
    if (!passkeys.length) return refuse("LOGIN_NOT_REGISTERED", "no passkey is registered on this deploy yet; create one first", 400);
    const challengeId = random();
    const challenge = random();
    await deps.call({ op: "putChallenge", id: challengeId, challenge, kind: "authenticate" });
    const options = await verifier.authenticationOptions({ rpId, challenge, allow: passkeys.map((p) => ({ id: p.id })) });
    return json({ ok: true, challengeId, options });
  }

  if (path === "/login/verify") {
    const body = await ceremonyBody(request);
    if (!body) return BODY_INVALID();
    const challenge = await deps.call({ op: "takeChallenge", id: body.challengeId, kind: "authenticate" });
    if (!challenge) return CHALLENGE_EXPIRED();
    const credential = await deps.call({ op: "byId", id: body.credential.id });
    if (!credential) return refuse("LOGIN_PASSKEY_UNKNOWN", "this passkey is not registered on this deploy", 400);
    if (credential.email !== deps.owner) return refuse("LOGIN_NOT_OWNER", "this passkey belongs to an address that is not this deploy's owner", 403);
    const v = await verifier.verifyAuthentication({ response: body.credential, challenge, origin, rpId, credential });
    if (!v.ok) return refuse("LOGIN_PASSKEY_INVALID", v.reason, 400);
    await deps.call({ op: "bump", id: credential.id, counter: v.newCounter });
    await revokeCarried();
    const token = await deps.call({ op: "mint", email: deps.owner, needsPasskey: false });
    return json({ ok: true }, 200, { "set-cookie": sessionCookie(token) });
  }

  if (path === "/login/recover") {
    const body = await readBody(request);
    if (typeof body?.email !== "string" || typeof body.code !== "string") return BODY_INVALID();
    const mismatch = () => refuse("RECOVERY_CODE_INVALID", "that address and recovery code do not match", 403);
    // Any other address reads the same as a wrong code: the page does not confirm who the owner is.
    if (normalizeEmail(body.email) !== deps.owner) return mismatch();
    const r = await deps.call({ op: "redeemRecovery", email: deps.owner, code: body.code });
    if (!r.ok) return r.code === "RECOVERY_CODE_SPENT" ? refuse(r.code, "that recovery code was already used; sign in with a passkey", 403) : mismatch();
    await revokeCarried();
    const token = await deps.call({ op: "mint", email: deps.owner, needsPasskey: true });
    return json({ ok: true, needsPasskey: true }, 200, { "set-cookie": sessionCookie(token) });
  }

  if (path === "/logout") {
    const token = tokenOf(request);
    if (token) await deps.call({ op: "revoke", token });
    return new Response(null, { status: 204, headers: { "set-cookie": clearedCookie(), ...NO_STORE } });
  }

  // /login/passkeys: the owner's own session, signed in with a passkey (not a recovery session).
  const s = await readSession(deps, request);
  if (!s.ok) return refuse(s.code, s.reason, 401);
  if (s.email !== deps.owner) return refuse("LOGIN_OWNER_REQUIRED", "only this deploy's owner manages its passkeys", 403);
  if (s.needsPasskey) return refuse("PASSKEY_REQUIRED", "add a passkey before managing passkeys", 403);
  const passkeys = await deps.call({ op: "list" });
  const id = passkeyPath?.[1];
  if (!id) return json({ ok: true, passkeys: passkeys.map((p) => ({ id: p.id, at: p.at })) });
  let target: string;
  try {
    target = decodeURIComponent(id);
  } catch {
    return refuse("LOGIN_PASSKEY_UNKNOWN", "no passkey with that id is registered", 404);
  }
  if (!passkeys.some((p) => p.id === target)) return refuse("LOGIN_PASSKEY_UNKNOWN", "no passkey with that id is registered", 404);
  // Removing the last one would reopen first-visitor registration to anyone.
  if (passkeys.length === 1) return refuse("LOGIN_LAST_PASSKEY", "this is the only passkey; add another before removing it", 409);
  await deps.call({ op: "remove", id: target });
  return new Response(null, { status: 204, headers: NO_STORE });
}
