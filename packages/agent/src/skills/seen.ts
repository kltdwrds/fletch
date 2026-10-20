// A per-person hash of each skill body they last read (M25.3). The first read records it; a read of a body that changed since
// (a rollout rewrote a platform skill, a colleague edited a company one) returns "changed" once, and records the new hash.
export const SCHEMA = "CREATE TABLE IF NOT EXISTS skill_seen (name TEXT PRIMARY KEY, hash TEXT NOT NULL, seen_at INTEGER NOT NULL)";

export type SeenState = "first" | "same" | "changed";

export class SkillSeen {
  private readonly storage: Pick<DurableObjectStorage, "sql">;

  constructor(storage: Pick<DurableObjectStorage, "sql">) {
    this.storage = storage;
  }

  touch(name: string, hash: string, now: number): SeenState {
    const sql = this.storage.sql;
    const had = sql.exec<{ hash: string }>("SELECT hash FROM skill_seen WHERE name = ?", name).toArray()[0]?.hash;
    if (had === hash) return "same";
    sql.exec("INSERT OR REPLACE INTO skill_seen (name, hash, seen_at) VALUES (?, ?, ?)", name, hash, now);
    return had === undefined ? "first" : "changed";
  }
}

/** The body's hash, short enough to store and long enough that a changed body does not collide. */
export async function bodyHash(body: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body)));
  return [...d.slice(0, 12)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** The one fenced notice a changed skill gets on its next use; platform text, never the skill's own. */
export const skillUpdatedNotice = (name: string): string =>
  `<<skill-updated name=${name}>> This skill changed since you last read it. Follow the text below, not what you remember of the earlier version. <<end>>\n\n`;
