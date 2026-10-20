// Browser logins that persist (M24.3, spec P3): a live session's Playwright-shaped `storageState`
// (its cookies and its origins' localStorage) is saved per person per site, sealed in the Vault as a
// `browser-state` credential under the tenant data key with the tenant, owner and reference as
// additional data, exactly as every other credential is. It is restored into a freshly acquired live
// session, before its first navigation, only under the person's own signed credential grant for that
// site (`vault/grants.ts`, method RESTORE), which the person issues in settings; the agent cannot mint
// one. Values go from this object to the browser and nowhere else: the chat sees a site and a count.
// The person's forget path removes a site's saved login (`memory/forget.ts`), and offboarding's
// departure removes everything the person keeps here (`purgePerson`, from `Company.depart`).
import { type GrantInfo, VaultCore } from "./core.ts";
import { type CredentialGrant, GRANT_MAX_MS, newNonce, sign } from "./grants.ts";
import { checkHost, checkWriter } from "./hosts.ts";
import type { Refused, VaultCtx, VaultDeps } from "./sealed.ts";

/** The method a restore grant names: not an HTTP method, so no request ever carries this credential. */
export const RESTORE = "RESTORE";
/** The largest sealed state; a site's cookies and storage are far smaller. */
export const STATE_MAX = 256 * 1024;

export interface StateCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  /** Seconds since the epoch; -1 for a session cookie, as Playwright writes it. */
  expires: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite: "Strict" | "Lax" | "None";
}

/** Playwright's `storageState` shape. */
export interface StorageState {
  cookies: StateCookie[];
  origins: Array<{ origin: string; localStorage: Array<{ name: string; value: string }> }>;
}

/** How the Vault reaches a live session: the browser binding's CDP calls (`browse/binding.ts`). */
export interface BrowserStateDeps {
  capture(session: string): Promise<StorageState>;
  restore(session: string, state: StorageState): Promise<void>;
}

export type SaveResult = { ok: true; site: string; ref: string; cookies: number; origins: number } | Refused;
export type RestoreResult = { ok: true; restored: false; site: string } | { ok: true; restored: true; site: string; ref: string; grant: string; cookies: number } | Refused;

const refuse = (code: string, reason: string): Refused => ({ ok: false, code, reason });
const enc = new TextEncoder();
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** A state as the browser gave it, or a reason: only cookies and localStorage of the named shape. */
export function parseStorageState(raw: unknown): { ok: true; state: StorageState } | Refused {
  if (!isObj(raw) || !Array.isArray(raw.cookies) || !Array.isArray(raw.origins)) return refuse("BROWSER_STATE_INVALID", "a state has cookies and origins");
  const cookies: StateCookie[] = [];
  for (const c of raw.cookies) {
    if (!isObj(c) || typeof c.name !== "string" || typeof c.value !== "string" || typeof c.domain !== "string" || !c.domain) return refuse("BROWSER_STATE_INVALID", "a cookie has a name, a value and a domain");
    const sameSite = c.sameSite === "Strict" || c.sameSite === "None" ? c.sameSite : "Lax";
    cookies.push({ name: c.name, value: c.value, domain: c.domain.toLowerCase(), path: typeof c.path === "string" && c.path ? c.path : "/", expires: typeof c.expires === "number" ? c.expires : -1, httpOnly: c.httpOnly === true, secure: c.secure === true, sameSite });
  }
  const origins: StorageState["origins"] = [];
  for (const o of raw.origins) {
    if (!isObj(o) || typeof o.origin !== "string" || !Array.isArray(o.localStorage)) return refuse("BROWSER_STATE_INVALID", "an origin has a name and its localStorage");
    const items = o.localStorage.filter((i): i is { name: string; value: string } => isObj(i) && typeof i.name === "string" && typeof i.value === "string").map((i) => ({ name: i.name, value: i.value }));
    origins.push({ origin: o.origin, localStorage: items });
  }
  return { ok: true, state: { cookies, origins } };
}

/** Whether a cookie domain (with or without its leading dot) is sent to `site`. */
const covers = (domain: string, site: string) => {
  const d = domain.replace(/^\./, "");
  return site === d || site.endsWith(`.${d}`);
};

/** Only what belongs to one site: its cookies and its own https origin's storage. Another site's state is never kept. */
export function stateForSite(state: StorageState, site: string): StorageState {
  const origins = state.origins.filter((o) => {
    try {
      const u = new URL(o.origin);
      return u.protocol === "https:" && u.hostname === site;
    } catch {
      return false;
    }
  });
  return { cookies: state.cookies.filter((c) => covers(c.domain, site)), origins };
}

/** The site a page address names, under the same policy cap a credential's host has. */
export function siteOf(url: string): { ok: true; value: string } | Refused {
  let host = "";
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return refuse("BROWSER_STATE_SITE", "a login is kept only for an https site");
    host = u.hostname;
  } catch {
    return refuse("BROWSER_STATE_SITE", "the page has no address");
  }
  const checked = checkHost(host);
  return checked.ok ? checked : refuse("BROWSER_STATE_SITE", checked.reason);
}

/** The reference a person's saved login for a site is kept under: the same for one site, never a name the person picks. */
export async function browserRef(site: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(`browser-state:${site}`)));
  return `cred://browser-${[...digest.slice(0, 8)].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

export class BrowserStateVault extends VaultCore {
  private readonly browser: BrowserStateDeps | undefined;

  constructor(ctx: VaultCtx, deps: VaultDeps & { browserState?: BrowserStateDeps }) {
    super(ctx, deps);
    this.browser = deps.browserState;
  }

  private stateRow(owner: string, site: string): { ref: string } | null {
    const r = this.sql("SELECT ref FROM browser_states WHERE owner = ? AND site = ?", owner, site)[0];
    return r ? { ref: String(r.ref) } : null;
  }

  /** Keeps the live page's site login for the person: read from the session, cut to that site, sealed. */
  async saveBrowserState(req: { session: string; url: string }, ctx: { person: string }): Promise<SaveResult> {
    const person = String(ctx?.person ?? "");
    if (!person || !this.browser) return refuse("BROWSER_STATE_UNAVAILABLE", "no live browser session to read a login from");
    const site = siteOf(String(req?.url ?? ""));
    if (!site.ok) return site;
    let captured: StorageState;
    try {
      const parsed = parseStorageState(await this.browser.capture(String(req.session)));
      if (!parsed.ok) return parsed;
      captured = stateForSite(parsed.state, site.value);
    } catch (e) {
      return refuse("BROWSER_STATE_CAPTURE_FAILED", String(e instanceof Error ? e.message : e).split(": ")[0] ?? "the session could not be read");
    }
    if (!captured.cookies.length && !captured.origins.some((o) => o.localStorage.length)) return refuse("BROWSER_STATE_EMPTY", `the session holds no login for ${site.value}`);
    const value = JSON.stringify(captured);
    if (value.length > STATE_MAX) return refuse("BROWSER_STATE_TOO_LARGE", `the login for ${site.value} is over ${STATE_MAX} characters`);
    const ref = await browserRef(site.value);
    const sealed = await this.seal(person, ref, value);
    if (!sealed.ok) return sealed;
    const now = this.deps.now();
    this.ctx.storage.transactionSync(() => {
      this.sql(
        "INSERT OR REPLACE INTO secrets (owner, ref, label, kind, permission, iv, ct, created_at, expires_at, revoked_at) VALUES (?, ?, ?, 'browser-state', 'grant', ?, ?, ?, NULL, NULL)",
        person, ref, `browser login for ${site.value}`, sealed.iv, sealed.ct, now,
      );
      this.sql("INSERT OR REPLACE INTO browser_states (owner, site, ref, saved_at) VALUES (?, ?, ?, ?)", person, site.value, ref, now);
      this.event(person, ref, "captured", "platform", `browser login; ${site.value}`);
    });
    return { ok: true, site: site.value, ref, cookies: captured.cookies.length, origins: captured.origins.length };
  }

  /**
   * Restores the person's saved login for the site of `url` into a fresh session, before it navigates:
   * none saved is not an error; one saved needs the person's covering RESTORE grant, checked here.
   */
  async restoreBrowserState(req: { session: string; url: string }, ctx: { person: string }): Promise<RestoreResult> {
    const person = String(ctx?.person ?? "");
    const site = siteOf(String(req?.url ?? ""));
    if (!site.ok) return { ok: true, restored: false, site: "" };
    const row = person ? this.stateRow(person, site.value) : null;
    if (!row) return { ok: true, restored: false, site: site.value };
    if (!this.browser) return refuse("BROWSER_STATE_UNAVAILABLE", "no live browser session to restore into");
    const secret = this.sql("SELECT kind, expires_at, revoked_at, used_at FROM secrets WHERE owner = ? AND ref = ?", person, row.ref)[0];
    if (secret?.kind !== "browser-state") return refuse("EGRESS_CRED_UNKNOWN", `no saved login for ${site.value}`);
    const status = this.status(secret);
    if (status !== "active") return refuse(status === "revoked" ? "EGRESS_CRED_REVOKED" : "EGRESS_CRED_EXPIRED", `the saved login for ${site.value} is ${status}`);
    const grant = await this.grantFor(person, row.ref, site.value, RESTORE, person);
    if (!grant.ok) {
      this.event(person, row.ref, "restore-refused", `agent:${person}`, grant.code);
      return refuse(grant.code, `the saved login for ${site.value} is restored only under ${person}'s grant for it`);
    }
    const opened = await this.open(person, row.ref);
    if (!opened.ok) return opened;
    const parsed = parseStorageState(JSON.parse(opened.value));
    if (!parsed.ok) return parsed;
    try {
      await this.browser.restore(String(req.session), parsed.state);
    } catch (e) {
      return refuse("BROWSER_STATE_RESTORE_FAILED", String(e instanceof Error ? e.message : e).split(": ")[0] ?? "the session did not take the login");
    }
    this.event(person, row.ref, "restored", `agent:${person}`, `${site.value}; ${grant.nonce}`);
    return { ok: true, restored: true, site: site.value, ref: row.ref, grant: grant.nonce, cookies: parsed.state.cookies.length };
  }

  /**
   * Settings: a grant over a saved login is a RESTORE on its own site, signed like any credential grant.
   * Any other credential goes to the core's issuance and its registry check.
   */
  override async issueGrant(input: Parameters<VaultCore["issueGrant"]>[0], writer: unknown): Promise<{ ok: true; grant: GrantInfo } | Refused> {
    const w = checkWriter(writer);
    if (!w.ok) return w;
    const owner = w.value.person;
    const ref = String(input?.ref ?? "");
    const state = this.sql("SELECT site FROM browser_states WHERE owner = ? AND ref = ?", owner, ref)[0];
    if (!state) return super.issueGrant(input, writer);
    const site = String(state.site);
    const methods = [...new Set((input.methods ?? [RESTORE]).map((m) => String(m).toUpperCase()))];
    const hosts = [...new Set((input.hosts ?? [site]).map(String))];
    const life = Math.min(Number(input.expiresInMs ?? 3_600_000), GRANT_MAX_MS);
    if (input.fill === true || methods.length !== 1 || methods[0] !== RESTORE || hosts.length !== 1 || hosts[0] !== site || !(life > 0)) return refuse("VAULT_GRANT_INVALID", `a saved login is granted only to be restored on ${site}`);
    const secret = this.sql("SELECT kind, expires_at, revoked_at, used_at FROM secrets WHERE owner = ? AND ref = ?", owner, ref)[0];
    if (!secret || this.status(secret) !== "active") return refuse("VAULT_CRED_INACTIVE", `the saved login for ${site} is not active`);
    const k = await this.dataKey();
    if (!k.ok) return refuse("VAULT_LOCKED", `${k.code}: ${k.reason}`);
    const now = this.deps.now();
    const grant: CredentialGrant = { v: 1, tenant: this.deps.tenant, agent_id: `agent:${owner}`, secret_ref: ref, scope: { hosts: [site], methods: [RESTORE], fill: false }, expires_at: now + life, one_shot: input.oneShot === true, nonce: newNonce() };
    const mac = await sign(k.keys.grantKey, grant);
    const body = JSON.stringify(grant);
    this.sql("INSERT INTO credential_grants (nonce, owner, ref, body, mac, issued_at) VALUES (?, ?, ?, ?, ?, ?)", grant.nonce, owner, ref, body, mac, now);
    this.event(owner, ref, "grant-issued", owner, `${w.value.via}; ${grant.nonce}; restore`);
    return { ok: true, grant: this.grantInfo({ nonce: grant.nonce, body, issued_at: now, revoked_at: null, used_at: null }) };
  }

  /** The person's forget path: the saved logins for these sites (every site when none is named), sealed rows and grants gone. */
  forgetBrowserStates(person: string, sites?: readonly string[]): { ok: true; forgotten: string[] } {
    const rows = this.sql("SELECT site, ref FROM browser_states WHERE owner = ?", person).filter((r) => !sites || sites.includes(String(r.site)));
    this.ctx.storage.transactionSync(() => {
      for (const r of rows) {
        this.sql("DELETE FROM secrets WHERE owner = ? AND ref = ?", person, r.ref);
        this.sql("DELETE FROM credential_grants WHERE owner = ? AND ref = ?", person, r.ref);
        this.sql("DELETE FROM browser_states WHERE owner = ? AND ref = ?", person, r.ref);
        this.event(person, String(r.ref), "forgotten", person, String(r.site));
      }
    });
    return { ok: true, forgotten: rows.map((r) => String(r.site)) };
  }

  /** Offboarding (M24.3): everything the departing person keeps here, sealed values, registry, grants and logins. */
  purgePerson(person: string): { ok: true; credentials: number } {
    if (!person) return { ok: true, credentials: 0 };
    let credentials = 0;
    this.ctx.storage.transactionSync(() => {
      credentials = this.sql("DELETE FROM secrets WHERE owner = ? RETURNING ref", person).length;
      for (const table of ["credential_hosts", "credential_grants", "session_fills", "browser_states"]) this.sql(`DELETE FROM ${table} WHERE owner = ?`, person);
      this.event(person, "*", "purged", "platform", `offboarding; ${credentials} credentials`);
    });
    return { ok: true, credentials };
  }
}

type Confirmed = { ok: true; sites: string[] } | { ok: false; code: string; reason: string };

/**
 * The person's forget confirmation (`objects/person.ts` forgetConfirm): the memory plan executed, then the
 * saved browser logins for the plan's sites removed from the Vault, and which went said, or the code that
 * says they did not. The plan is the owner's own; the Vault removes only that person's rows.
 */
export async function forgetConfirmed<R extends Confirmed>(
  memory: { forgetConfirm(planId: string, requester: string): Promise<R> },
  vault: () => { forgetBrowserStates(person: string, sites?: string[]): Promise<{ ok: true; forgotten: string[] }> },
  person: string,
  planId: string,
  requester: string,
): Promise<R | (R & { logins: { ok: true; forgotten: string[] } | Refused })> {
  const r = await memory.forgetConfirm(planId, requester);
  if (!r.ok || requester !== person) return r;
  if (!r.sites.length) return { ...r, logins: { ok: true, forgotten: [] } };
  try {
    return { ...r, logins: await vault().forgetBrowserStates(person, r.sites) };
  } catch (e) {
    return { ...r, logins: refuse("VAULT_UNAVAILABLE", `the saved logins for ${r.sites.join(", ")} were not removed: ${String(e instanceof Error ? e.message : e).slice(0, 120)}`) };
  }
}
