// The company's half of the authority model (AD-22), in the `Company` object's SQLite: company
// policies and company grants, each made by an admin the member table names, and the snapshot every
// decision reads, with the company's teams (M10.1).
import { GrantStore, type CreateResult, type GrantUse } from "../grants/store.ts";
import type { CompanyView, Grant, Policy } from "../grants/types.ts";
import { REF } from "../grants/validate.ts";
import { type CompanyMembers, isAdminRole, type Role } from "./members.ts";
import type { CompanyTeams } from "./teams.ts";

export const SCHEMA = "CREATE TABLE IF NOT EXISTS policies (id TEXT PRIMARY KEY, body TEXT NOT NULL, at INTEGER NOT NULL);";

/** What a decision reads from the company, fresh on every call. */
export interface CompanySnapshot {
  members: Array<{ email: string; role: Role }>;
  teams: Record<string, string[]>;
  policies: Policy[];
  grants: Grant[];
  uses: Record<string, number[]>;
}

export function companyView(s: CompanySnapshot): CompanyView {
  const roles = new Map(s.members.map((m) => [m.email, m.role]));
  return {
    roleOf: (p) => roles.get(p) ?? null,
    teamsOf: (p) => Object.entries(s.teams).filter(([, members]) => members.includes(p)).map(([t]) => t),
    policies: s.policies,
    approverRole: "admin",
  };
}

type Refusal = { ok: false; code: string; reason: string };
const notAdmin: Refusal = { ok: false, code: "NOT_AN_ADMIN", reason: "only an admin acts for the company" };

export class CompanyAuthority {
  private readonly storage: Pick<DurableObjectStorage, "sql" | "transactionSync">;
  private readonly members: CompanyMembers;
  private readonly teams: CompanyTeams;
  private readonly grants: GrantStore;
  private readonly now: () => number;

  constructor(storage: Pick<DurableObjectStorage, "sql" | "transactionSync">, tenant: string, members: CompanyMembers, teams: CompanyTeams, now: () => number) {
    this.storage = storage;
    this.members = members;
    this.teams = teams;
    this.grants = new GrantStore(storage, tenant, { kind: "company", id: tenant });
    this.now = now;
  }

  private get sql(): SqlStorage {
    return this.storage.sql;
  }

  private isAdmin(by: string): boolean {
    return isAdminRole(this.members.lookup(by)?.role);
  }

  snapshot(): CompanySnapshot {
    return {
      members: this.members.list().map((m) => ({ email: m.email, role: m.role })),
      teams: this.teams.map(),
      policies: this.policies(),
      grants: this.grants.all(),
      uses: this.grants.uses(),
    };
  }

  policies(): Policy[] {
    return this.sql.exec<{ body: string }>("SELECT body FROM policies ORDER BY at, id").toArray().map((r) => JSON.parse(r.body) as Policy);
  }

  /** A deny for an action kind, for everyone or a role or a team; admins only. */
  addPolicy(by: string, input: unknown): { ok: true; policy: Policy } | Refusal {
    if (!this.isAdmin(by)) return notAdmin;
    const p = (input ?? {}) as Record<string, unknown>;
    if (p.kind !== "deny-action" || typeof p.actionKind !== "string" || !REF.test(p.actionKind)) return { ok: false, code: "POLICY_INVALID", reason: "a policy denies an action kind" };
    if (p.role !== undefined && p.role !== "owner" && p.role !== "admin" && p.role !== "member") return { ok: false, code: "POLICY_INVALID", reason: "role is owner, admin or member" };
    if (p.team !== undefined && (typeof p.team !== "string" || !REF.test(p.team))) return { ok: false, code: "POLICY_INVALID", reason: "team is an id" };
    const policy: Policy = { id: `p_${crypto.randomUUID().replaceAll("-", "")}`, kind: "deny-action", actionKind: p.actionKind, ...(p.role ? { role: p.role as Policy["role"] } : {}), ...(p.team ? { team: p.team as string } : {}) };
    this.sql.exec("INSERT INTO policies (id, body, at) VALUES (?, ?, ?)", policy.id, JSON.stringify(policy), this.now());
    return { ok: true, policy };
  }

  /** A company grant over company resources, signed by the company through an admin. */
  createGrant(by: string, input: unknown): CreateResult {
    if (!this.isAdmin(by)) return notAdmin;
    return this.grants.create(input, this.now());
  }

  /** Admins revoke company grants; personal grants are their person's. */
  revokeGrant(by: string, id: string): { ok: true } | Refusal {
    if (!this.isAdmin(by)) return notAdmin;
    const r = this.grants.revoke(id, this.now());
    return r.ok ? r : { ok: false, code: r.code, reason: "no such company grant" };
  }

  use(grantId: string, effectId: string, at: number): GrantUse {
    return this.grants.use(grantId, effectId, at);
  }
}
