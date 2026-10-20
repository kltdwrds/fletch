// Scenario tooling (testing-and-evals.md section 4, from M5.1): `defineScenario` declares one graded
// scenario: its clauses, a seed for the mulberry32 generator, the setup from the fictional
// fixtures, the turns, the end state, the minefields (things that must not have happened) and the
// declared change. The collateral check snapshots journal, vault and R2 keys before and after the
// turns and requires the difference to equal the declared change exactly. Files under
// test/scenarios/ run twice in accept, so a scenario that passes only on retry fails.
import { describe, expect, it } from "vitest";
import { Seeded } from "./seeded.ts";

/** Keys per area; a journal key names a run, an outbox row or a Ledger row. */
export interface Snapshot {
  journal: string[];
  vault: string[];
  r2: string[];
}

export interface ScenarioWorld {
  snapshot(): Promise<Snapshot> | Snapshot;
}

export interface Scenario<W extends ScenarioWorld> {
  /** `S-<clause>-<slug>`. */
  id: `S-${string}`;
  clauses: string[];
  seed: number;
  setup: (rng: Seeded) => Promise<W> | W;
  turns: (world: W, rng: Seeded) => Promise<void>;
  endState: (world: W) => Promise<void> | void;
  minefields: Array<{ name: string; happened: (world: W) => Promise<boolean> | boolean }>;
  /** Keys the turns are declared to add, per area; anything else added, or anything removed, is collateral. */
  declared: (world: W) => Promise<Partial<Snapshot>> | Partial<Snapshot>;
}

const sorted = (xs: string[]) => [...xs].sort();

/** The collateral check: the change between two snapshots must equal the declared one. */
export function collateral(before: Snapshot, after: Snapshot, declared: Partial<Snapshot>): { area: keyof Snapshot; added: string[]; removed: string[]; expected: string[] }[] {
  const areas: Array<keyof Snapshot> = ["journal", "vault", "r2"];
  return areas
    .map((area) => {
      const was = new Set(before[area]);
      const now = new Set(after[area]);
      const added = sorted([...now].filter((k) => !was.has(k)));
      const removed = sorted([...was].filter((k) => !now.has(k)));
      return { area, added, removed, expected: sorted(declared[area] ?? []) };
    })
    .filter((d) => d.removed.length > 0 || JSON.stringify(d.added) !== JSON.stringify(d.expected));
}

/** Called inside the family's own tagged `describe("[M<n>.<p>] <family>", ...)`, which accept reads. */
export function defineScenario<W extends ScenarioWorld>(s: Scenario<W>): void {
  if (!/^S-[A-Z]\d+-[a-z0-9-]+$/.test(s.id)) throw new Error(`SCENARIO_BAD_ID: ${s.id}`);
  describe(`scenario ${s.id}`, () => {
    it(`grades ${s.clauses.join(", ")} with no collateral change and no minefield`, async () => {
      const rng = new Seeded(s.seed);
      const world = await s.setup(rng);
      const before = await world.snapshot();
      await s.turns(world, rng);
      await s.endState(world);
      const stepped: string[] = [];
      for (const m of s.minefields) if (await m.happened(world)) stepped.push(m.name);
      expect(stepped, "minefields stepped on").toEqual([]);
      expect(collateral(before, await world.snapshot(), await s.declared(world)), "collateral change").toEqual([]);
    });
  });
}
