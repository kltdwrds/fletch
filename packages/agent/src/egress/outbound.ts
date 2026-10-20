// The agent script's network outside its bindings (M25.1, spec P4): the egress module's own fetch,
// which only the Vault hosts, and three fixed platform channels, each named here with why it is safe
// outside egress (M25.5). The boundary check's `agent-fetch` rule (`scripts/check-boundaries.mjs`)
// refuses a global fetch anywhere else in the agent script; a binding's or a stub's own `fetch` is a
// named binding and stays allowed. Code the agent runs never reaches these: its only outbound is the
// `Egress` entrypoint (`code/egress.ts`). None of these carries a registry credential.

/** The egress module's network: the Vault passes it to `egressFetch` and `egressFill`; nothing else calls it. */
export const egressNetwork = (url: string, init: RequestInit): Promise<Response> => fetch(url, init);

/**
 * Cloudflare Access's signing keys (`http/access.ts`): the team's certs URL from the agent's config,
 * read to verify a sign-in before any person is known.
 * Safe: the address is the platform's config (`ACCESS_ISSUER`, set by the generator) plus
 * `/cdn-cgi/access/certs`, never a person's or the model's; it is a GET with no credential, and what
 * it returns only verifies a token.
 */
export const accessKeysFetch = (url: string): Promise<Response> => fetch(url);

/**
 * A Web Push delivery (M14.1) to the endpoint the person's own browser subscribed, signed with the
 * tenant's VAPID key, which the Vault keeps.
 * Safe: the endpoint comes from the browser's push subscription and is saved only at a known push
 * service, https on the default port (`checkEndpoint`, `delivery/webpush.ts`); the body is encrypted
 * to that browser's keys and the VAPID signature authorises nothing but delivery, so neither a
 * registry credential nor readable data leaves.
 */
export const pushPost = (endpoint: string, init: RequestInit): Promise<Response> => fetch(endpoint, { method: "POST", ...init });

/**
 * An ingress socket source's WebSocket upgrade (M6.1): a wss:// address that sends events in; egress
 * carries no sockets.
 * Safe: it is the one channel whose address a creator chooses, so the address is checked against the
 * owner's host registry when the source is created (`INGRESS_HOST_UNLISTED`, `ingress/engine.ts`); the
 * upgrade carries no credential, and what arrives is event data for a gate, never an instruction.
 */
export const socketUpgrade = (url: string): Promise<Response> => fetch(url, { headers: { upgrade: "websocket" } });
