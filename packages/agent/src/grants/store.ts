// A grant table and its use log in one object's SQLite: the `Person`'s personal grants and the
// `Company`'s company grants (AD-22) share this store, each signing as itself. A grant exists only
// if `checkGrant` admitted it; revoking and using are recorded, never deleted, so the journal's
// verifier can re-resolve any row at its instant.
import type { Grant } from "./types.ts";
import { checkGrant, type GrantInput } from "./validate.ts";

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS grants (
  id TEXT PRIMARY KEY,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  revoked_at INTEGER,
  used_at INTEGER
);
CREATE TABLE IF NOT EXISTS grant_uses (
  effect_id TEXT PRIMARY KEY,
  grant_id TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS committed_effects (
  effect_id TEXT PRIMARY KEY,
  grant_id TEXT NOT NULL,
  at INTEGER NOT NULL
);`;

export type Signer = { kind: "person"; id: string } | { kind: "company"; id: string };
/** One use's answer: recorded now, already recorded for this effect, or the grant cannot be used. */
export type GrantUse = "used" | "repeat" | "spent";
export type CreateResult = { ok: true; grant: Grant } | { ok: false; code: string; reason: string };

const hex = (bytes: Uint8Array) => [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
export const newGrantId = () => `g_${hex(crypto.getRandomValues(new Uint8Array(16)))}`;

type Row = { id: string; body: string; created_at: number; revoked_at: number | null; used_at: number | null };

export class GrantStore {
  private readonly storage: Pick<DurableObjectStorage, "sql" | "transactionSync">;
  private readonly tenant: string;
  readonly signer: Signer;

  constructor(storage: Pick<DurableObjectStorage, "sql" | "transactionSync">, tenant: string, signer: Signer) {
    this.storage = storage;
    this.tenant = tenant;
    this.signer = signer;
  }

  private get sql(): SqlStorage {
    return this.storage.sql;
  }

  /** Stores a grant this store's signer signs; the caller has already decided who may sign. */
  create(input: unknown, now: number): CreateResult {
    const checked = checkGrant(input, this.signer, now);
    if (!checked.ok) return checked;
    const grant: Grant = { ...(checked.grant as GrantInput), id: newGrantId(), tenant: this.tenant, created_at: now };
    this.sql.exec("INSERT INTO grants (id, body, created_at) VALUES (?, ?, ?)", grant.id, JSON.stringify(grant), now);
    return { ok: true, grant };
  }

  revoke(id: string, now: number): { ok: true } | { ok: false; code: "GRANT_UNKNOWN" } {
    if (!this.get(id)) return { ok: false, code: "GRANT_UNKNOWN" };
    this.sql.exec("UPDATE grants SET revoked_at = COALESCE(revoked_at, ?) WHERE id = ?", now, id);
    return { ok: true };
  }

  get(id: string): Grant | null {
    const row = this.sql.exec<Row>("SELECT * FROM grants WHERE id = ?", id).toArray()[0];
    return row ? toGrant(row) : null;
  }

  /** Every grant ever signed here, revoked and used ones included. */
  all(): Grant[] {
    return this.sql.exec<Row>("SELECT * FROM grants ORDER BY created_at, id").toArray().map(toGrant);
  }

  /** Earlier automatic uses per grant, for rate constraints. */
  uses(): Record<string, number[]> {
    const out: Record<string, number[]> = {};
    for (const u of this.sql.exec<{ grant_id: string; at: number }>("SELECT grant_id, at FROM grant_uses ORDER BY at").toArray()) out[u.grant_id] = [...(out[u.grant_id] ?? []), u.at];
    return out;
  }

  /**
   * Records one automatic use for one effect, once: a one-shot grant is spent by its first use. False
   * when the grant was already spent by another effect, so the caller must not act.
   */
  /** Whether this principal already committed the effect, under any grant (M20.1). */
  committed(effectId: string): boolean {
    return this.sql.exec("SELECT effect_id FROM committed_effects WHERE effect_id = ?", effectId).toArray().length > 0;
  }

  /** Records that the principal committed the effect, under whichever store's grant it used. */
  markCommitted(effectId: string, grantId: string, at: number): void {
    this.sql.exec("INSERT OR IGNORE INTO committed_effects (effect_id, grant_id, at) VALUES (?, ?, ?)", effectId, grantId, at);
  }

  /**
   * Records one use of a grant by one effect. An effect id already recorded is answered `repeat` (M20.1,
   * QYVR-172): an action commits once per effect, so a retried or doubled release never runs it again.
   */
  use(grantId: string, effectId: string, at: number): GrantUse {
    return this.storage.transactionSync((): GrantUse => {
      if (this.sql.exec("SELECT effect_id FROM grant_uses WHERE effect_id = ?", effectId).toArray().length) return "repeat";
      const g = this.get(grantId);
      if (!g) return "spent";
      if (g.one_shot) {
        if (g.used_at !== undefined) return "spent";
        this.sql.exec("UPDATE grants SET used_at = ? WHERE id = ?", at, grantId);
      }
      this.sql.exec("INSERT INTO grant_uses (effect_id, grant_id, at) VALUES (?, ?, ?)", effectId, grantId, at);
      return "used";
    });
  }
}

function toGrant(r: Row): Grant {
  const g = JSON.parse(r.body) as Grant;
  return { ...g, ...(r.revoked_at !== null ? { revoked_at: r.revoked_at } : {}), ...(r.used_at !== null ? { used_at: r.used_at } : {}) };
}
