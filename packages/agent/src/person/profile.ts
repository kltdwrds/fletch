// A person's profile, in the `Person` object's SQLite: who this object is for, the role they were
// enrolled with and by whom. Written when an admin's invitation creates the Person (M4.1); the
// Company stays the store that decides membership, this row only records the enrolment.

export const SCHEMA = "CREATE TABLE IF NOT EXISTS profile (email TEXT PRIMARY KEY, role TEXT NOT NULL, enrolled_by TEXT, at INTEGER NOT NULL);";

export interface Profile {
  email: string;
  role: import("../company/members.ts").Role;
  enrolledBy: string | null;
  at: number;
}

export class PersonProfile {
  private readonly storage: Pick<DurableObjectStorage, "sql">;
  private readonly person: string;

  constructor(storage: Pick<DurableObjectStorage, "sql">, person: string) {
    this.storage = storage;
    this.person = person;
  }

  private get sql(): SqlStorage {
    return this.storage.sql;
  }

  /** Idempotent: a second enrolment keeps the first row. */
  enroll(input: { role: Profile["role"]; enrolledBy: string | null }, now: number): Profile {
    this.sql.exec("INSERT INTO profile (email, role, enrolled_by, at) VALUES (?, ?, ?, ?) ON CONFLICT(email) DO NOTHING", this.person, input.role, input.enrolledBy, now);
    return this.get() as Profile;
  }

  get(): Profile | null {
    const r = this.sql.exec<{ email: string; role: Profile["role"]; enrolled_by: string | null; at: number }>("SELECT * FROM profile WHERE email = ?", this.person).toArray()[0];
    return r ? { email: r.email, role: r.role, enrolledBy: r.enrolled_by, at: r.at } : null;
  }
}

/** The person's display name from the tenant file's member list, when it names one. */
export function memberName(members: string, person: string): { name?: string } {
  try {
    const found = (JSON.parse(members) as Array<{ email?: unknown; name?: unknown }>).find((m) => m.email === person);
    return typeof found?.name === "string" && found.name ? { name: found.name } : {};
  } catch {
    return {};
  }
}
