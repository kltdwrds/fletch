// A fletch preview slot's Worker (docs/preview.md): the agent, with the slot's ops (./ops.mjs) answered first on
// /__preview/, and the lease's Durable Object beside the agent's. The agent's `Chat`, `Job`, `Person`, `Ledger` and
// `Vault` (and F32's `SubAgent`) are the test host's (./test-host.mjs, F26, F30, F32): the same objects with the fixture sites, the share fixture and the reads
// a tier-2 grader needs. Deployed only to a slot, by scripts/preview.mjs; create-fletch deploys
// packages/agent/src/index.ts itself. `/fixtures/p9-probe` is the Example API's stand-in, answered before either (F37,
// ./test-host-p9.mjs).
import agent from '../../packages/agent/src/index.ts';
import { leaseOf } from './lease.mjs';
import { ops } from './ops.mjs';
import { testHost } from './test-host.mjs';
import { p9Fixture } from './test-host-p9.mjs';

export * from '../../packages/agent/src/index.ts';
export { PreviewLease } from './lease.mjs';
export { Chat, Job, Ledger, Person, SubAgent, Vault } from './test-host.mjs';

export default {
  ...agent,
  fetch: async (request, env, ctx) => p9Fixture(request) ?? (await ops(request, env, { lease: leaseOf(env), testHost })) ?? agent.fetch(request, env, ctx),
};
