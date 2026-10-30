// Company membership, in the `Company` object's SQLite: the owning store of who belongs to the
// tenant and with which role (AD-22). Members come from two places: the tenant file, which the
// platform writes into the agent script as `MEMBERS` and which is re-applied whenever it changes,
// and invitations an admin makes in the app. Every lookup reads this store; nothing a request or a
// token carries makes someone a member.
import type { AccessSync } from "./access-sync.ts";

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS members (
  email TEXT PRIMARY KEY,
  role TEXT NOT NULL,
  source TEXT NOT NULL,
  invited_by TEXT,
  at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS departures (email TEXT PRIMARY KEY, at INTEGER NOT NULL);`;

/** Owners can do everything admins can (billing and deletion are theirs alone, later); members own their agent. */
export type Role = "owner" | "admin" | "member";
export const ROLES: readonly Role[] = ["owner", "admin", "member"];

/** Whether a role acts for the company: an owner or an admin. */
export function isAdminRole(role: Role | null | undefined): boolean {
  return role === "owner" || role === "admin";
}
export type MemberSource = "tenant-file" | "invite";

export interface Member {
  email: string;
  role: Role;
  source: MemberSource;
  invitedBy: string | null;
  at: number;
}

/** `access` is the Company's Access sync (M14.3); the member store alone leaves it out. */
export type InviteResult = { ok: true; member: Member; access?: AccessSync } | { ok: false; code: "NOT_AN_ADMIN" | "INVITE_EMAIL_INVALID" | "INVITE_ROLE_INVALID" | "ALREADY_A_MEMBER" | "SEATS_FULL" };
export type RoleResult = { ok: true; member: Member } | { ok: false; code: "NOT_AN_ADMIN" | "NOT_AN_OWNER" | "NOT_A_MEMBER" | "ROLE_INVALID" | "LAST_OWNER" };

const EMAIL = /^[a-z0-9._+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/;

/** A member address as stored and compared: trimmed and lower-cased. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isEmail(email: string): boolean {
  return EMAIL.test(email);
}

/** Parses the `MEMBERS` var the generator writes; a malformed seed is a platform fault, never a member. */
export function parseSeed(raw: string | undefined): { email: string; role: Role }[] {
  if (!raw) return [];
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("MEMBERS_SEED_INVALID: not JSON");
  }
  if (!Array.isArray(value)) throw new Error("MEMBERS_SEED_INVALID: not an array");
  return value.map((m) => {
    const r = m as Record<string, unknown>;
    const email = typeof r.email === "string" ? normalizeEmail(r.email) : "";
    if (!isEmail(email) || !ROLES.includes(r.role as Role)) throw new Error("MEMBERS_SEED_INVALID: a member is malformed");
    return { email, role: r.role as Role };
  });
}

/** Display names from the `MEMBERS` var; the address stands in for a member without one. */
export function displayNames(raw: string | undefined): (email: string) => string {
  const names = new Map<string, string>();
  try {
    for (const m of JSON.parse(raw ?? "[]") as Array<{ email?: unknown; name?: unknown }>) {
      if (typeof m.email === "string" && typeof m.name === "string" && m.name) names.set(normalizeEmail(m.email), m.name);
    }
  } catch {
    // A malformed seed names nobody; membership itself refuses it (`parseSeed`).
  }
  return (email) => names.get(normalizeEmail(email)) ?? email;
}

type Row = { email: string; role: Role; source: MemberSource; invited_by: string | null; at: number };
const toMember = (r: Row): Member => ({ email: r.email, role: r.role, source: r.source, invitedBy: r.invited_by, at: r.at });

export class CompanyMembers {
  private ready = false;
  private readonly storage: Pick<DurableObjectStorage, "sql">;
  private readonly seed: string;
  private readonly now: () => number;

  /** `seed` is the raw `MEMBERS` var; it is applied on first use and again whenever it changes. */
  constructor(storage: Pick<DurableObjectStorage, "sql">, seed: string | undefined, now: () => number) {
    this.storage = storage;
    this.seed = seed ?? "[]";
    this.now = now;
  }

  private get sql(): SqlStorage {
    if (!this.ready) {
      this.applySeed();
      this.ready = true;
    }
    return this.storage.sql;
  }

  /**
   * The tenant file is the source of its own rows: they are replaced as a set, so a member removed
   * from the file stops being one. An invited member the file later lists becomes a file row.
   */
  private applySeed(): void {
    const sql = this.storage.sql;
    const applied = sql.exec<{ value: string }>("SELECT value FROM meta WHERE key = 'seed'").toArray()[0]?.value;
    if (applied === this.seed) return;
    const members = parseSeed(this.seed);
    const at = this.now();
    sql.exec("DELETE FROM members WHERE source = 'tenant-file'");
    const departed = new Set(sql.exec<{ email: string }>("SELECT email FROM departures").toArray().map((r) => r.email));
    for (const m of members) {
      if (departed.has(m.email)) continue;
      sql.exec(
        "INSERT INTO members (email, role, source, invited_by, at) VALUES (?, ?, 'tenant-file', NULL, ?) ON CONFLICT(email) DO UPDATE SET role = excluded.role, source = 'tenant-file', invited_by = NULL",
        m.email, m.role, at,
      );
    }
    sql.exec("INSERT INTO meta (key, value) VALUES ('seed', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", this.seed);
  }

  lookup(email: string): Member | null {
    const row = this.sql.exec<Row>("SELECT * FROM members WHERE email = ?", normalizeEmail(email)).toArray()[0];
    return row ? toMember(row) : null;
  }

  list(): Member[] {
    return this.sql.exec<Row>("SELECT * FROM members ORDER BY email").toArray().map(toMember);
  }

  /** Whether `email` may leave (F40, P14 delta 3): asked before anything of theirs is purged, and again by `depart`. */
  mayDepart(email: string): { ok: true } | { ok: false; code: "NOT_A_MEMBER" | "LAST_OWNER" } {
    const m = this.lookup(email);
    if (!m) return { ok: false, code: "NOT_A_MEMBER" };
    if (m.role === "owner" && this.list().filter((x) => x.role === "owner").length === 1) return { ok: false, code: "LAST_OWNER" };
    return { ok: true };
  }

  /**
   * Offboarding releases the seat (M11): the member's row goes, and a tenant-file row stays gone when
   * the file is re-applied, until an admin invites the person again. The last owner cannot leave.
   */
  depart(email: string): { ok: true } | { ok: false; code: "NOT_A_MEMBER" | "LAST_OWNER" } {
    const may = this.mayDepart(email);
    const m = this.lookup(email);
    if (!may.ok || !m) return may.ok ? { ok: false, code: "NOT_A_MEMBER" } : may;
    this.sql.exec("DELETE FROM members WHERE email = ?", m.email);
    this.sql.exec("INSERT OR REPLACE INTO departures (email, at) VALUES (?, ?)", m.email, this.now());
    return { ok: true };
  }

  /** An admin invites someone; the admin check is made here, where membership lives. */
  invite(by: string, email: string, role: unknown): InviteResult {
    if (!isAdminRole(this.lookup(by)?.role)) return { ok: false, code: "NOT_AN_ADMIN" };
    const address = normalizeEmail(email);
    if (!isEmail(address)) return { ok: false, code: "INVITE_EMAIL_INVALID" };
    if (role !== "admin" && role !== "member") return { ok: false, code: "INVITE_ROLE_INVALID" };
    if (this.lookup(address)) return { ok: false, code: "ALREADY_A_MEMBER" };
    this.sql.exec("DELETE FROM departures WHERE email = ?", address);
    this.sql.exec("INSERT INTO members (email, role, source, invited_by, at) VALUES (?, ?, 'invite', ?, ?)", address, role, normalizeEmail(by), this.now());
    return { ok: true, member: this.lookup(address) as Member };
  }

  /**
   * An admin changes a member's role between admin and member; only an owner makes or unmakes an
   * owner, and the last owner stays one. A tenant-file row keeps the new role until the file changes.
   */
  setRole(by: string, email: string, role: unknown): RoleResult {
    const actor = this.lookup(by)?.role;
    if (!isAdminRole(actor)) return { ok: false, code: "NOT_AN_ADMIN" };
    if (!ROLES.includes(role as Role)) return { ok: false, code: "ROLE_INVALID" };
    const target = this.lookup(email);
    if (!target) return { ok: false, code: "NOT_A_MEMBER" };
    if ((role === "owner" || target.role === "owner") && actor !== "owner") return { ok: false, code: "NOT_AN_OWNER" };
    if (target.role === "owner" && role !== "owner" && this.list().filter((m) => m.role === "owner").length === 1) return { ok: false, code: "LAST_OWNER" };
    this.sql.exec("UPDATE members SET role = ? WHERE email = ?", role as Role, target.email);
    return { ok: true, member: this.lookup(target.email) as Member };
  }
}
