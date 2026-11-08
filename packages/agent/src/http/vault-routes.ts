// The secure capture form and the credential settings (M13). A person stores a value here, in person,
// and nowhere else: the form posts to the tenant's own host, the value goes straight to the `Vault`,
// and no response carries it back (every page is redacted of the submitted value before it leaves, so
// a value typed into the wrong field is not echoed either). The registry entries are written by the
// same act, as the signed-in person; the model has no route here (egress refuses platform hosts) and
// no tool that writes. Writes must come from the page's own origin. From F36 (P9 deltas 1 and 6) the chat's capture
// item reads a setup's state here and its Dismiss voids the link, and a revoke (the Connected row's Disconnect) also
// ends the person's grants that name the credential, in their `Person`; a part of that which fails is said by code.
// From F55 (D-0016 proposed, built on the default and deleted with it) the form takes a third scheme, `oauth`: its
// submit answers a 303 to the provider's consent page, and the provider's redirect back lands on `OAUTH_CALLBACK`.
import { redact } from "../egress/policy.ts";
import type { CredentialInfo, GrantInfo, PutResult, Refused } from "../vault/core.ts";
import type { HostEntry, Writer } from "../vault/hosts.ts";
import { OAUTH_CALLBACK, type OAuthSetup } from "../vault/oauth.ts";

export interface VaultDirectory {
  capture(input: { ref: string; value: string; label?: string; permission?: "standing" | "grant"; kind?: "secret" | "login"; hosts: unknown[] }, writer: Writer): Promise<PutResult>;
  registerHost(input: unknown, writer: Writer): Promise<{ ok: true; entry: HostEntry } | Refused>;
  removeHost(ref: string, host: string, writer: Writer): Promise<{ ok: true } | Refused>;
  revoke(ref: string, writer: Writer): Promise<{ ok: true } | Refused>;
  /** The person's grants that name a credential, ended in their `Person` when it is revoked (F36). */
  revokeNaming(ref: string, person: string): Promise<{ ok: true; revoked: string[] } | { ok: false; code: string }>;
  dismissCapture(ref: string, writer: Writer, setup?: string): Promise<{ ok: true } | Refused>;
  captureState(person: string, ref: string, setup?: string): Promise<{ state: "pending" | "entered" | "dismissed"; at: number | null }>;
  issueGrant(input: { ref: string; hosts: string[]; methods?: string[]; fill?: boolean; oneShot?: boolean; expiresInMs?: number }, writer: Writer): Promise<{ ok: true; grant: GrantInfo } | Refused>;
  revokeGrant(nonce: string, writer: Writer): Promise<{ ok: true } | Refused>;
  approveOneTimeCode(input: { ref: string; host: string }, writer: Writer): Promise<{ ok: true; grant: GrantInfo } | Refused>;
  list(person: string): Promise<CredentialInfo[]>;
  grants(person: string): Promise<GrantInfo[]>;
  /** The `oauth` scheme's submit (F55): a state minted, where the person's browser goes next. */
  oauthBegin?(input: OAuthSetup, writer: Writer, origin: string): Promise<{ ok: true; location: string } | Refused>;
  /** The provider's redirect back (F55): the state spent, the code exchanged, the connection stored. */
  oauthCallback?(input: { state?: string; code?: string; error?: string }, writer: Writer): Promise<{ ok: true; ref: string; hosts: string[] } | Refused>;
}

const SECURE_HEADERS = {
  "cache-control": "no-store",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  // `https:` beside 'self' (F55): a browser holds a form's redirect to the form-action list, and the `oauth` submit's 303 goes to the provider.
  "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self' https:; frame-ancestors 'none'; base-uri 'none'",
};
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: SECURE_HEADERS });
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** The form's fields, as typed; the value is never among what is shown back. */
interface Fields {
  ref: string;
  label: string;
  host: string;
  methods: string;
  header: string;
  prefix: string;
  fills: boolean;
  permission: string;
  kind: string;
  /** The link's setup id (`credential_request`), carried to the submit so a dismissed setup saves nothing. */
  setup: string;
  /** The `oauth` scheme's fields (F55); the value field is the client secret. */
  client_id?: string;
  authorize_url?: string;
  token_url?: string;
  revoke_url?: string;
  scope?: string;
}

const EMPTY: Fields = { ref: "", label: "", host: "", methods: "GET", header: "authorization", prefix: "Bearer ", fills: false, permission: "standing", kind: "secret", setup: "", client_id: "", authorize_url: "", token_url: "", revoke_url: "", scope: "" };
const OAUTH_FIELDS = ["client_id", "authorize_url", "token_url", "revoke_url", "scope"] as const;

/** The `oauth` scheme's fields, open when the link or the submit named that kind; the Kind select switches to it. */
function oauthFields(f: Fields): string {
  const open = f.kind === "oauth";
  const input = (name: (typeof OAUTH_FIELDS)[number], label: string, need: boolean, hint = "") =>
    `<label for="${name}">${label}</label><input id="${name}" name="${name}"${need && open ? " required" : ""}${hint ? ` placeholder="${esc(hint)}"` : ""} value="${esc(f[name] ?? "")}">`;
  return `<details${open ? " open" : ""}><summary>OAuth connection: the provider's consent page (choose that Kind)</summary>
<p>Hosts above are where the token is sent, separated by spaces. The value below is the client secret.</p>
${input("client_id", "Client id", true)}${input("authorize_url", "Authorize URL", true, "https://provider.example/oauth/authorize")}${input("token_url", "Token URL", true, "https://provider.example/oauth/token")}${input("revoke_url", "Revoke URL (optional)", false)}${input("scope", "Scopes", false, "read write")}</details>`;
}

export function captureForm(f: Fields, message?: { code: string; reason: string } | { saved: string; hosts: string }): string {
  const note = !message
    ? ""
    : "saved" in message
      ? `<p role="status">Saved <code>${esc(message.saved)}</code> for ${esc(message.hosts)}. The value is sealed in your vault and will not be shown again.</p>`
      : `<p role="alert"><strong>${esc(message.code)}</strong>: ${esc(message.reason)}. Nothing was saved; type the value again.</p>`;
  const opt = (name: string, value: string, label: string) => `<option value="${esc(value)}"${f[name as keyof Fields] === value ? " selected" : ""}>${esc(label)}</option>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Save a credential</title>
<style>body{font:16px/1.5 system-ui,sans-serif;margin:0 auto;max-width:34rem;padding:1rem;color:#1d1d1f;background:#fbfbfa}label{display:block;margin:.75rem 0 .25rem}input,select{width:100%;box-sizing:border-box;padding:.5rem;font:inherit}button{margin-top:1rem;padding:.6rem 1rem;font:inherit}[role=alert]{color:#8a1c1c}</style></head>
<body><h1>Save a credential</h1>${note}
<p>Your agent will know only that this credential exists, its name and where it may be used. It never sees the value.</p>
<form method="post" action="/vault/capture" autocomplete="off">
<label for="ref">Name</label><input id="ref" name="ref" required pattern="cred://[a-z][a-z0-9-]{0,62}" value="${esc(f.ref || "cred://")}">
<label for="label">Description</label><input id="label" name="label" maxlength="80" value="${esc(f.label)}">
<label for="host">Host it may be sent to (https only)</label><input id="host" name="host" required placeholder="login.example.com" value="${esc(f.host)}">
<label for="methods">Methods</label><input id="methods" name="methods" value="${esc(f.methods)}">
<label for="header">Header</label><input id="header" name="header" value="${esc(f.header)}">
<label for="prefix">Before the value</label><input id="prefix" name="prefix" value="${esc(f.prefix)}">
<label><input type="checkbox" name="fills" value="on"${f.fills ? " checked" : ""} style="width:auto"> May be typed into a login page on this host</label>
<label for="kind">Kind</label><select id="kind" name="kind">${opt("kind", "secret", "API key or token")}${opt("kind", "login", "Login password")}${opt("kind", "oauth", "OAuth connection")}</select>
${oauthFields(f)}
<label for="permission">Use</label><select id="permission" name="permission">${opt("permission", "standing", "My agent may use it at this host")}${opt("permission", "grant", "Only under a grant I give each time")}</select>
<label for="value">${f.kind === "oauth" ? "Client secret" : "Value"}</label><input id="value" name="value" type="password" required autocomplete="off" spellcheck="false">
${f.setup ? `<input type="hidden" name="setup" value="${esc(f.setup)}">` : ""}<button type="submit">Save</button></form></body></html>`;
}

/** A dismissed setup's link: it says so, and opens no form. */
const voidPage = (ref: string) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Link no longer open</title></head><body><h1>Link no longer open</h1><p role="alert"><strong>VAULT_REF_INVALID</strong>: the setup for <code>${esc(ref)}</code> was dismissed in the chat. Nothing was saved; ask your agent for a new link.</p></body></html>`;

const page = (html: string, status = 200) => new Response(html, { status, headers: { ...SECURE_HEADERS, "content-type": "text/html; charset=utf-8" } });

function fieldsOf(form: FormData | URLSearchParams): Fields {
  const get = (k: string) => String(form.get(k) ?? "");
  return {
    ref: get("ref").trim(), label: get("label").trim(), host: get("host").trim(), methods: get("methods") || EMPTY.methods, header: get("header") || EMPTY.header,
    prefix: form.has("prefix") ? get("prefix") : EMPTY.prefix, fills: get("fills") === "on", permission: get("permission") || EMPTY.permission, kind: get("kind") || EMPTY.kind,
    setup: get("setup").trim(), ...Object.fromEntries(OAUTH_FIELDS.map((k) => [k, get(k).trim()])),
  };
}

/** What the provider's redirect back shows: the connection saved, named with its hosts, or the refusal by code; never a value. */
const callbackPage = (r: { ok: true; ref: string; hosts: string[] } | Refused) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${r.ok ? "Connected" : "Not connected"}</title></head><body><h1>${r.ok ? "Connected" : "Not connected"}</h1>${
    r.ok
      ? `<p role="status">Saved <code>${esc(r.ref)}</code> for ${esc(r.hosts.join(", "))}. The token is sealed in your vault and will not be shown again.</p>`
      : `<p role="alert"><strong>${esc(r.code)}</strong>: ${esc(r.reason)}.</p>`
  }</body></html>`;

/** A write must come from the tenant's own page: a cross-site form or script carries another origin. */
const sameOrigin = (request: Request, url: URL) => request.headers.get("origin") === url.origin;

export async function vaultRoutes(request: Request, url: URL, person: string, dir: VaultDirectory | undefined): Promise<Response | null> {
  if (!url.pathname.startsWith("/vault") && url.pathname !== OAUTH_CALLBACK) return null;
  if (!dir) return json({ code: "VAULT_UNAVAILABLE" }, 503);
  const writer = (via: Writer["via"]): Writer => ({ kind: "person", person, via });

  if (url.pathname === "/vault/capture" && request.method === "GET") {
    // A link may prefill the name and host (the agent can ask for a credential); only the person submits it. A link
    // whose setup the person dismissed in the chat is void: it opens no form.
    const ref = url.searchParams.get("ref");
    if (ref && (await dir.captureState(person, ref, url.searchParams.get("setup") ?? "")).state === "dismissed") return page(voidPage(ref), 410);
    return page(captureForm({ ...EMPTY, ...fieldsOf(url.searchParams), fills: url.searchParams.get("fills") === "on" }));
  }
  if (url.pathname === OAUTH_CALLBACK && request.method === "GET") {
    if (!dir.oauthCallback) return json({ code: "VAULT_UNAVAILABLE" }, 503);
    const q = (k: string) => url.searchParams.get(k) ?? undefined;
    const r = await dir.oauthCallback({ state: q("state"), code: q("code"), error: q("error") }, writer("capture-form"));
    return page(callbackPage(r), r.ok ? 201 : 400);
  }
  if (url.pathname === "/vault/capture/state" && request.method === "GET") {
    return json({ ok: true, ...(await dir.captureState(person, url.searchParams.get("ref") ?? "", url.searchParams.get("setup") ?? "")) });
  }
  if (url.pathname === "/vault/capture" && request.method === "POST") {
    if (!sameOrigin(request, url)) return page(captureForm(EMPTY, { code: "VAULT_FORM_ORIGIN", reason: "the form is submitted from this site's own page" }), 403);
    const form = await request.formData().catch(() => null);
    if (!form) return page(captureForm(EMPTY, { code: "VAULT_FORM_INVALID", reason: "the form did not arrive" }), 400);
    const f = fieldsOf(form);
    const value = String(form.get("value") ?? "");
    const methods = f.methods.split(/[\s,]+/).filter(Boolean);
    if (f.kind === "oauth") {
      // The person's own browser goes to the consent page (F55): nothing is stored until the provider sends them back.
      if (!dir.oauthBegin) return json({ code: "VAULT_UNAVAILABLE" }, 503);
      const o = await dir.oauthBegin(
        {
          ref: f.ref, ...(f.setup ? { setup: f.setup } : {}), label: f.label, permission: f.permission === "grant" ? "grant" : "standing", hosts: f.host.split(/[\s,]+/).filter(Boolean), methods,
          clientId: f.client_id ?? "", clientSecret: value, authorizeUrl: f.authorize_url ?? "", tokenUrl: f.token_url ?? "", ...(f.revoke_url ? { revokeUrl: f.revoke_url } : {}), scope: f.scope ?? "",
        },
        writer("capture-form"),
        url.origin,
      );
      if (o.ok) return new Response(null, { status: 303, headers: { ...SECURE_HEADERS, location: o.location } });
      const html = captureForm(f, { code: o.code, reason: o.reason });
      return page(value ? redact(html, [{ ref: "value", value }]) : html, 400);
    }
    const r = await dir.capture(
      { ref: f.ref, ...(f.setup ? { setup: f.setup } : {}), value, label: f.label, kind: f.kind === "login" ? "login" : "secret", permission: f.permission === "grant" ? "grant" : "standing", hosts: [{ host: f.host, methods, header: f.header, prefix: f.prefix, fills: f.fills }] },
      writer("capture-form"),
    );
    const html = r.ok ? captureForm({ ...EMPTY }, { saved: r.ref, hosts: f.host }) : captureForm(f, { code: r.code, reason: r.reason });
    // Whatever was typed where, the value does not come back.
    return page(value ? redact(html, [{ ref: "value", value }]) : html, r.ok ? 201 : 400);
  }
  if (url.pathname === "/vault" && request.method === "GET") {
    return json({ credentials: await dir.list(person), grants: await dir.grants(person) });
  }
  if (request.method !== "POST") return null;
  if (!sameOrigin(request, url)) return json({ code: "VAULT_FORM_ORIGIN" }, 403);
  const body = ((await request.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  const answer = (r: { ok: boolean; code?: string }, status = 200) => json(r, r.ok ? status : r.code === "VAULT_CRED_UNKNOWN" || r.code === "VAULT_GRANT_UNKNOWN" ? 404 : 400);
  switch (url.pathname) {
    case "/vault/hosts":
      return answer(await dir.registerHost(body, writer("settings")), 201);
    case "/vault/hosts/remove":
      return answer(await dir.removeHost(String(body.ref ?? ""), String(body.host ?? ""), writer("settings")));
    case "/vault/revoke": {
      const ref = String(body.ref ?? "");
      const r = await dir.revoke(ref, writer("settings"));
      if (!r.ok) return answer(r);
      // The credential is revoked; a grant still naming it would be a permission for nothing, so a failure is said.
      const named = await dir.revokeNaming(ref, person).catch(() => ({ ok: false as const, code: "GRANTS_NOT_REVOKED" }));
      return named.ok ? json({ ok: true, grantsRevoked: named.revoked.length }) : json({ ok: false, code: named.code, revoked: ref }, 502);
    }
    case "/vault/capture/dismiss":
      return answer(await dir.dismissCapture(String(body.ref ?? ""), writer("settings"), String(body.setup ?? "")));
    case "/vault/grants":
      return answer(
        await dir.issueGrant(
          {
            ref: String(body.ref ?? ""), hosts: Array.isArray(body.hosts) ? body.hosts.map(String) : [], methods: Array.isArray(body.methods) ? body.methods.map(String) : [],
            fill: body.fill === true, oneShot: body.oneShot === true, ...(typeof body.expiresInMs === "number" ? { expiresInMs: body.expiresInMs } : {}),
          },
          writer("settings"),
        ),
        201,
      );
    case "/vault/grants/revoke":
      return answer(await dir.revokeGrant(String(body.nonce ?? ""), writer("settings")));
    case "/vault/otp/approve":
      return answer(await dir.approveOneTimeCode({ ref: String(body.ref ?? ""), host: String(body.host ?? "") }, writer("settings")), 201);
    default:
      return null;
  }
}
