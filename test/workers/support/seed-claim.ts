// Claims for tests that need one on a line: since M15.2 only the hourly upkeep mints (Muse spec §17.3),
// so a seeded claim goes through the same `mintClaim` under an upkeep run id, after its line is written.
import type { ClaimKind, PersonMemory, Refusal } from "../../../packages/agent/src/memory/store.ts";

export const SEED_RUN = "loop:memory-upkeep:seed";

export interface SeedClaim {
  kind: ClaimKind;
  salience?: 1 | 2 | 3;
  supersedes?: string;
}

/** Mints `claim` on a written line; a refusal comes back as the store gave it. */
export function seedClaim<W extends { ok: true; path: string; line: number }>(mem: PersonMemory, written: W, claim: SeedClaim, text?: string): (W & { claimId: string }) | Refusal {
  const quote = text ?? mem.rows<{ text: string }>("SELECT text FROM daily_lines WHERE date = ? AND line = ?", written.path.slice(7, 17), written.line)[0]?.text ?? "";
  const r = mem.mintClaim({ run: SEED_RUN, kind: claim.kind, text: quote, path: written.path, line: written.line, ...(claim.salience ? { salience: claim.salience } : {}), ...(claim.supersedes ? { supersedes: claim.supersedes } : {}), speaker: "user" });
  return r.ok ? { ...written, claimId: r.id } : r;
}
