// The Vault object (AD-1, AD-12, M13): one per tenant. It hosts `vault/core.ts` over its SQLite, with the
// host's key service (`hostOf(env).keys`, the tenant its own) and the egress module inside it. A company
// connector's credential resolves only when the `Company` says the person holds a company grant (M10.2).
import { DurableObject } from "cloudflare:workers";
import { browserOf, captureState, injectField, restoreState } from "../browse/binding.ts";
import { vapidSubject } from "../delivery/webpush.ts";
import type { EgressContext, EgressResult, FillResult } from "../egress/module.ts";
import { egressNetwork } from "../egress/outbound.ts";
import type { OutboundRequest } from "../egress/policy.ts";
import { hostOf } from "../host.ts";
import { migrateObject, probeObject } from "../migrations/catalog.ts";
import { BrowserStateVault } from "../vault/browser-state.ts";
import type { CredentialInfo, GrantInfo, PutResult, VaultCore } from "../vault/core.ts";
import type { CardWriter, Writer } from "../vault/hosts.ts";

export class Vault extends DurableObject<Env> {
  private readonly schema = migrateObject(this.ctx, "vault");

  /** The sweep's wake (M25.3): what this wake applied and what is still behind. */
  async migrationProbe() { return probeObject(this.ctx.storage, this.schema); }
  private coreInstance?: BrowserStateVault;

  private get core(): BrowserStateVault {
    const browser = browserOf(this.env);
    this.coreInstance ??= new BrowserStateVault(this.ctx, {
      tenant: this.env.TENANT_ID,
      keys: hostOf(this.env).keys,
      // Push services reach the deploy's owner, never a contact of someone else's (RFC 8292 `sub`).
      ...(vapidSubject(this.env.OWNER_EMAIL) ? { vapidSubject: vapidSubject(this.env.OWNER_EMAIL) } : {}),
      fetch: this.network(),
      now: () => Date.now(),
      entitled: (person, connector, purpose) => this.env.COMPANY.get(this.env.COMPANY.idFromName(this.env.TENANT_ID)).connectorEntitled(person, connector, purpose),
      ...(browser ? { inject: (session: string, selector: string, value: string) => injectField(browser, session, selector, value) } : {}),
      // Saved logins (M24.3) are read from and put into a live session over the binding's CDP calls, here alone.
      ...(browser ? { browserState: { capture: (session: string) => captureState(browser, session), restore: (session: string, state) => restoreState(browser, session, state) } } : {}),
    });
    return this.coreInstance;
  }

  /**
   * The egress module's network (M25.1): `egressNetwork` on a deploy. A preview slot's test host
   * (`scripts/preview-slot/test-host.mjs`, F37) answers the P9 probe host instead; nothing else overrides it.
   */
  protected network(): (url: string, init: RequestInit) => Promise<Response> {
    return egressNetwork;
  }

  /** The capture form and settings (`http/vault-routes.ts`) write as the signed-in person; nothing the model calls reaches these. */
  async capture(input: Parameters<VaultCore["capture"]>[0], writer: Writer): Promise<PutResult> {
    return this.core.capture(input, writer);
  }

  async registerHost(input: unknown, writer: Writer) {
    return this.core.registerHost(input, writer);
  }

  /** Called by a `Chat` when the person approved, on its card, a host their agent proposed (M25.1); the writer is that approval. */
  async addApprovedHost(input: { ref: string; host: string; methods?: string[] }, writer: CardWriter) {
    return this.core.addApprovedHost(input, writer);
  }

  /** A surrogate token for the agent's code (M25.1): swapped back to its reference at egress, for this person alone. */
  async surrogate(person: string, ref: string) {
    return this.core.surrogate(person, ref);
  }

  async removeHost(ref: string, host: string, writer: Writer) {
    return this.core.removeHost(ref, host, writer);
  }

  async revoke(ref: string, writer: Writer | CardWriter) {
    return this.core.revoke(ref, writer);
  }

  async issueGrant(input: Parameters<VaultCore["issueGrant"]>[0], writer: Writer) {
    return this.core.issueGrant(input, writer);
  }

  async revokeGrant(nonce: string, writer: Writer) {
    return this.core.revokeGrant(nonce, writer);
  }

  async grants(person: string): Promise<GrantInfo[]> {
    return this.core.grants(person);
  }

  /** Called by the person's `Person` as their mail arrives (M13): the code is kept and the mail shows its reference. */
  async captureOneTimeCode(input: { person: string; code: string; source: string }) {
    return this.core.captureOneTimeCode(input);
  }

  async approveOneTimeCode(input: { ref: string; host: string }, writer: Writer | CardWriter) {
    return this.core.approveOneTimeCode(input, writer);
  }

  /** Called by a `Chat` before it stores the person's message (M14.2): a typed secret is kept, the chat sees its reference. */
  async holdTyped(input: { person: string; value: string; source: string }) {
    return this.core.holdTyped(input);
  }

  /** Called by the person's `Person` when it commits a fill under an allow-once card's one-shot grant (M14.2). */
  async grantForAction(input: { person: string; ref: string; site?: string | null; card: string }) {
    return this.core.grantForAction(input);
  }

  /** Called by the `Company` after its admin check; nothing else names it. */
  async putCompany(input: { connector: string; value: string; hosts: unknown[]; by: string }): Promise<PutResult> {
    return this.core.putCompany(input);
  }

  async removeCompany(connector: string, by?: string): Promise<boolean> {
    return this.core.removeCompany(connector, by);
  }

  /** The person ends a setup they never submitted (F36): the capture link is void afterwards. */
  async dismissCapture(ref: string, writer: Writer, setup?: string) {
    return this.core.dismissCapture(ref, writer, setup);
  }

  /** A setup's state for the chat's capture item: pending, entered or dismissed (F36). */
  async captureState(person: string, ref: string, setup?: string) {
    return this.core.captureState(person, ref, setup);
  }

  /** The newest use of each of the person's credentials, for the Connected rows (F36). */
  async lastUses(person: string) {
    return this.core.lastUses(person);
  }

  /** One credential's audit rows, for its person alone, read-only (F36): the connector's page. */
  async audit(person: string, ref: string) {
    return this.core.auditOf(person, ref);
  }

  /** The tenant's VAPID public key, which the app subscribes with (M14.1). */
  async pushKey() {
    return this.core.vapid.publicKey();
  }

  /** A push authorization for one endpoint at a known push service; the private key stays here. */
  async pushAuthorization(endpoint: string) {
    return this.core.vapid.authorization(endpoint);
  }

  /** A person's credentials and the company's, with status and hosts; never a value. */
  /** Whether the person's host rules (public hosts, theirs, the company's) name this host: an ingress socket source opens only to one (M25.5). */
  async listsHost(person: string, host: string): Promise<boolean> {
    return this.core.listsHost(person, host);
  }

  async list(person: string): Promise<CredentialInfo[]> {
    return this.core.list(person);
  }

  async egress(req: OutboundRequest, ctx: EgressContext): Promise<EgressResult> {
    return this.core.egress(req, ctx);
  }

  /** Types a credential into a live page through the egress module (M9); returns the outcome, never the value. */
  async fill(req: { session: string; url: string; selector: string; ref: string; field?: string }, ctx: EgressContext): Promise<FillResult> {
    return this.core.fill(req, ctx);
  }

  /** Called by a `Chat` for its owner (M24.3): keeps the live page's site login, sealed; never returns it. */
  async saveBrowserState(req: { session: string; url: string }, ctx: { person: string }) {
    return this.core.saveBrowserState(req, ctx);
  }

  /** Called by a `Chat` for its owner on a fresh live session, before it navigates: under the owner's grant only. */
  async restoreBrowserState(req: { session: string; url: string }, ctx: { person: string }) {
    return this.core.restoreBrowserState(req, ctx);
  }

  /** The person's forget path (`objects/person.ts` forgetConfirm): saved logins for these sites, or all of them. */
  async forgetBrowserStates(person: string, sites?: string[]) {
    return this.core.forgetBrowserStates(person, sites);
  }

  /** Offboarding (`Company.depart`): everything the departing person keeps in the Vault. */
  async purgePerson(person: string) {
    return this.core.purgePerson(person);
  }

  /** A live page's text with any value typed into that session replaced by its reference (M9). */
  async scrub(session: string, text: string): Promise<string> {
    return this.core.scrub(session, text);
  }
}
