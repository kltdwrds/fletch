// Copied (types only) from qyvr-co packages/platform/dispatcher/src/keys.ts. wrapDataKey and
// unwrapDataKey live in @qyvr/host-cloudflare.
export type KeyFailureCode = "KEY_NO_TENANT" | "KEY_SERVICE_UNAVAILABLE" | "KEY_INVALID" | "KEY_BLOB_MALFORMED" | "KEY_TENANT_MISMATCH" | "KEY_UNWRAP_FAILED";
export type KeyFailure = { ok: false; code: KeyFailureCode; reason: string };
export type WrapResult = { ok: true; blob: string } | KeyFailure;
export type UnwrapResult = { ok: true; key: Uint8Array } | KeyFailure;

/** What a tenant's KEYS binding offers; the tenant is the binding's, not an argument. */
export interface KeyService {
  wrap(raw: Uint8Array): Promise<WrapResult>;
  unwrap(blob: string): Promise<UnwrapResult>;
}
