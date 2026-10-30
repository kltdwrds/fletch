// The decision point in the `Person` object (AD-22): the person's grants live here, the company's
// policies and grants are read from the `Company` on every call, and the pure engine decides. A
// commit records the use where the grant lives, so a one-shot grant is spent exactly once and an
// action whose grant was spent meanwhile is not automatic.
import { type CompanySnapshot, companyView } from "../company/authority.ts";
import { type CredentialMint, credentialUse } from "./credential-use.ts";
import { resolve } from "./engine.ts";
import { type CreateResult, GrantStore, type GrantUse } from "./store.ts";
import type { Decision, Descriptor, Grant } from "./types.ts";

export interface CompanyPort {
  snapshot(): Promise<CompanySnapshot>;
  use(grantId: string, effectId: string, at: number): Promise<GrantUse>;
}

const refuse = (code: string): Decision => ({ decision: "deny", step: "policy", code });

/**
 * The credentials a grant names (F36, P9 delta 6): a subject or a constrained resource `credential:<name>` (the form
 * `credential_host_propose` and the credential tools put on a descriptor) or a `cred://<name>` reference.
 */
export function credentialsNamed(g: Pick<Grant, "subject" | "constraints">): string[] {
  const refs = [g.subject.ref, ...(g.constraints?.resources ?? [])].map((r) => (r.startsWith("credential:") ? `cred://${r.slice("credential:".length)}` : r));
  return [...new Set(refs.filter((r) => r.startsWith("cred://")))];
}

export class PersonAuthority {
  private readonly store: GrantStore;
  private readonly company: CompanyPort;
  private readonly person: string;
  private readonly now: () => number;
  private readonly mint?: CredentialMint;

  constructor(storage: Pick<DurableObjectStorage, "sql" | "transactionSync">, tenant: string, person: string, company: CompanyPort, now: () => number, mint?: CredentialMint) {
    this.store = new GrantStore(storage, tenant, { kind: "person", id: person });
    this.person = person;
    this.company = company;
    this.now = now;
    if (mint) this.mint = mint;
  }

  /** Resolves without recording anything: the answer a tool call sees. */
  async decide(d: Descriptor): Promise<Decision> {
    const { decision } = await this.resolve(d);
    return decision;
  }

  /**
   * The gate's answer at the moment an action would run: resolved again from the stores, and when
   * automatic, the use recorded where the grant lives. A grant spent by another effect is not reused.
   */
  async commit(d: Descriptor, effectId: string, args?: Record<string, unknown>): Promise<Decision> {
    // An effect commits once (M20.1, QYVR-172): asked again (a retried decision, a release taken up again),
    // it is refused before anything resolves, so it neither runs twice nor reads as never having run.
    if (this.store.committed(effectId)) return { decision: "deny", step: "match", code: "EFFECT_ALREADY_COMMITTED" };
    const { decision, grants } = await this.resolve(d);
    if (decision.decision !== "auto" || !decision.grantId) return decision;
    const grant = grants.find((g) => g.id === decision.grantId) as Grant;
    const used = grant.grantor.kind === "company" ? await this.company.use(grant.id, effectId, d.at) : this.store.use(grant.id, effectId, d.at);
    // The effect already committed once: whatever it did then, it does not run again (M20.1).
    if (used === "repeat") return { decision: "deny", grantId: grant.id, step: "match", code: "EFFECT_ALREADY_COMMITTED" };
    if (used === "spent") return { decision: "ask", grantId: grant.id, step: "match", code: "GRANT_SPENT", route: { kind: "principal", id: this.person } };
    // Allowed once, on a credential: the Vault mints the matching one-shot credential grant, or the action does not run.
    const credential = grant.one_shot ? credentialUse(d, args) : null;
    if (credential) {
      const minted = this.mint ? await this.mint({ ...credential, card: grant.id }).catch((e: unknown) => ({ ok: false as const, code: "VAULT_UNAVAILABLE", reason: String(e) })) : { ok: false as const, code: "VAULT_UNAVAILABLE", reason: "no vault" };
      if (!minted.ok) return { decision: "deny", grantId: grant.id, step: "policy", code: minted.code };
    }
    this.store.markCommitted(effectId, grant.id, d.at);
    return decision;
  }

  private async resolve(d: Descriptor): Promise<{ decision: Decision; grants: Grant[] }> {
    if (d.principal !== this.person) return { decision: refuse("PRINCIPAL_MISMATCH"), grants: [] };
    const snapshot = await this.company.snapshot();
    const view = companyView(snapshot);
    // Whoever is asking must be a member now; the company's member table says so, not the request.
    const asker = d.hops > 0 ? d.origin : d.counterpart.kind === "own-agent" ? this.person : d.counterpart.id;
    if (view.roleOf(asker) === null || (d.counterpart.kind !== "own-agent" && view.roleOf(d.counterpart.id) === null)) {
      return { decision: refuse("COUNTERPART_NOT_A_MEMBER"), grants: [] };
    }
    const grants = [...this.store.all(), ...snapshot.grants];
    return { decision: resolve(d, grants, view, { ...this.store.uses(), ...snapshot.uses }), grants };
  }

  /** The person signs a grant over their own agent and resources; nobody else signs for them. */
  create(by: string, input: unknown): CreateResult {
    if (by !== this.person) return { ok: false, code: "GRANT_NOT_YOURS", reason: "a person signs only their own grants" };
    return this.store.create(input, this.now());
  }

  revoke(by: string, id: string): { ok: true } | { ok: false; code: string } {
    if (by !== this.person) return { ok: false, code: "GRANT_NOT_YOURS" };
    return this.store.revoke(id, this.now());
  }

  /** A disconnect (F36): every grant of the person's that names the credential ends with it; no other grant is touched. */
  revokeNaming(by: string, ref: string): { ok: true; revoked: string[] } | { ok: false; code: string } {
    if (by !== this.person) return { ok: false, code: "GRANT_NOT_YOURS" };
    const ids = this.store.all().filter((g) => g.revoked_at === undefined && credentialsNamed(g).includes(ref)).map((g) => g.id);
    for (const id of ids) this.store.revoke(id, this.now());
    return { ok: true, revoked: ids };
  }

  list(by: string): Grant[] | null {
    return by === this.person ? this.store.all() : null;
  }

  /** The person's live grants that name `requester` (or their agent, or everyone): theirs to know. */
  async naming(requester: string): Promise<Array<Pick<Grant, "id" | "subject" | "mode" | "constraints" | "expires_at">>> {
    const view = companyView(await this.company.snapshot());
    if (view.roleOf(requester) === null) return [];
    const now = this.now();
    return this.store
      .all()
      .filter((g) => g.revoked_at === undefined && (g.expires_at === undefined || g.expires_at > now) && !(g.one_shot && g.used_at !== undefined))
      .filter((g) => ((g.grantee.kind === "person" || g.grantee.kind === "agent-of-person") && g.grantee.id === requester) || g.grantee.kind === "any-member" || g.grantee.kind === "company" || (g.grantee.kind === "team" && view.teamsOf(requester).includes(g.grantee.id as string)))
      .map((g) => ({ id: g.id, subject: g.subject, mode: g.mode, constraints: g.constraints, ...(g.expires_at !== undefined ? { expires_at: g.expires_at } : {}) }));
  }

  all(): Grant[] {
    return this.store.all();
  }
}
