// The scenario world for M5.1's families: the hermetic job world with a snapshot of journal (job
// runs and outbox rows, Ledger run and call rows), vault (none: a watch holds no credential) and R2
// keys, for the collateral check.
import type { Snapshot } from "../support/scenario.ts";
import { jobWorld } from "../workers/support/job-world.ts";

export async function scenarioWorld(o: Parameters<typeof jobWorld>[0] = {}) {
  const w = jobWorld(o);
  return Object.assign(w, {
    async snapshot(): Promise<Snapshot> {
      const ledger = w.ledger();
      return {
        journal: [
          ...w.runs().map((r) => `run:${r.runId}`),
          ...w.outbox().map((r) => `outbox:${r.id}`),
          ...(await ledger.runs()).map((r) => `ledger-run:${r.runId}`),
          ...(await ledger.modelCalls()).map((c, i) => `ledger-call:${i}:${c.runId}`),
        ],
        vault: [],
        r2: [...w.r2.objects.keys()],
      };
    },
  });
}
