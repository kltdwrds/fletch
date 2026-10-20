// The secure capture form and the credential settings (M13). A person stores a value here, in person,
// and nowhere else: the form posts to the tenant's own host, the value goes straight to the `Vault`,
// and no response carries it back (every page is redacted of the submitted value before it leaves, so
// a value typed into the wrong field is not echoed either). The registry entries are written by the
// same act, as the signed-in person; the model has no route here (egress refuses platform hosts) and
// no tool that writes. Writes must come from the page's own origin.
import { redact } from "../egress/policy.ts";
import type { CredentialInfo, GrantInfo, PutResult, Refused } from "../vault/core.ts";
import type { HostEntry, Writer } from "../vault/hosts.ts";

export interface VaultDirectory {
  capture(input: { ref: string; value: string; label?: string; permission?: "standing" | "grant"; kind?: "secret" | "login"; hosts: unknown[] }, writer: Writer): Promise<PutResult>;
  registerHost(input: unknown, writer: Writer): Promise<{ ok: true; entry: HostEntry } | Refused>;
  removeHost(ref: string, host: string, writer: Writer): Promise<{ ok: true } | Refused>;
  revoke(ref: string, writer: Writer): Promise<{ ok: true } | Refused>;
  issueGrant(input: { ref: string; hosts: string[]; methods?: string[]; fill?: boolean; oneShot?: boolean; expiresInMs?: number }, writer: Writer): Promise<{ ok: true; grant: GrantInfo } | Refused>;
  revokeGrant(nonce: string, writer: Writer): Promise<{ ok: true } | Refused>;
  approveOneTimeCode(input: { ref: string; host: string }, writer: Writer): Promise<{ ok: true; grant: GrantInfo } | Refused>;
  list(person: string): Promise<CredentialInfo[]>;
  grants(person: string): Promise<GrantInfo[]>;
}

const SECURE_HEADERS = {
  "cache-control": "no-store",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
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
}

const EMPTY: Fields = { ref: "", label: "", host: "", methods: "GET", header: "authorization", prefix: "Bearer ", fills: false, permission: "standing", kind: "secret" };

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
<label for="kind">Kind</label><select id="kind" name="kind">${opt("kind", "secret", "API key or token")}${opt("kind", "login", "Login password")}</select>
<label for="permission">Use</label><select id="permission" name="permission">${opt("permission", "standing", "My agent may use it at this host")}${opt("permission", "grant", "Only under a grant I give each time")}</select>
<label for="value">Value</label><input id="value" name="value" type="password" required autocomplete="off" spellcheck="false">
<button type="submit">Save</button></form></body></html>`;
}

const page = (html: string, status = 200) => new Response(html, { status, headers: { ...SECURE_HEADERS, "content-type": "text/html; charset=utf-8" } });

function fieldsOf(form: FormData | URLSearchParams): Fields {
  const get = (k: string) => String(form.get(k) ?? "");
  return {
    ref: get("ref").trim(), label: get("label").trim(), host: get("host").trim(), methods: get("methods") || EMPTY.methods, header: get("header") || EMPTY.header,
    prefix: form.has("prefix") ? get("prefix") : EMPTY.prefix, fills: get("fills") === "on", permission: get("permission") || EMPTY.permission, kind: get("kind") || EMPTY.kind,
  };
}

/** A write must come from the tenant's own page: a cross-site form or script carries another origin. */
const sameOrigin = (request: Request, url: URL) => request.headers.get("origin") === url.origin;

export async function vaultRoutes(request: Request, url: URL, person: string, dir: VaultDirectory | undefined): Promise<Response | null> {
  if (!url.pathname.startsWith("/vault")) return null;
  if (!dir) return json({ code: "VAULT_UNAVAILABLE" }, 503);
  const writer = (via: Writer["via"]): Writer => ({ kind: "person", person, via });

  if (url.pathname === "/vault/capture" && request.method === "GET") {
    // A link may prefill the name and host (the agent can ask for a credential); only the person submits it.
    return page(captureForm({ ...EMPTY, ...fieldsOf(url.searchParams), fills: url.searchParams.get("fills") === "on" }));
  }
  if (url.pathname === "/vault/capture" && request.method === "POST") {
    if (!sameOrigin(request, url)) return page(captureForm(EMPTY, { code: "VAULT_FORM_ORIGIN", reason: "the form is submitted from this site's own page" }), 403);
    const form = await request.formData().catch(() => null);
    if (!form) return page(captureForm(EMPTY, { code: "VAULT_FORM_INVALID", reason: "the form did not arrive" }), 400);
    const f = fieldsOf(form);
    const value = String(form.get("value") ?? "");
    const methods = f.methods.split(/[\s,]+/).filter(Boolean);
    const r = await dir.capture(
      { ref: f.ref, value, label: f.label, kind: f.kind === "login" ? "login" : "secret", permission: f.permission === "grant" ? "grant" : "standing", hosts: [{ host: f.host, methods, header: f.header, prefix: f.prefix, fills: f.fills }] },
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
    case "/vault/revoke":
      return answer(await dir.revoke(String(body.ref ?? ""), writer("settings")));
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
