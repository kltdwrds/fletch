// Company instructions (AD-6, authority-model.md "Roles and teams"): terminology, procedures and
// style an admin writes, kept as versions in the `Company` object's SQLite. The context assembly
// fences the current version with a source label below the person's standing files; nothing in it
// is a permission, because anything that must bind is a policy evaluated in code.
import { isAdminRole, type CompanyMembers, normalizeEmail } from "./members.ts";

export const SCHEMA = "CREATE TABLE IF NOT EXISTS instructions (version INTEGER PRIMARY KEY, text TEXT NOT NULL, by TEXT NOT NULL, at INTEGER NOT NULL);";
export const MAX_INSTRUCTIONS_CHARS = 8000;

export type InstructionsVersion = {
  version: number;
  text: string;
  by: string;
  at: number;
};

export class CompanyInstructions {
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

  /** The current version; null until an admin writes one. Every member's agent reads it. */
  current(): InstructionsVersion | null {
    return this.sql.exec<InstructionsVersion>("SELECT version, text, by, at FROM instructions ORDER BY version DESC LIMIT 1").toArray()[0] ?? null;
  }

  history(): InstructionsVersion[] {
    return this.sql.exec<InstructionsVersion>("SELECT version, text, by, at FROM instructions ORDER BY version").toArray();
  }

  /** A new version by an admin; an empty text clears the block with a version of its own. */
  write(by: string, text: unknown): { ok: true; version: InstructionsVersion } | { ok: false; code: string; reason: string } {
    if (!isAdminRole(this.members.lookup(by)?.role)) return { ok: false, code: "NOT_AN_ADMIN", reason: "only an admin writes company instructions" };
    if (typeof text !== "string" || text.length > MAX_INSTRUCTIONS_CHARS) return { ok: false, code: "INSTRUCTIONS_INVALID", reason: `instructions are text of at most ${MAX_INSTRUCTIONS_CHARS} characters` };
    const version = (this.current()?.version ?? 0) + 1;
    this.sql.exec("INSERT INTO instructions (version, text, by, at) VALUES (?, ?, ?, ?)", version, text, normalizeEmail(by), this.now());
    return { ok: true, version: this.current() as InstructionsVersion };
  }
}
