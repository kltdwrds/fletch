// Company connectors (authority-model.md "Connectors: personal and company", M10.2): a shared
// account an admin connects into the company, such as the books or a company GitHub. The list lives
// in the `Company` object's SQLite and names no value: the credential goes straight to the `Vault`
// under `cred://company-<id>`. Members' agents reach a connector only through a company grant by
// role or team, which the Vault asks the Company about on every resolution (`entitled`).
import { resolve } from "../grants/engine.ts";
import { REF } from "../grants/validate.ts";
import { type CompanySnapshot, companyView } from "./authority.ts";
import { type CompanyMembers, isAdminRole, normalizeEmail } from "./members.ts";

export const SCHEMA = "CREATE TABLE IF NOT EXISTS company_connectors (id TEXT PRIMARY KEY, hosts TEXT NOT NULL, by TEXT NOT NULL, at INTEGER NOT NULL);";
export const CONNECTOR_ID = /^[a-z][a-z0-9-]{0,39}$/;

export interface CompanyConnector {
  id: string;
  ref: string;
  hosts: string[];
  connectedBy: string;
  at: number;
}

/** The Vault's half: it holds the value and answers with a code, never the value. */
export interface CompanyVault {
  putCompany(input: { connector: string; value: string; hosts: string[]; by: string }): Promise<{ ok: true; ref: string } | { ok: false; code: string; reason: string }>;
  removeCompany(connector: string, by?: string): Promise<boolean>;
  /** A departing member's credentials, grants and saved logins (M24.3, `Company.depart`). */
  purgePerson(person: string): Promise<{ ok: true; credentials: number }>;
}

type Refusal = { ok: false; code: string; reason: string };
const notAdmin: Refusal = { ok: false, code: "NOT_AN_ADMIN", reason: "only an admin connects or removes a company connector" };

/**
 * Whether `person` holds a company grant to `connector`: the grants engine over the company's own
 * grants and policies, for the action the purpose names. A grant that matched them and does not deny
 * entitles them (an asking grant has been asked by the time the call reaches the Vault); no matching
 * grant, a policy cap or a deny does not.
 */
export function entitled(snapshot: CompanySnapshot, person: string, connector: string, purpose: string, at: number): boolean {
  const kind = /^[a-z][a-z0-9-]*_[a-z0-9_]+$/.test(purpose) ? purpose.replace("_", ".") : `${connector}.use`;
  const companyGrants = snapshot.grants.filter((g) => g.grantor.kind === "company");
  const d = resolve(
    {
      actor: `agent:${person}`, principal: person, actionKind: REF.test(kind) ? kind : `${connector}.use`,
      subject: { scope: "company", connector, ref: `connector:${connector}` },
      counterpart: { kind: "own-agent" }, origin: person, hops: 0, at,
    },
    companyGrants,
    companyView(snapshot),
    snapshot.uses,
  );
  return d.decision === "auto" || (d.decision === "ask" && d.grantId !== undefined);
}

export class CompanyConnectors {
  private readonly storage: Pick<DurableObjectStorage, "sql">;
  private readonly members: CompanyMembers;
  private readonly now: () => number;

  constructor(storage: Pick<DurableObjectStorage, "sql">, members: CompanyMembers, now: () => number) {
    this.storage = storage;
    this.members = members;
    this.now = now;
  }

  private get sql(): SqlStorage {
    return this.storage.sql;
  }

  list(): CompanyConnector[] {
    return this.sql
      .exec<{ id: string; hosts: string; by: string; at: number }>("SELECT id, hosts, by, at FROM company_connectors ORDER BY id")
      .toArray()
      .map((r) => ({ id: r.id, ref: `cred://company-${r.id}`, hosts: JSON.parse(r.hosts) as string[], connectedBy: r.by, at: r.at }));
  }

  has(id: string): boolean {
    return this.list().some((c) => c.id === id);
  }

  /** An admin connects a shared account; the value goes to the Vault and is not kept here. */
  async connect(by: string, input: unknown, vault: CompanyVault): Promise<{ ok: true; connector: CompanyConnector } | Refusal> {
    if (!isAdminRole(this.members.lookup(by)?.role)) return notAdmin;
    const i = (input ?? {}) as Record<string, unknown>;
    if (typeof i.id !== "string" || !CONNECTOR_ID.test(i.id)) return { ok: false, code: "CONNECTOR_INVALID", reason: "a connector id is lower-case letters, digits and dashes" };
    if (typeof i.value !== "string" || !Array.isArray(i.hosts)) return { ok: false, code: "CONNECTOR_INVALID", reason: "a connector needs a value and its hosts" };
    const hosts = i.hosts.map(String);
    const put = await vault.putCompany({ connector: i.id, value: i.value, hosts, by: normalizeEmail(by) });
    if (!put.ok) return { ok: false, code: put.code, reason: put.reason };
    this.sql.exec("INSERT OR REPLACE INTO company_connectors (id, hosts, by, at) VALUES (?, ?, ?, ?)", i.id, JSON.stringify(hosts), normalizeEmail(by), this.now());
    return { ok: true, connector: this.list().find((c) => c.id === i.id) as CompanyConnector };
  }

  async remove(by: string, id: string, vault: CompanyVault): Promise<{ ok: true } | Refusal> {
    if (!isAdminRole(this.members.lookup(by)?.role)) return notAdmin;
    if (!this.has(id)) return { ok: false, code: "CONNECTOR_UNKNOWN", reason: `no company connector ${id}` };
    await vault.removeCompany(id, normalizeEmail(by));
    this.sql.exec("DELETE FROM company_connectors WHERE id = ?", id);
    return { ok: true };
  }
}
