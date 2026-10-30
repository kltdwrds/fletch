// The Vault (AD-12, M13): one per tenant. Values are sealed with AES-GCM under the tenant's data key,
// with the tenant, the owner and the reference as additional data, so a ciphertext moved to another
// row, person or tenant does not open. The data key is generated here, wrapped by the platform master
// key through the dispatcher's key entrypoint (tenant in the binding's props), and only the wrapped
// blob is stored: the raw key exists in memory, imported as non-extractable keys (the sealing key and
// an HKDF base the grant MAC key derives from), and its bytes are zeroed once imported. The egress
// module runs here, so resolved values never leave this object.
//
// A credential belongs to the person who captured it (company connectors, M10.2, to the company, owner
// ''), has a status (active, revoked, expired) and a permission: `standing` resolves for its owner's
// agent at its registered hosts, `grant` only under a signed credential grant (`vault/grants.ts`) that
// covers the use. Where a credential may go is the registry (`vault/hosts.ts`), written by a person
// alone. Nothing here returns a value. From M14.2, a secret the person types in chat is held here as a
// `typed` credential used once (`holdTyped`), and an allow-once card on an action naming a credential
// mints a matching one-shot fill grant (`grantForAction`). From M25.1 the agent's code may hold an
// opaque surrogate for a credential (`surrogate`), swapped back to its reference here at egress for its
// person alone, and a host the agent proposed is written only by the person's approval of its card.
import { type AuditRow, type EgressContext, type EgressResult, egressFetch, egressFill, type FillResult, type Revealed } from "../egress/module.ts";
import { CRED_REF, type EgressFailure, type HostRule, type OutboundRequest, redact } from "../egress/policy.ts";
import { hasSurrogate, mintSurrogate, SURROGATE, surrogateHash } from "../egress/surrogate.ts";
import { checkUse, type CredentialGrant, GRANT_MAX_MS, type GrantUseCode, mostTelling, newNonce, sign, type StoredGrant } from "./grants.ts";
import { auditOf, auditRows, type CaptureState, captureState, grantInfoOf, type LastUse, lastUses, policyRefusal, revokeGrantsOf, SETUP } from "./connections.ts";
import { checkCardWriter, checkEntry, checkHost, checkWriter, type HostEntry, publicHostFor, rulesFor, type Writer } from "./hosts.ts";
import { OTP_FIELD, OTP_TTL_MS } from "./otp.ts";
import { CARD_GRANT_MS, TYPED_TTL_MS } from "./typed.ts";
import { VapidKeys } from "./vapid.ts";
import { type Refused, type Row, SealedVault, type Status } from "./sealed.ts";

export type { VaultCtx, VaultDeps } from "./sealed.ts";
export type { Refused, Status } from "./sealed.ts";

/** The reference a company connector's credential is kept under. */
export const companyRef = (connector: string) => `cred://company-${connector}`;
const COMPANY = "";

export type VaultCode =
  | "VAULT_REF_INVALID"
  | "VAULT_VALUE_INVALID"
  | "VAULT_HOSTS_INVALID"
  | "VAULT_LOCKED"
  | "VAULT_CRED_UNKNOWN"
  | "VAULT_CRED_INACTIVE"
  | "VAULT_GRANT_INVALID"
  | "VAULT_GRANT_UNKNOWN"
  | "VAULT_OTP_HOST_UNKNOWN"
  | "VAULT_PERMISSION_INVALID"
  | string;
export type PutResult = { ok: true; ref: string } | Refused;
/** `browser-state` (M24.3): a site's saved browser login, sealed and restored only by `vault/browser-state.ts`. */
export type Kind = "secret" | "login" | "one-time-code" | "typed" | "browser-state";
export type Permission = "standing" | "grant";

export interface CredentialInfo {
  ref: string;
  label: string;
  kind: Kind;
  permission: Permission;
  status: Status;
  company: boolean;
  hosts: Array<Omit<HostEntry, "ref">>;
  createdAt: number;
  expiresAt: number | null;
}

export interface GrantInfo {
  nonce: string;
  ref: string;
  hosts: string[];
  methods: string[];
  fill: boolean;
  oneShot: boolean;
  expiresAt: number;
  issuedAt: number;
  revokedAt: number | null;
  usedAt: number | null;
}

const VALUE_MAX = 8 * 1024;
const LABEL_MAX = 80;
const hex = (bytes: Uint8Array) => [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
const refuse = (code: VaultCode, reason: string): Refused => ({ ok: false, code, reason });

type GrantInput = { ref: string; hosts: string[]; methods?: string[]; fill?: boolean; oneShot?: boolean; expiresInMs?: number };

export class VaultCore extends SealedVault {
  private readonly reads = (q: string, ...b: unknown[]) => this.sql(q, ...b);
  private vapidInstance?: VapidKeys;
  /** The tenant's VAPID key pair (M14.1), sealed under the same data key; it signs and never reveals. */
  get vapid(): VapidKeys {
    this.vapidInstance ??= new VapidKeys({ sql: (q, ...b) => this.sql(q, ...b), dataKey: async () => this.dataKey().then((k) => (k.ok ? { ok: true as const, key: k.keys.key } : k)), tenant: this.deps.tenant, now: this.deps.now, ...(this.deps.vapidSubject ? { subject: this.deps.vapidSubject } : {}) });
    return this.vapidInstance;
  }

  // --- capture and the registry -------------------------------------------------------------------

  private writeEntry(owner: string, e: HostEntry, by: string, via: string, card?: { id: string; at: number }) {
    this.sql(
      "INSERT OR REPLACE INTO credential_hosts (owner, ref, host, methods, header, prefix, fills, writer, via, created_at, card, approved_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      owner, e.ref, e.host, JSON.stringify(e.methods), e.header, e.prefix, e.fills ? 1 : 0, by, via, this.deps.now(), card?.id ?? null, card?.at ?? null,
    );
  }

  /**
   * The capture form's write (and settings'): a person stores a value under a reference of their own,
   * with the hosts it may go to. The registry entries are written with it; the value is sealed and
   * never returned, and a failure says what was wrong without the value.
   */
  async capture(input: { ref: string; value: string; label?: string; kind?: Kind; permission?: Permission; hosts: unknown[]; setup?: string }, writer: unknown): Promise<PutResult> {
    const w = checkWriter(writer);
    if (!w.ok) return w;
    if (input?.setup !== undefined && this.captureState(w.value.person, String(input.ref ?? ""), input.setup).state === "dismissed") return refuse("VAULT_REF_INVALID", "this setup was dismissed; ask for a new link");
    return this.store(w.value.person, input, w.value);
  }

  /** The person ends a setup they never submitted (F36, P9 delta 1): its link is void from then on. */
  dismissCapture(ref: string, writer: unknown, setup = ""): { ok: true } | Refused {
    const w = checkWriter(writer);
    if (!w.ok) return w;
    if (!SETUP.test(setup) || this.captureState(w.value.person, ref, setup).state !== "pending") return refuse("VAULT_REF_INVALID", `${ref} is not a setup waiting on you`);
    this.event(w.value.person, ref, "dismissed", w.value.person, `setup ${setup}`);
    return { ok: true };
  }

  captureState = (person: string, ref: string, setup = ""): CaptureState => captureState(this.reads, person, ref, setup);

  private async store(owner: string, input: { ref: string; value: string; label?: string; kind?: Kind; permission?: Permission; hosts: unknown[] }, w: Writer): Promise<PutResult> {
    const i = input ?? ({} as typeof input);
    const ref = String(i.ref ?? "");
    if (!CRED_REF.test(ref) || /^cred:\/\/(otp|typed|browser)-/.test(ref) || (owner !== COMPANY && ref.startsWith("cred://company-"))) return refuse("VAULT_REF_INVALID", "a reference is cred://<name>; otp-, typed-, browser- and company- names are the platform's");
    if (typeof i.value !== "string" || !i.value || i.value.length > VALUE_MAX) return refuse("VAULT_VALUE_INVALID", `a value is 1 to ${VALUE_MAX} characters`);
    const kind: Kind = i.kind === "login" ? "login" : "secret";
    const permission = i.permission ?? "standing";
    if (permission !== "standing" && permission !== "grant") return refuse("VAULT_PERMISSION_INVALID", "a permission is standing or grant");
    if (!Array.isArray(i.hosts) || !i.hosts.length) return refuse("VAULT_HOSTS_INVALID", "a credential names at least one host");
    const entries: HostEntry[] = [];
    for (const h of i.hosts) {
      // A bare host takes a token in `authorization` after `Bearer `, read-only, as the first connectors use it.
      const e = checkEntry({ ...(typeof h === "string" ? { host: h, methods: ["GET", "HEAD"], header: "authorization", prefix: "Bearer " } : (h as object)), ref });
      if (!e.ok) return e;
      entries.push(e.value);
    }
    const sealed = await this.seal(owner, ref, i.value);
    if (!sealed.ok) return sealed;
    const label = String(i.label ?? ref.slice("cred://".length)).slice(0, LABEL_MAX);
    this.ctx.storage.transactionSync(() => {
      this.sql(
        "INSERT OR REPLACE INTO secrets (owner, ref, label, kind, permission, iv, ct, created_at, expires_at, revoked_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)",
        owner, ref, label, kind, permission, sealed.iv, sealed.ct, this.deps.now(),
      );
      this.sql("DELETE FROM credential_hosts WHERE owner = ? AND ref = ?", owner, ref);
      for (const e of entries) this.writeEntry(owner, e, w.person, w.via);
      this.event(owner, ref, "captured", w.person, `${w.via}; ${entries.map((e) => e.host).join(", ")}`);
    });
    return { ok: true, ref };
  }

  /** Settings: a person adds a host to their own credential, under the same policy cap. */
  registerHost(input: unknown, writer: unknown): { ok: true; entry: HostEntry } | Refused {
    const w = checkWriter(writer);
    if (!w.ok) return w;
    const e = checkEntry(input);
    if (!e.ok) return e;
    const owner = w.value.person;
    const row = this.sql("SELECT kind FROM secrets WHERE owner = ? AND ref = ?", owner, e.value.ref)[0];
    if (!row || row.kind === "one-time-code") return refuse("VAULT_CRED_UNKNOWN", `${e.value.ref} is not one of your credentials`);
    this.writeEntry(owner, e.value, owner, w.value.via);
    this.event(owner, e.value.ref, "host-added", owner, `${w.value.via}; ${e.value.host}`);
    return { ok: true, entry: e.value };
  }

  /**
   * A host the agent proposed and the person approved once on its card (M25.1). The writer is that
   * approval (the person, the card, when); the row keeps all three. The proposal names a host and
   * methods only: where the value stands stays the credential's own declaration.
   */
  addApprovedHost(input: { ref: string; host: string; methods?: string[] }, writer: unknown): { ok: true; entry: HostEntry } | Refused {
    const w = checkCardWriter(writer);
    if (!w.ok) return w;
    const owner = w.value.person;
    const ref = String(input?.ref ?? "");
    const row = this.sql("SELECT kind FROM secrets WHERE owner = ? AND ref = ?", owner, ref)[0];
    if (row?.kind !== "secret") return refuse("VAULT_CRED_UNKNOWN", `${ref} is not one of your saved API credentials`);
    const placed = this.entries(owner).find((e) => e.ref === ref);
    const e = checkEntry({ ref, host: input.host, methods: input.methods ?? ["GET", "HEAD"], header: placed?.header, prefix: placed?.prefix ?? "Bearer ", fills: false });
    if (!e.ok) return e;
    this.writeEntry(owner, e.value, owner, "card", { id: w.value.card, at: w.value.approvedAt });
    this.event(owner, ref, "host-approved", owner, `card ${w.value.card.slice(0, 80)}; ${e.value.host}`);
    return { ok: true, entry: e.value };
  }

  /** A surrogate for one of the person's credentials or a company one, for the agent's code; only its hash is kept. */
  async surrogate(person: string, ref: string): Promise<{ ok: true; token: string } | Refused> {
    const owner = this.connectorOf(ref) !== null ? COMPANY : person;
    if (!person || !this.sql("SELECT ref FROM secrets WHERE owner = ? AND ref = ?", owner, ref).length) return refuse("VAULT_CRED_UNKNOWN", `${ref} is not a credential ${person || "this person"} holds`);
    const token = mintSurrogate();
    this.sql("INSERT INTO surrogates (hash, person, ref, created_at) VALUES (?, ?, ?, ?)", await surrogateHash(token), person, ref, this.deps.now());
    this.event(owner, ref, "surrogate-minted", person);
    return { ok: true, token };
  }

  /** Each surrogate on a request back to its reference, for this person only; an unknown or foreign one refuses the request. */
  private async unswap(req: OutboundRequest, person: string): Promise<{ ok: true; req: OutboundRequest } | EgressFailure> {
    const r = req ?? ({} as OutboundRequest);
    if (!hasSurrogate(JSON.stringify(r))) return { ok: true, req: r };
    const refused: EgressFailure = { ok: false, code: "EGRESS_SURROGATE_UNKNOWN", reason: `a surrogate on the request is not one of ${person || "this person"}'s` };
    const refs = new Map<string, string>();
    for (const token of new Set(JSON.stringify(r).match(SURROGATE) ?? [])) {
      const row = this.sql("SELECT person, ref FROM surrogates WHERE hash = ?", await surrogateHash(token))[0];
      if (!row || row.person !== person) return refused;
      refs.set(token, String(row.ref));
    }
    const swap = (text: string) => text.replace(SURROGATE, (t) => refs.get(t) ?? t);
    const out: OutboundRequest = { url: swap(String(r.url ?? "")), ...(r.method ? { method: r.method } : {}), headers: (r.headers ?? []).map(([n, v]) => [String(n), swap(String(v))]), ...(r.body !== undefined ? { body: swap(String(r.body)) } : {}) };
    // What is left that starts like a surrogate is a cut or forged one.
    return hasSurrogate(JSON.stringify(out)) ? refused : { ok: true, req: out };
  }

  removeHost(ref: string, host: string, writer: unknown): { ok: true } | Refused {
    const w = checkWriter(writer);
    if (!w.ok) return w;
    this.sql("DELETE FROM credential_hosts WHERE owner = ? AND ref = ? AND host = ?", w.value.person, ref, host);
    this.event(w.value.person, ref, "host-removed", w.value.person, host);
    return { ok: true };
  }

  /** The person revokes their own credential, on settings or a card (F36): sealed for redaction, never resolved again, its grants ended, its audit kept. */
  revoke(ref: string, writer: unknown): { ok: true } | Refused {
    const w = checkWriter(writer).ok ? checkWriter(writer) : checkCardWriter(writer);
    if (!w.ok) return w;
    const owner = w.value.person;
    if (!this.sql("SELECT ref FROM secrets WHERE owner = ? AND ref = ?", owner, ref).length) return refuse("VAULT_CRED_UNKNOWN", `${ref} is not one of your credentials`);
    this.sql("UPDATE secrets SET revoked_at = ? WHERE owner = ? AND ref = ? AND revoked_at IS NULL", this.deps.now(), owner, ref);
    revokeGrantsOf(this.reads, owner, ref, this.deps.now());
    this.event(owner, ref, "revoked", owner, "card" in w.value ? `card ${w.value.card}` : w.value.via);
    return { ok: true };
  }

  private entries(owner: string): HostEntry[] {
    return this.sql("SELECT ref, host, methods, header, prefix, fills FROM credential_hosts WHERE owner = ? ORDER BY ref, host", owner).map((r) => ({
      ref: String(r.ref), host: String(r.host), methods: JSON.parse(String(r.methods)) as string[], header: String(r.header), prefix: String(r.prefix), fills: Number(r.fills) === 1,
    }));
  }

  /** The rules a person's request is planned against: public hosts, their own entries and the company's. */
  hostRules(person: string): HostRule[] {
    return rulesFor([...this.entries(person), ...this.entries(COMPANY)]);
  }

  /** Whether a host is one of the person's rules: a public host, one of their entries or the company's. */
  listsHost(person: string, host: string): boolean {
    return !!person && this.hostRules(person).some((r) => r.host === host.toLowerCase());
  }

  /** A person's credentials and the company's: references, labels, status and hosts; never a value. */
  list(person: string): CredentialInfo[] {
    const out: CredentialInfo[] = [];
    for (const owner of [person, COMPANY]) {
      const hosts = this.entries(owner);
      for (const r of this.sql("SELECT ref, label, kind, permission, created_at, expires_at, revoked_at, used_at FROM secrets WHERE owner = ? ORDER BY ref", owner)) {
        out.push({
          ref: String(r.ref), label: String(r.label), kind: r.kind as Kind, permission: r.permission as Permission, status: this.status(r), company: owner === COMPANY,
          hosts: hosts.filter((h) => h.ref === r.ref).map(({ ref: _r, ...h }) => h), createdAt: Number(r.created_at), expiresAt: r.expires_at === null ? null : Number(r.expires_at),
        });
      }
    }
    return out;
  }

  /** The newest use of each of the person's credentials (F36): the Connected row's last use and its outcome. */
  lastUses = (person: string): Record<string, LastUse> => lastUses(this.reads, person);

  /** One credential's audit rows for its person, newest first (F36): the connector's page reads them. */
  auditOf(person: string, ref: string) {
    return auditOf(this.reads, person, ref);
  }

  /** The audit rows, newest first; never a value. */
  audit(limit = 100): AuditRow[] {
    return auditRows((q, ...b) => this.sql(q, ...b), limit);
  }

  /** Capture, revocation, host and grant events for one owner, newest first. */
  events(person: string, limit = 100): Row[] {
    return this.sql("SELECT at, ref, event, by, detail FROM vault_events WHERE owner = ? ORDER BY id DESC LIMIT ?", person, limit);
  }

  // --- company connectors (M10.2) -----------------------------------------------------------------

  /** A company connector's credential, put by the Company after its admin check; the admin is the registry's writer. */
  async putCompany(input: { connector: string; value: string; hosts: unknown[]; by: string }): Promise<PutResult> {
    const ref = companyRef(String(input?.connector ?? ""));
    const by = String(input?.by ?? "");
    if (!by) return refuse("VAULT_HOST_WRITER_DENIED", "a company connector names the admin who connected it");
    const put = await this.store(COMPANY, { ref, value: input?.value, hosts: input?.hosts ?? [] }, { kind: "person", person: by, via: "settings" });
    if (put.ok) this.sql("INSERT OR REPLACE INTO company_refs (ref, connector) VALUES (?, ?)", ref, input.connector);
    return put;
  }

  /** Removes a company connector's credential, its grants with it and a `revoked` event by `by`; true when there was one. */
  removeCompany(connector: string, by = "company"): boolean {
    const ref = companyRef(connector);
    const had = this.sql("SELECT ref FROM company_refs WHERE ref = ?", ref).length > 0;
    revokeGrantsOf(this.reads, COMPANY, ref, this.deps.now());
    if (had) this.event(COMPANY, ref, "revoked", by, "removed");
    this.sql("DELETE FROM secrets WHERE owner = ? AND ref = ?", COMPANY, ref);
    this.sql("DELETE FROM credential_hosts WHERE owner = ? AND ref = ?", COMPANY, ref);
    this.sql("DELETE FROM company_refs WHERE ref = ?", ref);
    return had;
  }

  private connectorOf(ref: string): string | null {
    const row = this.sql("SELECT connector FROM company_refs WHERE ref = ?", ref)[0];
    return row ? String(row.connector) : null;
  }

  // --- grants -----------------------------------------------------------------------------------

  /**
   * A person signs a grant for their own agent over one of their credentials: hosts the registry
   * lists for it, methods it allows there, or a fill where it fills. A one-time code takes only a
   * one-shot fill grant inside the code's life.
   */
  async issueGrant(input: GrantInput, writer: unknown): Promise<{ ok: true; grant: GrantInfo } | Refused> {
    const w = checkWriter(writer);
    return w.ok ? this.issue(w.value.person, w.value.via, input) : w;
  }

  private async issue(owner: string, via: string, input: GrantInput): Promise<{ ok: true; grant: GrantInfo } | Refused> {
    const ref = String(input?.ref ?? "");
    const row = this.sql("SELECT kind, expires_at, revoked_at, used_at FROM secrets WHERE owner = ? AND ref = ?", owner, ref)[0];
    if (!row) return refuse("VAULT_CRED_UNKNOWN", `${ref} is not one of your credentials`);
    if (this.status(row) !== "active") return refuse("VAULT_CRED_INACTIVE", `${ref} is ${this.status(row)}`);
    const now = this.deps.now();
    // A one-time code and a typed secret are used once: a one-shot fill inside their life, nothing else.
    const otp = row.kind === "one-time-code" || row.kind === "typed";
    const hosts = [...new Set((input.hosts ?? []).map(String))];
    const methods = [...new Set((input.methods ?? []).map((m) => String(m).toUpperCase()))];
    const fill = input.fill === true;
    const oneShot = otp || input.oneShot === true;
    const life = Math.min(Number(input.expiresInMs ?? 3_600_000), GRANT_MAX_MS, otp ? Number(row.expires_at) - now : GRANT_MAX_MS);
    if (!hosts.length || !(life > 0) || (!fill && !methods.length) || (otp && methods.length)) return refuse("VAULT_GRANT_INVALID", "a grant names hosts, methods or a fill, and a life; a one-time code is a fill only");
    const registered = this.entries(owner).filter((e) => e.ref === ref);
    for (const host of hosts) {
      const e = registered.find((x) => x.host === host);
      if (!e || (fill && !e.fills) || methods.some((m) => !e.methods.includes(m))) return refuse("VAULT_GRANT_INVALID", `${ref} is not registered for that use on ${host}`);
    }
    const k = await this.dataKey();
    if (!k.ok) return refuse("VAULT_LOCKED", `${k.code}: ${k.reason}`);
    const grant: CredentialGrant = { v: 1, tenant: this.deps.tenant, agent_id: `agent:${owner}`, secret_ref: ref, scope: { hosts, methods, fill }, expires_at: now + life, one_shot: oneShot, nonce: newNonce() };
    const mac = await sign(k.keys.grantKey, grant);
    this.sql("INSERT INTO credential_grants (nonce, owner, ref, body, mac, issued_at) VALUES (?, ?, ?, ?, ?, ?)", grant.nonce, owner, ref, JSON.stringify(grant), mac, now);
    this.event(owner, ref, "grant-issued", owner, `${via}; ${grant.nonce}${oneShot ? "; one-shot" : ""}`);
    return { ok: true, grant: this.grantInfo({ nonce: grant.nonce, body: JSON.stringify(grant), issued_at: now, revoked_at: null, used_at: null }) };
  }

  revokeGrant(nonce: string, writer: unknown): { ok: true } | Refused {
    const w = checkWriter(writer);
    if (!w.ok) return w;
    const row = this.sql("SELECT ref FROM credential_grants WHERE nonce = ? AND owner = ?", nonce, w.value.person)[0];
    if (!row) return refuse("VAULT_GRANT_UNKNOWN", "no such grant of yours");
    this.sql("UPDATE credential_grants SET revoked_at = ? WHERE nonce = ? AND revoked_at IS NULL", this.deps.now(), nonce);
    this.event(w.value.person, String(row.ref), "grant-revoked", w.value.person, nonce);
    return { ok: true };
  }

  protected grantInfo(r: Row): GrantInfo {
    return grantInfoOf(r);
  }

  grants(person: string): GrantInfo[] {
    return this.sql("SELECT nonce, body, issued_at, revoked_at, used_at FROM credential_grants WHERE owner = ? ORDER BY issued_at DESC", person).map((r) => this.grantInfo(r));
  }

  /** The grant that covers this use, spent first if one-shot; else the code that refuses it. */
  protected async grantFor(owner: string, ref: string, host: string, method: string, person: string): Promise<{ ok: true; nonce: string } | { ok: false; code: GrantUseCode | "EGRESS_GRANT_REQUIRED" | "EGRESS_VAULT_LOCKED" }> {
    const rows = this.sql("SELECT nonce, body, mac, revoked_at, used_at FROM credential_grants WHERE owner = ? AND ref = ? ORDER BY issued_at", owner, ref);
    if (!rows.length) return { ok: false, code: "EGRESS_GRANT_REQUIRED" };
    const k = await this.dataKey();
    if (!k.ok) return { ok: false, code: "EGRESS_VAULT_LOCKED" };
    const codes: GrantUseCode[] = [];
    const at = this.deps.now();
    for (const r of rows) {
      let grant: CredentialGrant;
      try {
        grant = JSON.parse(String(r.body)) as CredentialGrant;
      } catch {
        codes.push("EGRESS_GRANT_INVALID");
        continue;
      }
      const stored: StoredGrant = { grant, mac: String(r.mac), revoked_at: r.revoked_at === null ? null : Number(r.revoked_at), used_at: r.used_at === null ? null : Number(r.used_at) };
      const code = await checkUse(k.keys.grantKey, stored, { person, ref, host, method, tenant: this.deps.tenant, at });
      if (code) {
        codes.push(code);
        continue;
      }
      // Spend a one-shot grant before anything is revealed; the object's single thread makes this the one use.
      if (grant.one_shot) this.sql("UPDATE credential_grants SET used_at = ? WHERE nonce = ? AND used_at IS NULL", at, grant.nonce);
      return { ok: true, nonce: grant.nonce };
    }
    return { ok: false, code: mostTelling(codes) ?? "EGRESS_GRANT_REQUIRED" };
  }

  // --- one-time codes -----------------------------------------------------------------------------

  /** Keeps a code read from a person's mail as a ten-minute credential of theirs; the mail shows only the reference. */
  async captureOneTimeCode(input: { person: string; code: string; source: string }): Promise<{ ok: true; ref: string } | Refused> {
    const code = String(input?.code ?? "");
    if (!/^[A-Za-z0-9]{4,12}$/.test(code)) return refuse("VAULT_VALUE_INVALID", "a one-time code is 4 to 12 letters and digits");
    return this.hold(String(input?.person ?? ""), "one-time-code", code, String(input?.source ?? "mail"), OTP_TTL_MS);
  }

  /** A secret the person typed in chat (M14.2), held before the message is stored; the chat keeps only the reference. */
  async holdTyped(input: { person: string; value: string; source: string }): Promise<{ ok: true; ref: string } | Refused> {
    const value = String(input?.value ?? "");
    if (!value || value.length > VALUE_MAX) return refuse("VAULT_VALUE_INVALID", `a value is 1 to ${VALUE_MAX} characters`);
    return this.hold(String(input?.person ?? ""), "typed", value, String(input?.source ?? "chat"), TYPED_TTL_MS);
  }

  /** A value the platform keeps for a person: a `grant` credential with no host until the person names one, for `ttl`. */
  private async hold(person: string, kind: "one-time-code" | "typed", value: string, source: string, ttl: number): Promise<{ ok: true; ref: string } | Refused> {
    if (!person) return refuse("VAULT_VALUE_INVALID", "a held value belongs to a person");
    const ref = `cred://${kind === "typed" ? "typed" : "otp"}-${hex(crypto.getRandomValues(new Uint8Array(8)))}`;
    const sealed = await this.seal(person, ref, value);
    if (!sealed.ok) return sealed;
    const now = this.deps.now();
    const what = kind === "typed" ? "secret typed in" : "one-time code from";
    this.sql(
      "INSERT INTO secrets (owner, ref, label, kind, permission, iv, ct, created_at, expires_at, revoked_at) VALUES (?, ?, ?, ?, 'grant', ?, ?, ?, ?, NULL)",
      person, ref, `${what} ${source.slice(0, 60)}`, kind, sealed.iv, sealed.ct, now, now + ttl,
    );
    this.event(person, ref, "captured", "platform", `${what.split(" ").slice(0, -1).join(" ")}; ${source.slice(0, 60)}`);
    return { ok: true, ref };
  }

  /**
   * The person's fresh one-time approval for a code: a one-shot fill grant for one host where they
   * already keep a login that fills. The code's registry entry is written by that approval.
   */
  async approveOneTimeCode(input: { ref: string; host: string }, writer: unknown): Promise<{ ok: true; grant: GrantInfo } | Refused> {
    const card = checkCardWriter(writer); // or the `credentials.otp` card the person pressed (F36, P9 delta 8)
    const w = card.ok ? { ok: true as const, value: { kind: "person" as const, person: card.value.person, via: "settings" as const } } : checkWriter(writer);
    if (!w.ok) return w;
    const owner = w.value.person;
    const ref = String(input?.ref ?? "");
    const row = this.sql("SELECT kind FROM secrets WHERE owner = ? AND ref = ?", owner, ref)[0];
    if (row?.kind !== "one-time-code") return refuse("VAULT_CRED_UNKNOWN", `${ref} is not one of your one-time codes`);
    const host = checkHost(input?.host);
    if (!host.ok) return host;
    if (!this.entries(owner).some((e) => e.host === host.value && e.fills && !e.ref.startsWith("cred://otp-"))) return refuse("VAULT_OTP_HOST_UNKNOWN", `you keep no login that fills on ${host.value}`);
    this.writeEntry(owner, { ref, host: host.value, methods: [], header: "authorization", prefix: "", fills: true }, owner, w.value.via);
    return this.issue(owner, w.value.via, { ref, hosts: [host.value], fill: true, oneShot: true, expiresInMs: OTP_TTL_MS });
  }

  /**
   * An allow-once card on a fill naming a credential (M14.2, Q24): the person's `Person` asks for a
   * matching one-shot fill grant when it commits the action under that card's one-shot grant. It covers
   * the site the card named, or the credential's registered fill hosts; a typed secret has none until
   * the card names its site, which the person's approval then registers for that one fill.
   */
  async grantForAction(input: { person: string; ref: string; site?: string | null; card: string }): Promise<{ ok: true; grant: GrantInfo } | Refused> {
    const owner = String(input?.person ?? "");
    const ref = String(input?.ref ?? "");
    const row = this.sql("SELECT kind FROM secrets WHERE owner = ? AND ref = ?", owner, ref)[0];
    if (!owner || !row) return refuse("VAULT_CRED_UNKNOWN", `${ref} is not one of ${owner || "this person"}'s credentials`);
    const fills = this.entries(owner).filter((e) => e.ref === ref && e.fills).map((e) => e.host);
    let hosts = fills;
    if (input.site) {
      const site = checkHost(input.site);
      if (!site.ok) return site;
      const held = row.kind === "typed" || row.kind === "one-time-code";
      if (held && !fills.includes(site.value)) {
        if (row.kind === "one-time-code" && !this.entries(owner).some((e) => e.host === site.value && e.fills && !e.ref.startsWith("cred://otp-"))) return refuse("VAULT_OTP_HOST_UNKNOWN", `you keep no login that fills on ${site.value}`);
        this.writeEntry(owner, { ref, host: site.value, methods: [], header: "authorization", prefix: "", fills: true }, owner, "card");
      }
      hosts = [site.value];
    }
    if (!hosts.length) return refuse("VAULT_GRANT_INVALID", `${ref} fills on no site yet; the card must name one`);
    return this.issue(owner, `card ${String(input.card).slice(0, 80)}`, { ref, hosts, fill: true, oneShot: true, expiresInMs: CARD_GRANT_MS });
  }

  // --- resolution ---------------------------------------------------------------------------------

  /**
   * Resolution for one person: a company reference needs the Company's word that this person holds a
   * company grant to the connector, asked on every call; a personal reference resolves only for its
   * owner, while active, and under a covering signed grant when its permission asks for one.
   */
  private revealFor(ctx: EgressContext, used: Set<string>) {
    return async (ref: string, host: string, method: string): Promise<Revealed> => {
      const connector = this.connectorOf(ref);
      const owner = connector !== null ? COMPANY : ctx.person;
      if (connector !== null) {
        const entitled = this.deps.entitled ? await this.deps.entitled(ctx.person, connector, ctx.purpose).catch(() => false) : false;
        if (!entitled) return { ok: false, code: "EGRESS_COMPANY_GRANT_REQUIRED", reason: `${ctx.person || "this person"} holds no company grant to the ${connector} connector` };
        used.add(connector);
      }
      const row = this.sql("SELECT kind, permission, expires_at, revoked_at, used_at FROM secrets WHERE owner = ? AND ref = ?", owner, ref)[0];
      if (!row) return { ok: false, code: "EGRESS_CRED_UNKNOWN", reason: `${ref} is not in the vault for ${ctx.person || "this person"}` };
      const status = this.status(row);
      if (status !== "active") return { ok: false, code: status === "revoked" ? "EGRESS_CRED_REVOKED" : status === "spent" ? "EGRESS_CRED_SPENT" : "VAULT_CRED_INACTIVE", reason: `${ref} is ${status}` };
      const entry = this.entries(owner).find((e) => e.ref === ref && e.host === host);
      if (!entry || (method === "FILL" ? !entry.fills : !entry.methods.includes(method))) return { ok: false, code: "EGRESS_CRED_HOST_DENIED", reason: `${ref} is not registered for ${method} on ${host}` };
      let grant: string | undefined;
      if (row.permission === "grant") {
        const g = await this.grantFor(owner, ref, host, method, ctx.person);
        if (!g.ok) return { ok: false, code: g.code, reason: `${ref} needs a grant from ${ctx.person || "its owner"} that covers ${method} on ${host}` };
        grant = g.nonce;
      }
      // A typed secret is used once: spent before it is revealed, so no second grant reaches it.
      if (row.kind === "typed") this.sql("UPDATE secrets SET used_at = ? WHERE owner = ? AND ref = ? AND used_at IS NULL", this.deps.now(), owner, ref);
      const opened = await this.open(owner, ref);
      return opened.ok ? { ok: true, value: opened.value, ...(grant ? { grant } : {}) } : opened;
    };
  }

  private writeAudit(r: AuditRow) {
    this.sql("INSERT INTO egress_audit (at, ref, host, method, path, person, purpose, outcome, grant_nonce) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", r.at, r.ref, r.host, r.method, r.path, r.person, r.purpose, r.outcome, r.grant ?? null);
  }

  /** A registry entry the policy cap now refuses is refused by name, not passed over as unknown. */
  private policyRefusal(url: string): EgressResult | null {
    return policyRefusal(url, (host) => this.sql("SELECT host FROM credential_hosts WHERE host = ? LIMIT 1", host).length > 0);
  }

  /** Performs one outbound request through the egress module. */
  async egress(raw: OutboundRequest, ctx: EgressContext): Promise<EgressResult> {
    const who = { person: String(ctx?.person ?? ""), purpose: String(ctx?.purpose ?? "") };
    const swapped = await this.unswap(raw, who.person);
    if (!swapped.ok) {
      let url: URL | null = null;
      try {
        url = new URL(String(raw?.url ?? ""));
      } catch {}
      this.writeAudit({ at: this.deps.now(), ref: "surrogate", host: url?.hostname ?? "", method: String(raw?.method ?? "GET").toUpperCase(), path: url?.pathname ?? "", ...who, outcome: swapped.code });
      return { ...swapped, ...(url ? { host: url.hostname } : {}) };
    }
    const req = swapped.req;
    const refused = this.policyRefusal(String(req?.url ?? ""));
    if (refused) return refused;
    const used = new Set<string>();
    const sent: string[] = [];
    const audit = (r: AuditRow) => {
      this.writeAudit(r);
      if (r.outcome === "resolved") sent.push(r.ref);
    };
    const result = await egressFetch({ fetch: this.deps.fetch, reveal: this.revealFor(who, used), hosts: this.hostRules(who.person), audit, now: this.deps.now, publicHost: publicHostFor(who.purpose) }, req, who);
    // The provider refused the key it was sent (F36, P9 delta 5): the Connected row says so at the use that found it.
    if (result.ok && (result.status === 401 || result.status === 403)) for (const ref of sent) this.event(this.connectorOf(ref) !== null ? COMPANY : who.person, ref, "rejected", "provider", `HTTP ${result.status}`);
    const connector = [...used][0];
    return result.ok && connector ? { ...result, scope: { kind: "company", connector } } : result;
  }

  /**
   * Types a credential into the page of a browser session (M9). The value goes from this object to the
   * browser and nowhere else; the session is remembered so later reads of its pages are scrubbed. A
   * one-time code goes only into the verification-code field.
   */
  async fill(req: { session: string; url: string; selector: string; ref: string; field?: string }, ctx: EgressContext): Promise<FillResult> {
    const inject = this.deps.inject;
    const session = String(req?.session ?? "");
    const selector = String(req?.selector ?? "");
    if (!inject || !session || !selector || selector.length > 300) return { ok: false, code: "EGRESS_FILL_FAILED", reason: "a fill needs a session and a selector of at most 300 characters" };
    const who = { person: String(ctx?.person ?? ""), purpose: String(ctx?.purpose ?? "") };
    const refused = this.policyRefusal(String(req?.url ?? ""));
    if (refused && !refused.ok) return refused;
    const kind = this.sql("SELECT kind FROM secrets WHERE owner = ? AND ref = ?", who.person, String(req?.ref ?? ""))[0]?.kind;
    if (kind === "one-time-code" && req.field !== OTP_FIELD) return { ok: false, code: "EGRESS_FILL_FIELD", reason: `a one-time code is typed only into the ${OTP_FIELD} field` };
    if (kind === "one-time-code") {
      // A code has no host until the person approves it for one: until then it waits on that approval, audited.
      let host = "";
      try {
        host = new URL(String(req.url)).hostname.toLowerCase();
      } catch {}
      if (!this.sql("SELECT ref FROM credential_hosts WHERE owner = ? AND ref = ? AND host = ?", who.person, req.ref, host).length) {
        this.writeAudit({ at: this.deps.now(), ref: req.ref, host, method: "FILL", path: "", person: who.person, purpose: who.purpose, outcome: "EGRESS_GRANT_REQUIRED" });
        return { ok: false, code: "EGRESS_GRANT_REQUIRED", reason: `the person approves ${req.ref} for ${host} first, on the card credential_code_use raises`, host };
      }
    }
    const owner = this.connectorOf(String(req?.ref ?? "")) !== null ? COMPANY : who.person;
    const result = await egressFill(
      { reveal: this.revealFor(who, new Set()), audit: (r) => this.writeAudit(r), now: this.deps.now, hosts: this.hostRules(who.person), inject: (value) => inject(session, selector, value) },
      { url: req.url, ref: req.ref },
      who,
    );
    if (result.ok) this.sql("INSERT OR REPLACE INTO session_fills (session, owner, ref, at) VALUES (?, ?, ?, ?)", session, owner, req.ref, this.deps.now());
    return result;
  }

  /** Text read back from a session's pages with every value typed into that session replaced by its reference. */
  async scrub(session: string, text: string): Promise<string> {
    const secrets: Array<{ ref: string; value: string }> = [];
    for (const r of this.sql("SELECT owner, ref FROM session_fills WHERE session = ?", session)) {
      const v = await this.open(String(r.owner), String(r.ref));
      // Fail closed: text that cannot be scrubbed is not returned, rather than returned with a value in it.
      if (!v.ok) throw new Error(`${v.code}: ${v.reason}`);
      secrets.push({ ref: String(r.ref), value: v.value });
    }
    return redact(text, secrets);
  }
}
