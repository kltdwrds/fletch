// Teams (authority-model.md "Roles and teams"), in the `Company` object's SQLite: named sets of
// members, grant targets and a memory scope. Admins create teams and change who is in them; a team
// owns nothing yet. Membership is read through the member table on every call, so someone who leaves
// the company leaves every team with it.
import { TEAM_ID } from "../memory/disclosure.ts";
import { type CompanyMembers, isAdminRole, normalizeEmail } from "./members.ts";

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS teams (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_by TEXT NOT NULL, at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS team_members (team TEXT NOT NULL, email TEXT NOT NULL, added_by TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (team, email));`;

export interface Team {
  id: string;
  name: string;
  members: string[];
}

type Refusal = { ok: false; code: string; reason: string };
const notAdmin: Refusal = { ok: false, code: "NOT_AN_ADMIN", reason: "only an admin manages teams" };

export class CompanyTeams {
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

  private isAdmin(by: string): boolean {
    return isAdminRole(this.members.lookup(by)?.role);
  }

  /** Every team with its current members; a row for someone no longer a member is not a membership. */
  list(): Team[] {
    const current = new Set(this.members.list().map((m) => m.email));
    const rows = this.sql.exec<{ team: string; email: string }>("SELECT team, email FROM team_members ORDER BY team, email").toArray();
    return this.sql
      .exec<{ id: string; name: string }>("SELECT id, name FROM teams ORDER BY id")
      .toArray()
      .map((t) => ({ id: t.id, name: t.name, members: rows.filter((r) => r.team === t.id && current.has(r.email)).map((r) => r.email) }));
  }

  /** `{ team: [members] }`, the shape the grants engine's company view reads. */
  map(): Record<string, string[]> {
    return Object.fromEntries(this.list().map((t) => [t.id, t.members]));
  }

  teamsOf(email: string): string[] {
    const who = normalizeEmail(email);
    return this.list().filter((t) => t.members.includes(who)).map((t) => t.id);
  }

  create(by: string, input: unknown): { ok: true; team: Team } | Refusal {
    if (!this.isAdmin(by)) return notAdmin;
    const b = (input ?? {}) as Record<string, unknown>;
    if (typeof b.id !== "string" || !TEAM_ID.test(b.id)) return { ok: false, code: "TEAM_INVALID", reason: "a team id is lowercase letters, digits and dashes, at most 40" };
    const name = typeof b.name === "string" ? b.name.trim().slice(0, 80) : "";
    if (!name) return { ok: false, code: "TEAM_INVALID", reason: "a team has a name" };
    if (this.sql.exec("SELECT id FROM teams WHERE id = ?", b.id).toArray().length) return { ok: false, code: "TEAM_EXISTS", reason: `team ${b.id} exists` };
    this.sql.exec("INSERT INTO teams (id, name, created_by, at) VALUES (?, ?, ?, ?)", b.id, name, normalizeEmail(by), this.now());
    return { ok: true, team: { id: b.id, name, members: [] } };
  }

  /** Adds or removes one member of a team; only someone the member table lists can be added. */
  setMember(by: string, team: string, email: string, inTeam: boolean): { ok: true; team: Team } | Refusal {
    if (!this.isAdmin(by)) return notAdmin;
    if (!this.sql.exec("SELECT id FROM teams WHERE id = ?", team).toArray().length) return { ok: false, code: "TEAM_UNKNOWN", reason: `no team ${team}` };
    const who = normalizeEmail(email);
    if (inTeam) {
      if (!this.members.lookup(who)) return { ok: false, code: "NOT_A_MEMBER", reason: "only a member of the company joins a team" };
      this.sql.exec("INSERT INTO team_members (team, email, added_by, at) VALUES (?, ?, ?, ?) ON CONFLICT(team, email) DO NOTHING", team, who, normalizeEmail(by), this.now());
    } else this.sql.exec("DELETE FROM team_members WHERE team = ? AND email = ?", team, who);
    return { ok: true, team: this.list().find((t) => t.id === team) as Team };
  }
}
