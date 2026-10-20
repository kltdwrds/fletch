// Which jobs are the person's (M14.2): each `Job` object tells its owner's `Person` when it holds a
// job, so the app's job list can name them; the `Job` itself still decides every read and change.
import { JOB_ID } from "../jobs/body.ts";

import { validZone } from "../jobs/schedule.ts";

export const SCHEMA = "CREATE TABLE IF NOT EXISTS job_index (id TEXT PRIMARY KEY, noted_at INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS job_settings (k TEXT PRIMARY KEY, v TEXT NOT NULL);";

export class PersonJobIndex {
  private readonly storage: Pick<DurableObjectStorage, "sql">;

  constructor(storage: Pick<DurableObjectStorage, "sql">) {
    this.storage = storage;
  }

  private get sql(): SqlStorage {
    return this.storage.sql;
  }

  note(id: string, now: number): boolean {
    if (!JOB_ID.test(id)) return false;
    this.sql.exec("INSERT OR IGNORE INTO job_index (id, noted_at) VALUES (?, ?)", id, now);
    return true;
  }

  /** A removed job leaves the person's list (M25.6); its object keeps the runs. */
  forget(id: string): void {
    this.sql.exec("DELETE FROM job_index WHERE id = ?", id);
  }

  /**
   * The person's home zone for jobs (M25.2): the first valid zone a client reports is saved, and
   * every later job reads the saved one, so a zone reported while travelling never moves a job.
   * UTC until one is seen.
   */
  homeZone(seen: string | undefined): string {
    const saved = this.sql.exec<{ v: string }>("SELECT v FROM job_settings WHERE k = 'home_zone'").toArray()[0]?.v;
    if (saved) return saved;
    if (!seen || !validZone(seen)) return "UTC";
    this.sql.exec("INSERT OR IGNORE INTO job_settings (k, v) VALUES ('home_zone', ?)", seen);
    return seen;
  }

  list(): string[] {
    return this.sql.exec<{ id: string }>("SELECT id FROM job_index ORDER BY noted_at, id").toArray().map((r) => r.id);
  }
}
