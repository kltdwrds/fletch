// OAuth connectors on the default (F55; D-0016 is proposed, and this is built on its recommended option as the
// overnight Defaults allow: reject the record and this file, the `oauth_states` table, the `oauth` kind, the callback
// route, the form's scheme, the tool parameter and the codes it names are deleted outright). The person's own browser
// carries the consent: the capture form's submit mints one `state` here (16 random bytes, ten minutes, the client id
// and secret sealed as a credential is) and answers a 303 to the provider's authorize URL; the provider sends the
// person back to `/connect/oauth/callback`, where the state is spent once, in the transaction that reads it, by its
// own person, and only then is the code exchanged at the token URL from inside this object. The tokens are one sealed
// `oauth` row bound to the hosts the person named; the access token is refreshed only on the egress path, at use,
// where a value is already revealed, and every call to the provider writes its audit row. Nothing here returns a value.
import { type AuditRow, type EgressContext, RESPONSE_MAX, type Revealed } from "../egress/module.ts";
import { CRED_REF } from "../egress/policy.ts";
import { captureState } from "./connections.ts";
import { checkEntry, checkHost, checkWriter, type HostEntry } from "./hosts.ts";
import { type Refused, SealedVault } from "./sealed.ts";

/** The redirect route on the agent's own origin; the provider is told this address and nothing else. */
export const OAUTH_CALLBACK = "/connect/oauth/callback";
/** A state's life: the time the person has to finish the provider's consent page. */
export const STATE_TTL_MS = 10 * 60_000;
/** An access token this close to its end is refreshed before it is used. */
export const REFRESH_EARLY_MS = 60_000;
const VALUE_MAX = 8 * 1024;
const CLIENT_ID = /^[\x21-\x7e]{1,512}$/;
const SCOPE_WORD = /^[\x21-\x7e]{1,200}$/;
const STATE = /^[0-9a-f]{32}$/;
/** A provider's `error` parameter is shown by name only when it is a plain code (`access_denied`). */
const ERROR_NAME = /^[A-Za-z0-9_.-]{1,64}$/;

/** What the capture form's `oauth` scheme submits; `clientSecret` is the form's value field. */
export interface OAuthSetup {
  ref: string;
  label?: string;
  permission?: "standing" | "grant";
  hosts: string[];
  methods: string[];
  clientId: string;
  clientSecret: string;
  authorizeUrl: string;
  tokenUrl: string;
  revokeUrl?: string;
  scope?: string;
  setup?: string;
}

/** The sealed value of an `oauth` row. */
interface OAuthValue {
  client_id: string;
  client_secret: string;
  token_url: string;
  revoke_url: string | null;
  scope: string;
  refresh_token: string;
  access_token: string;
  access_expires_at: number | null;
}

const refuse = (code: string, reason: string): Refused => ({ ok: false, code, reason });
const hex = (bytes: Uint8Array) => [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
/** The name a state's client configuration is sealed under: never a reference, so it opens nowhere else. */
const stateName = (ref: string, state: string) => `${ref}#oauth-state:${state}`;
const refusedRefresh = (reason: string): Revealed => ({ ok: false, code: "EGRESS_OAUTH_REFRESH_FAILED", reason });

/** An https endpoint whose host passes the policy cap: a path and a query may follow, never a port, a login or a fragment. */
export function checkEndpoint(raw: unknown, what: string): { ok: true; url: URL } | Refused {
  let url: URL;
  try {
    url = new URL(String(raw ?? "").trim());
  } catch {
    return refuse("VAULT_HOST_INVALID", `the ${what} does not parse`);
  }
  if (url.protocol !== "https:") return refuse("VAULT_HOST_SCHEME_DENIED", `the ${what} is https only, not ${url.protocol}`);
  if (url.username || url.password || url.port || url.hash) return refuse("VAULT_HOST_INVALID", `the ${what} carries a port, a login or a fragment`);
  const host = checkHost(url.hostname);
  return host.ok ? { ok: true, url } : refuse(host.code, `the ${what}: ${host.reason}`);
}

function grantOf(text: string): OAuthValue | null {
  try {
    const v = JSON.parse(text) as OAuthValue;
    return typeof v?.access_token === "string" && typeof v.token_url === "string" ? v : null;
  } catch {
    return null;
  }
}

export abstract class OAuthVault extends SealedVault {
  /** The egress calls in flight: only a call holding one of these may refresh a token. */
  private readonly paths = new WeakSet<object>();
  private readonly refreshing = new Map<string, Promise<Revealed>>();

  /** Runs one call of the egress path; `fn` gets the path's token, which a refresh must present. */
  protected async onEgressPath<T>(fn: (path: object) => Promise<T>): Promise<T> {
    const path = {};
    this.paths.add(path);
    try {
      return await fn(path);
    } finally {
      this.paths.delete(path);
    }
  }

  /**
   * The capture form's `oauth` submit: checks everything the person typed, mints one state, writes no credential, and
   * answers where the person's browser goes next, the authorize URL with the agent's callback and no secret in it.
   */
  async oauthBegin(input: OAuthSetup, writer: unknown, origin: string): Promise<{ ok: true; location: string } | Refused> {
    const w = checkWriter(writer);
    if (!w.ok) return w;
    const owner = w.value.person;
    const i = input ?? ({} as OAuthSetup);
    const ref = String(i.ref ?? "");
    if (!CRED_REF.test(ref) || /^cred:\/\/(otp|typed|browser|company)-/.test(ref)) return refuse("VAULT_REF_INVALID", "a reference is cred://<name>; otp-, typed-, browser- and company- names are the platform's");
    if (i.setup !== undefined && captureState((q, ...b) => this.sql(q, ...b), owner, ref, i.setup).state === "dismissed") return refuse("VAULT_REF_INVALID", "this setup was dismissed; ask for a new link");
    const clientId = String(i.clientId ?? "").trim();
    if (!CLIENT_ID.test(clientId)) return refuse("VAULT_VALUE_INVALID", "a client id is 1 to 512 printable characters");
    if (typeof i.clientSecret !== "string" || !i.clientSecret || i.clientSecret.length > 1024) return refuse("VAULT_VALUE_INVALID", "a client secret is 1 to 1024 characters");
    const scopes = String(i.scope ?? "").split(/\s+/).filter(Boolean);
    if (scopes.length > 50 || scopes.some((s) => !SCOPE_WORD.test(s))) return refuse("VAULT_VALUE_INVALID", "scopes are up to 50 words of printable characters");
    const authorize = checkEndpoint(i.authorizeUrl, "authorize URL");
    if (!authorize.ok) return authorize;
    const token = checkEndpoint(i.tokenUrl, "token URL");
    if (!token.ok) return token;
    const revoke = i.revokeUrl ? checkEndpoint(i.revokeUrl, "revoke URL") : null;
    if (revoke && !revoke.ok) return revoke;
    const permission = i.permission ?? "standing";
    if (permission !== "standing" && permission !== "grant") return refuse("VAULT_PERMISSION_INVALID", "a permission is standing or grant");
    if (!Array.isArray(i.hosts) || !i.hosts.length) return refuse("VAULT_HOSTS_INVALID", "a connection names at least one host its token is sent to");
    const entries: HostEntry[] = [];
    for (const host of i.hosts) {
      const e = checkEntry({ ref, host, methods: i.methods, header: "authorization", prefix: "Bearer ", fills: false });
      if (!e.ok) return e;
      entries.push(e.value);
    }
    let callback: URL;
    try {
      callback = new URL(OAUTH_CALLBACK, origin);
    } catch {
      return refuse("VAULT_FORM_ORIGIN", "the form is submitted from this site's own page");
    }
    if (callback.protocol !== "https:" && callback.protocol !== "http:") return refuse("VAULT_FORM_ORIGIN", "the form is submitted from this site's own page");
    const now = this.deps.now();
    this.sql("DELETE FROM oauth_states WHERE expires_at <= ?", now);
    const state = hex(crypto.getRandomValues(new Uint8Array(16)));
    const sealed = await this.seal(owner, stateName(ref, state), JSON.stringify({ client_id: clientId, client_secret: i.clientSecret }));
    if (!sealed.ok) return sealed;
    this.sql(
      "INSERT INTO oauth_states (state, owner, ref, label, hosts, permission, authorize_url, token_url, revoke_url, scope, redirect_uri, iv, ct, created_at, expires_at, spent_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)",
      state, owner, ref, String(i.label || ref.slice("cred://".length)).slice(0, 80), JSON.stringify(entries), permission, authorize.url.href, token.url.href, revoke?.url.href ?? null, scopes.join(" "), callback.href, sealed.iv, sealed.ct, now, now + STATE_TTL_MS,
    );
    const to = new URL(authorize.url.href);
    to.searchParams.set("response_type", "code");
    to.searchParams.set("client_id", clientId);
    to.searchParams.set("redirect_uri", callback.href);
    if (scopes.length) to.searchParams.set("scope", scopes.join(" "));
    to.searchParams.set("state", state);
    return { ok: true, location: to.href };
  }

  /**
   * The provider's redirect back, as the signed-in person: the state is spent once, by its own person, inside its ten
   * minutes, or refused `VAULT_OAUTH_STATE_INVALID` with nothing fetched; then the code is exchanged here and the
   * tokens are stored as one `oauth` row with its hosts and a `captured` event. A provider's `error` stores nothing.
   */
  async oauthCallback(input: { state?: string; code?: string; error?: string }, writer: unknown): Promise<{ ok: true; ref: string; hosts: string[] } | Refused> {
    const w = checkWriter(writer);
    if (!w.ok) return w;
    const person = w.value.person;
    const state = String(input?.state ?? "");
    const now = this.deps.now();
    const row = this.ctx.storage.transactionSync(() => {
      const r = STATE.test(state) ? this.sql("SELECT * FROM oauth_states WHERE state = ?", state)[0] : undefined;
      this.sql("DELETE FROM oauth_states WHERE expires_at <= ?", now);
      if (!r || r.owner !== person || r.spent_at !== null || Number(r.expires_at) <= now) return null;
      // Spent where it is read: a second callback with this state finds it spent, and the sealed client is gone.
      this.sql("UPDATE oauth_states SET spent_at = ?, iv = ?, ct = ? WHERE state = ?", now, new Uint8Array(0), new Uint8Array(0), state);
      return r;
    });
    if (!row) return refuse("VAULT_OAUTH_STATE_INVALID", "this sign-in is unknown, already used, expired or not yours; nothing was saved. Start again from the form");
    const ref = String(row.ref);
    const error = String(input?.error ?? "");
    if (error) return refuse("VAULT_OAUTH_REJECTED", `the provider answered ${ERROR_NAME.test(error) ? error : "with an error"}; nothing was saved`);
    const code = String(input?.code ?? "");
    if (!code || code.length > 4096) return refuse("VAULT_OAUTH_REJECTED", "the provider sent no code back; nothing was saved");
    const opened = await this.openSealed(person, stateName(ref, state), row.iv as Uint8Array, row.ct as Uint8Array);
    if (!opened.ok) return refuse("VAULT_LOCKED", opened.reason);
    const client = JSON.parse(opened.value) as { client_id: string; client_secret: string };
    const got = await this.tokenCall(
      String(row.token_url),
      { grant_type: "authorization_code", code, redirect_uri: String(row.redirect_uri), client_id: client.client_id, client_secret: client.client_secret },
      { ref, person, purpose: "oauth code exchange", outcome: "resolved", what: "token URL" },
      true,
    );
    if (!got.ok) return refuse("VAULT_OAUTH_REJECTED", `the provider did not exchange the code (${got.why}); nothing was saved`);
    const value: OAuthValue = {
      client_id: client.client_id, client_secret: client.client_secret, token_url: String(row.token_url), revoke_url: row.revoke_url === null ? null : String(row.revoke_url),
      scope: typeof got.body.scope === "string" ? got.body.scope : String(row.scope), refresh_token: typeof got.body.refresh_token === "string" ? got.body.refresh_token : "",
      access_token: String(got.body.access_token), access_expires_at: this.expiryOf(got.body),
    };
    const text = JSON.stringify(value);
    if (text.length > VALUE_MAX) return refuse("VAULT_VALUE_INVALID", `the provider's tokens are over ${VALUE_MAX} characters; nothing was saved`);
    const sealed = await this.seal(person, ref, text);
    if (!sealed.ok) return sealed;
    const entries = JSON.parse(String(row.hosts)) as HostEntry[];
    this.ctx.storage.transactionSync(() => {
      this.sql(
        "INSERT OR REPLACE INTO secrets (owner, ref, label, kind, permission, iv, ct, created_at, expires_at, revoked_at) VALUES (?, ?, ?, 'oauth', ?, ?, ?, ?, NULL, NULL)",
        person, ref, String(row.label), String(row.permission), sealed.iv, sealed.ct, this.deps.now(),
      );
      this.sql("DELETE FROM credential_hosts WHERE owner = ? AND ref = ?", person, ref);
      for (const e of entries) this.writeEntry(person, e, person, "capture-form");
      this.event(person, ref, "captured", person, `capture-form; oauth; ${entries.map((e) => e.host).join(", ")}`);
    });
    return { ok: true, ref, hosts: entries.map((e) => e.host) };
  }

  /** The access token of an `oauth` row, refreshed first on the egress path when it ends within a minute. */
  protected async oauthToken(owner: string, ref: string, path: object | null, ctx: EgressContext): Promise<Revealed> {
    const opened = await this.open(owner, ref);
    if (!opened.ok) return opened;
    const v = grantOf(opened.value);
    if (!v) return { ok: false, code: "EGRESS_VAULT_LOCKED", reason: `${ref} does not hold an OAuth grant` };
    if (v.access_expires_at === null || v.access_expires_at - REFRESH_EARLY_MS > this.deps.now()) return { ok: true, value: v.access_token };
    return this.refreshOAuth(owner, ref, path, ctx);
  }

  /** The refresh: a method of the egress path and nowhere else, so a call without that path's token is refused. */
  protected refreshOAuth(owner: string, ref: string, path: object | null, ctx: EgressContext): Promise<Revealed> {
    if (!path || !this.paths.has(path)) return Promise.resolve(refusedRefresh(`${ref} is refreshed only on the egress path, at use`));
    const key = `${owner}\n${ref}`;
    // Two uses at once share one refresh, so the provider sees one rotation.
    const running = this.refreshing.get(key) ?? this.refresh(owner, ref, ctx).finally(() => this.refreshing.delete(key));
    this.refreshing.set(key, running);
    return running;
  }

  private async refresh(owner: string, ref: string, ctx: EgressContext): Promise<Revealed> {
    const opened = await this.open(owner, ref);
    if (!opened.ok) return opened;
    const v = grantOf(opened.value);
    if (!v?.refresh_token) return refusedRefresh(`${ref}'s access token has ended and the provider gave no refresh token; connect it again`);
    const got = await this.tokenCall(
      v.token_url,
      { grant_type: "refresh_token", refresh_token: v.refresh_token, client_id: v.client_id, client_secret: v.client_secret },
      { ref, person: ctx.person, purpose: ctx.purpose, outcome: "refreshed", what: "token URL" },
      true,
    );
    if (!got.ok) {
      if (got.status === 400 || got.status === 401 || got.status === 403) this.event(owner, ref, "rejected", "provider", `HTTP ${got.status}; refresh`);
      return refusedRefresh(`the provider did not refresh ${ref} (${got.why}); nothing was sent`);
    }
    const next: OAuthValue = {
      ...v, access_token: String(got.body.access_token), access_expires_at: this.expiryOf(got.body),
      ...(typeof got.body.refresh_token === "string" && got.body.refresh_token ? { refresh_token: got.body.refresh_token } : {}),
      ...(typeof got.body.scope === "string" ? { scope: got.body.scope } : {}),
    };
    const sealed = await this.seal(owner, ref, JSON.stringify(next));
    if (!sealed.ok) return refusedRefresh(sealed.reason);
    this.sql("UPDATE secrets SET iv = ?, ct = ? WHERE owner = ? AND ref = ? AND revoked_at IS NULL", sealed.iv, sealed.ct, owner, ref);
    return { ok: true, value: next.access_token };
  }

  /** After a local revoke: the refresh token posted once to the provider's revoke URL; a failure is a `rejected` event. */
  protected async oauthRevoke(owner: string, ref: string): Promise<void> {
    const opened = await this.open(owner, ref);
    const v = opened.ok ? grantOf(opened.value) : null;
    if (!v?.revoke_url) return;
    const got = await this.tokenCall(
      v.revoke_url,
      { token: v.refresh_token || v.access_token, token_type_hint: v.refresh_token ? "refresh_token" : "access_token", client_id: v.client_id, client_secret: v.client_secret },
      { ref, person: owner, purpose: "oauth revoke", outcome: "resolved", what: "revoke URL" },
      false,
    );
    if (!got.ok) this.event(owner, ref, "rejected", "provider", `${got.why}; revoke`);
  }

  private expiryOf(body: Record<string, unknown>): number | null {
    const s = Number(body.expires_in);
    return Number.isFinite(s) && s > 0 ? this.deps.now() + s * 1000 : null;
  }

  /** One POST to the provider from inside this object, its audit row written whatever comes of it; never a value in the row. */
  private async tokenCall(
    endpoint: string,
    form: Record<string, string>,
    a: { ref: string; person: string; purpose: string; outcome: "resolved" | "refreshed"; what: string },
    tokens: boolean,
  ): Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; status: number | null; why: string }> {
    const checked = checkEndpoint(endpoint, a.what);
    const at = checked.ok ? checked.url : null;
    const row = (outcome: AuditRow["outcome"], purpose = a.purpose) =>
      this.writeAudit({ at: this.deps.now(), ref: a.ref, host: at?.hostname ?? "", method: "POST", path: at?.pathname ?? "", person: a.person, purpose, outcome });
    if (!checked.ok) {
      row("EGRESS_HOST_POLICY");
      return { ok: false, status: null, why: checked.reason };
    }
    let status: number;
    let text: string;
    try {
      const res = await this.deps.fetch(checked.url.href, {
        method: "POST", redirect: "manual", body: new URLSearchParams(form).toString(),
        headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      });
      status = res.status;
      text = await res.text();
    } catch {
      row("EGRESS_UPSTREAM_FAILED");
      return { ok: false, status: null, why: "the provider could not be reached" };
    }
    if (status < 200 || status > 299) {
      row("rejected", `${a.purpose}: HTTP ${status}`);
      return { ok: false, status, why: `HTTP ${status}` };
    }
    let body: Record<string, unknown> = {};
    try {
      const parsed: unknown = text && text.length <= RESPONSE_MAX ? JSON.parse(text) : {};
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) body = parsed as Record<string, unknown>;
    } catch {}
    if (tokens && (typeof body.access_token !== "string" || !body.access_token)) {
      row("rejected", `${a.purpose}: HTTP ${status}, no access token`);
      return { ok: false, status, why: "no access token in the answer" };
    }
    row(a.outcome);
    return { ok: true, body };
  }
}
