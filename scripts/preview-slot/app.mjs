// A fletch preview slot's Worker (docs/preview.md): the agent, with the slot's ops (./ops.mjs) answered first on
// /__preview/, and the lease's Durable Object beside the agent's. Deployed only to a slot, by scripts/preview.mjs;
// create-fletch deploys packages/agent/src/index.ts itself.
import agent from '../../packages/agent/src/index.ts';
import { leaseOf } from './lease.mjs';
import { ops } from './ops.mjs';

export * from '../../packages/agent/src/index.ts';
export { PreviewLease } from './lease.mjs';

export default {
  ...agent,
  fetch: async (request, env, ctx) => (await ops(request, env, { lease: leaseOf(env) })) ?? agent.fetch(request, env, ctx),
};
