// The dormant sweep (M25.3). After a rollout the platform asks each tenant's agent to wake every object it has: waking runs the
// object's constructor, which applies its named migrations, and each object answers with what that wake applied and what its
// list still has unapplied. An object that cannot answer is reported failed, never counted as migrated. The tenant is "ready"
// only when every object answered and none is behind; the rollout refuses its next step otherwise (`MIGRATION_BEHIND`).
export interface Probe {
  object: string;
  /** Migrations this wake applied. */
  applied: number;
  /** Names of its list the store has not applied. */
  behind: string[];
}

export interface PersonProbe extends Probe {
  chats: string[];
  /** The `Job` objects' names (`owner/id`). */
  jobs: string[];
}

export interface SweepDeps {
  members(): Promise<string[]>;
  company(): Promise<Probe>;
  ledger(): Promise<Probe>;
  vault(): Promise<Probe>;
  person(email: string): Promise<PersonProbe>;
  chat(id: string): Promise<Probe>;
  job(name: string): Promise<Probe>;
}

export interface SweepReport {
  ok: boolean;
  code?: "MIGRATION_BEHIND" | "MIGRATION_SWEEP_FAILED";
  /** Objects that answered. */
  woken: number;
  /** Objects whose wake applied at least one migration. */
  migrated: number;
  /** Migrations applied across the tenant by this sweep. */
  applied: number;
  behind: Array<{ object: string; names: string[] }>;
  failed: Array<{ object: string; reason: string }>;
}

export async function sweepTenant(d: SweepDeps): Promise<SweepReport> {
  const r: SweepReport = { ok: true, woken: 0, migrated: 0, applied: 0, behind: [], failed: [] };
  const wake = async <T extends Probe>(label: string, ask: () => Promise<T>): Promise<T | null> => {
    try {
      const p = await ask();
      r.woken++;
      r.applied += p.applied;
      if (p.applied > 0) r.migrated++;
      if (p.behind.length) r.behind.push({ object: label, names: p.behind });
      return p;
    } catch (err) {
      r.failed.push({ object: label, reason: String(err instanceof Error ? err.message : err).slice(0, 200) });
      return null;
    }
  };
  await wake("company", d.company);
  await wake("ledger", d.ledger);
  await wake("vault", d.vault);
  let members: string[] = [];
  try {
    members = await d.members();
  } catch (err) {
    r.failed.push({ object: "members", reason: String(err instanceof Error ? err.message : err).slice(0, 200) });
  }
  for (const email of members) {
    const p = await wake(`person:${email}`, () => d.person(email));
    if (!p) continue;
    for (const id of p.chats) await wake(`chat:${id}`, () => d.chat(id));
    for (const name of p.jobs) await wake(`job:${name}`, () => d.job(name));
  }
  r.ok = r.behind.length === 0 && r.failed.length === 0;
  if (r.behind.length) r.code = "MIGRATION_BEHIND";
  else if (r.failed.length) r.code = "MIGRATION_SWEEP_FAILED";
  return r;
}
