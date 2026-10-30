// The egress policy (AD-12): which hosts a request may reach, with which methods, and where a
// `cred://` reference may stand. Pure, used by the tenant's egress module inside the `Vault`, which
// alone resolves references. Every refusal carries a stable code. Credential-free public hosts are
// listed here; every host a credential may reach comes from the tenant's registry (M13,
// `vault/hosts.ts`), which a person writes and the platform policy caps. Where a reference may stand
// on a request (a header, a query parameter or a JSON body field) is declared per credential: by its
// connector's manifest (`connectors/manifest.ts`), else by the person's registry entry, which names a
// header alone (M25.1). Nothing here places a credential globally.

export type EgressCode =
  | "EGRESS_URL_INVALID"
  | "EGRESS_SCHEME_DENIED"
  | "EGRESS_HOST_DENIED"
  | "EGRESS_METHOD_DENIED"
  | "EGRESS_CRED_PLACEMENT"
  | "EGRESS_CRED_UNKNOWN"
  | "EGRESS_CRED_HOST_DENIED"
  | "EGRESS_CRED_UNAVAILABLE"
  | "EGRESS_VAULT_LOCKED"
  | "EGRESS_UPSTREAM_FAILED"
  | "EGRESS_RESPONSE_TOO_LARGE"
  | "EGRESS_FILL_FAILED"
  | "EGRESS_COMPANY_GRANT_REQUIRED"
  | "EGRESS_HOST_POLICY"
  | "EGRESS_CRED_REVOKED"
  | "EGRESS_CRED_EXPIRED"
  | "EGRESS_CRED_SPENT"
  | "EGRESS_GRANT_REQUIRED"
  | "EGRESS_GRANT_INVALID"
  | "EGRESS_GRANT_EXPIRED"
  | "EGRESS_GRANT_REVOKED"
  | "EGRESS_GRANT_SPENT"
  | "EGRESS_GRANT_SCOPE"
  | "EGRESS_FILL_FIELD"
  | "EGRESS_SURROGATE_UNKNOWN";

/** `ref` names the credential a refused plan carried, when it carried one (F35: the refusal's audit row). */
export type EgressFailure = { ok: false; code: EgressCode; reason: string; host?: string; ref?: string };

/**
 * One place a credential's value may stand on a request: a header after an optional scheme word
 * (`Bearer `), a query parameter's whole value, or a top-level JSON body field's whole value.
 */
export type Placement = { in: "header"; name: string; prefix: string } | { in: "query"; param: string } | { in: "body"; field: string };

export function samePlacement(a: Placement, b: Placement): boolean {
  if (a.in === "header" && b.in === "header") return a.name === b.name && a.prefix === b.prefix;
  if (a.in === "query" && b.in === "query") return a.param === b.param;
  return a.in === "body" && b.in === "body" && a.field === b.field;
}

export function placementWords(p: Placement): string {
  return p.in === "header" ? `the ${p.name} header after "${p.prefix}"` : p.in === "query" ? `the query parameter ${p.param}` : `the body field ${p.field}`;
}

/** Where one credential may stand on a host: the placements declared for it, its methods, and whether it may be typed into a page. */
export interface CredentialSlot {
  ref: string;
  placements: readonly Placement[];
  methods: readonly string[];
  fill: boolean;
}

export interface HostRule {
  host: string;
  /** Methods allowed to this host without a credential; a credential's own methods are on its slot. */
  methods: readonly string[];
  /** The credentials a request to this host may carry or a page on it may take, as the registry placed them. */
  credentials: readonly CredentialSlot[];
}

/** Hosts reachable without a credential, the same for every tenant. Nothing here carries a credential. */
export const PUBLIC_HOSTS: readonly HostRule[] = [{ host: "hacker-news.firebaseio.com", methods: ["GET", "HEAD"], credentials: [] }];

/** A request as it crosses into egress: plain data, so it travels over RPC unchanged. */
export interface OutboundRequest {
  url: string;
  method?: string;
  headers?: Array<[string, string]>;
  body?: string;
}

export interface CredentialUse {
  ref: string;
  placement: Placement;
}

export type Planned =
  | { ok: true; url: URL; method: string; rule: HostRule; headers: Array<[string, string]>; uses: CredentialUse[]; body?: string }
  | EgressFailure;

export const CRED_REF = /^cred:\/\/[a-z][a-z0-9-]{0,62}$/;
const CRED_SCHEME = /cred:\/\//i;
/** True when `text`, as written or percent-decoded, contains a reference. */
function hasRef(text: string): boolean {
  if (CRED_SCHEME.test(text)) return true;
  try {
    return CRED_SCHEME.test(decodeURIComponent(text));
  } catch {
    return /cred(?::|%3a)/i.test(text);
  }
}
/** A header value that is a reference alone or after an auth scheme: `cred://x`, `Bearer cred://x`. */
const CRED_HEADER = /^((?:[A-Za-z][A-Za-z0-9-]* )?)(cred:\/\/[a-z][a-z0-9-]{0,62})$/;

const fail = (code: EgressCode, reason: string, host?: string, ref?: string): EgressFailure => ({ ok: false, code, reason, ...(host ? { host } : {}), ...(ref ? { ref } : {}) });

/** The references a request carries, each where it stands; anything else that names one is a placement refusal. */
function references(url: URL, req: OutboundRequest): { ok: true; uses: CredentialUse[]; headers: Array<[string, string]> } | { ok: false; reason: string } {
  const uses: CredentialUse[] = [];
  const rest = new URL(url.href);
  for (const [param, value] of url.searchParams) {
    if (!CRED_REF.test(value)) continue;
    if (url.searchParams.getAll(param).length > 1) return { ok: false, reason: `the query parameter ${param} appears more than once beside a reference` };
    uses.push({ ref: value, placement: { in: "query", param } });
    rest.searchParams.delete(param);
  }
  if (hasRef(rest.href)) return { ok: false, reason: "a reference in a URL stands only as a whole query parameter value" };
  if (req.body !== undefined && hasRef(String(req.body))) {
    let body: unknown;
    try {
      body = JSON.parse(String(req.body));
    } catch {
      return { ok: false, reason: "a reference in a body stands only as a whole field value of a JSON object" };
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, reason: "a reference in a body stands only as a whole field value of a JSON object" };
    const others: Record<string, unknown> = {};
    for (const [field, value] of Object.entries(body)) {
      if (typeof value === "string" && CRED_REF.test(value)) uses.push({ ref: value, placement: { in: "body", field } });
      else others[field] = value;
    }
    if (hasRef(JSON.stringify(others))) return { ok: false, reason: "a reference in a body stands only as a whole field value of a JSON object" };
  }
  const headers: Array<[string, string]> = [];
  for (const [name, value] of req.headers ?? []) {
    const v = String(value);
    const m = v.match(CRED_HEADER);
    if (m) {
      uses.push({ ref: m[2] as string, placement: { in: "header", name: String(name).toLowerCase(), prefix: m[1] as string } });
      continue;
    }
    if (hasRef(v) || hasRef(String(name))) return { ok: false, reason: "a reference in a header must be the whole value, after an optional scheme" };
    headers.push([String(name), v]);
  }
  return { ok: true, uses, headers };
}

/**
 * What a job's reads may reach beyond the listed hosts (M25.6): any host this check lets through, by
 * GET or HEAD, with no credential on the request. It answers `null` for a host that may be read and the
 * reason for one that may not. The platform policy cap (`vault/hosts.ts`) is the check; it lives there.
 */
export type PublicHost = (host: string) => string | null;

export function plan(req: OutboundRequest, hosts: readonly HostRule[], publicHost?: PublicHost): Planned {
  let url: URL;
  try {
    url = new URL(String(req?.url ?? ""));
  } catch {
    return fail("EGRESS_URL_INVALID", "the URL does not parse");
  }
  const host = url.hostname.toLowerCase();
  const found = references(url, req);
  if (!found.ok) return fail("EGRESS_CRED_PLACEMENT", found.reason, host);
  if (url.protocol !== "https:") return fail("EGRESS_SCHEME_DENIED", `only https is allowed, not ${url.protocol}`, host);
  if (url.username || url.password || url.port) return fail("EGRESS_URL_INVALID", "the URL carries userinfo or a port", host);
  const known = (ref: string) => hosts.some((r) => r.credentials.some((c) => c.ref === ref));
  let rule = hosts.find((r) => r.host === host);
  const method = String(req.method ?? "GET").toUpperCase();
  // A public read carries no credential and follows no redirect, so it reaches any host the cap lets through; a credential still needs its registered host.
  const asksPublic = !!publicHost && !found.uses.length && (method === "GET" || method === "HEAD");
  const closed = asksPublic ? (publicHost as PublicHost)(host) : null;
  if (asksPublic && closed === null && !rule?.methods.includes(method)) rule = { host, methods: ["GET", "HEAD"], credentials: [] };
  if (!rule) {
    // A reference no host lists is not a saved credential: said as such, before the host is.
    const unknown = found.uses.find((u) => !known(u.ref));
    if (unknown) return fail("EGRESS_CRED_UNKNOWN", `${unknown.ref} is not a saved credential`, host, unknown.ref);
    return fail("EGRESS_HOST_DENIED", closed ? `${host} cannot be read: ${closed}` : `${host} is not a listed host`, host, found.uses[0]?.ref);
  }
  if (!rule.methods.includes(method) && !rule.credentials.some((c) => c.methods.includes(method))) return fail("EGRESS_METHOD_DENIED", `${method} is not allowed to ${host}`, host);
  for (const use of found.uses) {
    const slot = rule.credentials.find((c) => c.ref === use.ref);
    if (!slot) return known(use.ref) ? fail("EGRESS_CRED_HOST_DENIED", `${use.ref} may not be sent to ${host}`, host, use.ref) : fail("EGRESS_CRED_UNKNOWN", `${use.ref} is not a saved credential`, host, use.ref);
    // The credential's declaration fixes where its value stands; a placement it does not declare is refused.
    if (!slot.placements.some((p) => samePlacement(p, use.placement))) {
      const allowed = slot.placements.map(placementWords).join(" or ") || "nowhere on a request";
      return fail("EGRESS_CRED_PLACEMENT", `${use.ref} goes to ${host} only in ${allowed}, not in ${placementWords(use.placement)}`, host);
    }
    if (!slot.methods.includes(method)) return fail("EGRESS_METHOD_DENIED", `${method} is not allowed to ${host} with ${use.ref}`, host);
  }
  // A request without a credential reaches only a host's own methods.
  if (!found.uses.length && !rule.methods.includes(method)) return fail("EGRESS_METHOD_DENIED", `${method} is not allowed to ${host} without a credential`, host);
  return { ok: true, url, method, rule, headers: found.headers, uses: found.uses, ...(req.body !== undefined ? { body: String(req.body) } : {}) };
}

export type PlannedFill = { ok: true; url: URL; host: string } | EgressFailure;

/** A fill types a reference's value into a form on a listed host; the page's address decides the host. */
export function planFill(req: { url: string; ref: string }, hosts: readonly HostRule[]): PlannedFill {
  let url: URL;
  try {
    url = new URL(String(req?.url ?? ""));
  } catch {
    return fail("EGRESS_URL_INVALID", "the page address does not parse");
  }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== "https:") return fail("EGRESS_SCHEME_DENIED", `only https pages take a credential, not ${url.protocol}`, host);
  if (url.username || url.password || url.port) return fail("EGRESS_URL_INVALID", "the page address carries userinfo or a port", host);
  const ref = String(req?.ref ?? "");
  if (!CRED_REF.test(ref)) return fail("EGRESS_CRED_UNKNOWN", "a credential is named cred://<name>", host);
  if (!hosts.some((r) => r.credentials.some((c) => c.ref === ref))) return fail("EGRESS_CRED_UNKNOWN", `${ref} is not a saved credential`, host);
  const rule = hosts.find((r) => r.host === host);
  if (!rule) return fail("EGRESS_HOST_DENIED", `${host} is not a listed host`, host);
  if (!rule.credentials.some((c) => c.ref === ref && c.fill)) return fail("EGRESS_CRED_HOST_DENIED", `${ref} may not be typed into a page on ${host}`, host);
  return { ok: true, url, host };
}

/** Replaces every occurrence of each secret in `text` with a marker naming its reference. */
export function redact(text: string, secrets: ReadonlyArray<{ ref: string; value: string }>): string {
  let out = text;
  for (const s of secrets) if (s.value) out = out.split(s.value).join(`[redacted ${s.ref}]`);
  return out;
}
