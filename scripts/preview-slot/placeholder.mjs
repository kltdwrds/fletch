// What a free fletch preview slot's Worker runs (docs/preview.md): the slot's ops (./ops.mjs), so a session can claim
// it, and 503 for everything else. Its config tombstones the agent's Durable Object classes, so deploying it deletes
// every object the last lease made; only the lease's own object (./lease.mjs) stays.
import { leaseOf } from './lease.mjs';
import { ops } from './ops.mjs';

export { PreviewLease } from './lease.mjs';

export default {
  fetch: async (request, env) => (await ops(request, env, { lease: leaseOf(env) })) ?? new Response('This fletch preview slot is free.\n', { status: 503 }),
};
