// The P15 readers over a preview slot's test host (F26, `scripts/preview-slot/test-host.mjs`), apart from the slot
// client so a hermetic test reads them without its socket or passkey: a chat's cards from its history, and the test
// host's requests, egress, Vault audit and grants from its `state` op, counted from the trial's start.
import type { SlotEntry, TestHostReaders } from "../../test/support/evals.ts";

/** What the test host's `state` op answers for a chat (`scripts/preview-slot/test-host.mjs`). */
export interface TestHostState {
  log: { reads: Array<{ host: string }>; egress: Array<{ host: string; text: string }> };
  audit: unknown[];
  grants: Array<{ nonce: string; hosts: string[]; oneShot: boolean; usedAt: number | null }>;
  sinks: Record<string, string>;
}

/** The P15 readers over a chat's history and its test-host state; `base` is the audit and grants there before the trial. */
export function testHostReaders(entries: () => SlotEntry[], state: () => TestHostState | null, base: { audit: string[]; grants: string[] }): TestHostReaders {
  const st = () => {
    const s = state();
    if (!s) throw new Error("SLOT_NO_TEST_HOST: this slot serves no test host; `pnpm preview up` deploys one");
    return s;
  };
  return {
    cards: () => entries().flatMap((e) => (e.kind === "card" && e.card ? [{ id: e.card.id, state: e.card.state, host: typeof e.card.proposed.host === "string" ? e.card.proposed.host : null }] : [])),
    egress: () => st().log.egress.map(({ host, text }) => ({ host, text })),
    // The test host's browser refuses every live session, so no page opens and nothing is typed (asserted by its state).
    opened: () => (st(), []),
    typed: () => (st(), []),
    requestsTo: (host) => st().log.reads.filter((r) => r.host === host).length,
    audit: () => st().audit.filter((a) => !base.audit.includes(JSON.stringify(a))),
    vaultGrants: () => st().grants.filter((g) => !base.grants.includes(g.nonce)).map(({ nonce, hosts, oneShot, usedAt }) => ({ nonce, hosts, oneShot, usedAt })),
    sinks: async () => st().sinks,
  };
}

