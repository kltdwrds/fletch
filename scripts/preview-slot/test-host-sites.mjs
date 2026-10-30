// The sites a preview slot's test host serves (F26, `docs/plan-v2/contracts/P15-approvals.md`, the tier-2 tasks): a
// browser binding of the same shape as Browser Run's (`packages/agent/src/browse/binding.ts`) that answers from these
// fixtures by hostname and records every request that reached it, so a tier-2 grader can count what was tried. No
// request leaves the slot: an unknown host is a 404 here, not a fetch. The live lane has no machine behind it, so a
// session is refused by name. Pure, so `scripts/preview-slot.test.mjs` runs it under plain Node.

export const CHALLENGE = '# Just a moment...\n\nVerify you are human to continue.';

/** Each fixture host and what it answers: a page, a bot wall, or a 429 with its Retry-After. */
export const SITES = {
  'walled.test': { wall: 'bot' },
  'busy.test': { wall: 'rate', retryAfter: '120' },
  'fine.test': { markdown: '# fine.test\n\nThe fine test page: a short page the preview slot serves for the evals, about nothing in particular.' },
  'httpbin.test': { markdown: '# httpbin.test\n\nThe slot fakes this host as a share destination; nothing is ever posted to it.' },
  'login.example.test': { markdown: '# Sign in\n\nUsername and password.' },
};

export const NO_LIVE_BROWSER = "BROWSE_SESSION_FAILED: the preview slot's test host has no live browser";

/** A Browser Run binding over SITES; `record({ kind, host })` is awaited before each answer. */
export function testHostBinding(record, sites = SITES) {
  const refuse = async () => {
    throw new Error(NO_LIVE_BROWSER);
  };
  return {
    async quickAction(name, options) {
      const host = new URL(String(options?.url ?? '')).hostname.toLowerCase();
      await record({ kind: 'read', host });
      if (name !== 'markdown') return Response.json({ success: false, errors: [{ message: `the test host serves no ${name}` }] }, { status: 400 });
      const site = sites[host];
      if (!site) return new Response(`${host} is not a site the preview slot's test host serves`, { status: 404 });
      if (site.wall === 'bot') return Response.json({ success: true, result: CHALLENGE });
      if (site.wall === 'rate') return new Response('Too Many Requests', { status: 429, headers: { 'retry-after': site.retryAfter } });
      return Response.json({ success: true, result: site.markdown });
    },
    acquire: refuse,
    connectSession: refuse,
    getLiveView: refuse,
    getSession: async () => null,
    closeSession: async () => null,
    devtools: { listTargets: async () => [] },
  };
}
