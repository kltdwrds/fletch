// The WebAuthn ceremony behind one small interface, so the login routes can be tested with a fake and the
// real verifier (`@simplewebauthn/server`, WebCrypto only) proven separately. The routes make and keep the
// challenge; the verifier only builds options around it and checks responses against it. Each refusal
// carries the reason in words for the login page.
import { generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse } from "@simplewebauthn/server";
import { fromB64u } from "../keys.ts";

export const RP_NAME = "fletch";

export type VerifyResult<T> = ({ ok: true } & T) | { ok: false; reason: string };

export interface Verifier {
  /** PublicKeyCredentialCreationOptions as JSON, around the given challenge. */
  registrationOptions(o: { rpId: string; userName: string; userId: Uint8Array; challenge: string; exclude: { id: string }[] }): Promise<unknown>;
  verifyRegistration(o: { response: unknown; challenge: string; origin: string; rpId: string }): Promise<VerifyResult<{ credential: { id: string; publicKey: Uint8Array; counter: number; transports: string[] } }>>;
  /** PublicKeyCredentialRequestOptions as JSON, around the given challenge. */
  authenticationOptions(o: { rpId: string; challenge: string; allow: { id: string }[] }): Promise<unknown>;
  verifyAuthentication(o: { response: unknown; challenge: string; origin: string; rpId: string; credential: { id: string; publicKey: Uint8Array; counter: number } }): Promise<VerifyResult<{ newCounter: number }>>;
}

/** The challenge is base64url; simplewebauthn would encode a string's UTF-8 again, so it gets the bytes. */
function challengeBytes(challenge: string): Uint8Array<ArrayBuffer> {
  const bytes = fromB64u(challenge);
  if (!bytes) throw new Error("LOGIN_CHALLENGE_MALFORMED: the challenge is not base64url");
  return new Uint8Array(bytes);
}

const reasonOf = (err: unknown) => (err instanceof Error ? err.message : String(err));

export const simpleWebAuthn: Verifier = {
  registrationOptions: (o) =>
    generateRegistrationOptions({
      rpName: RP_NAME,
      rpID: o.rpId,
      userName: o.userName,
      userID: new Uint8Array(o.userId),
      challenge: challengeBytes(o.challenge),
      attestationType: "none",
      excludeCredentials: o.exclude,
      authenticatorSelection: { residentKey: "preferred", userVerification: "preferred" },
    }),

  async verifyRegistration(o) {
    try {
      const v = await verifyRegistrationResponse({
        response: o.response as Parameters<typeof verifyRegistrationResponse>[0]["response"],
        expectedChallenge: o.challenge,
        expectedOrigin: o.origin,
        expectedRPID: o.rpId,
        requireUserVerification: false,
      });
      if (!v.verified) return { ok: false, reason: "the passkey's registration did not verify" };
      const c = v.registrationInfo.credential;
      return { ok: true, credential: { id: c.id, publicKey: new Uint8Array(c.publicKey), counter: c.counter, transports: c.transports ?? [] } };
    } catch (err) {
      return { ok: false, reason: reasonOf(err) };
    }
  },

  authenticationOptions: (o) => generateAuthenticationOptions({ rpID: o.rpId, challenge: challengeBytes(o.challenge), allowCredentials: o.allow, userVerification: "preferred" }),

  async verifyAuthentication(o) {
    try {
      const v = await verifyAuthenticationResponse({
        response: o.response as Parameters<typeof verifyAuthenticationResponse>[0]["response"],
        expectedChallenge: o.challenge,
        expectedOrigin: o.origin,
        expectedRPID: o.rpId,
        credential: { id: o.credential.id, publicKey: new Uint8Array(o.credential.publicKey), counter: o.credential.counter },
        requireUserVerification: false,
      });
      if (!v.verified) return { ok: false, reason: "the passkey's signature did not verify" };
      return { ok: true, newCounter: v.authenticationInfo.newCounter };
    } catch (err) {
      return { ok: false, reason: reasonOf(err) };
    }
  },
};
