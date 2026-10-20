// The ES256 software passkey (a P-256 key from WebCrypto, "none" attestation, assertions built by hand). It lives
// with @qyvr/host-cloudflare's tests, where the real-ceremony test uses it; this re-export is how the live exit test
// (test/live/) reaches the same helper without a copy. The primitives import nothing from here, so the
// boundary rules hold: the dependency runs from fletch's tests to the primitives' tests, never back.
export { softAuthenticator } from "../../packages/host-cloudflare/test/soft-authenticator.ts";
