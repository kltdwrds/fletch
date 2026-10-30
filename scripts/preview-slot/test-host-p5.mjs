// The P5 tier-2 tasks' world on a preview slot (F32): what ./test-host.mjs's `Chat` and `SubAgent` add so an activity
// grader reads a real slot with the real model. Deployed only to a slot, through ./app.mjs, and served only to the
// lease's holder (./ops.mjs, `/__preview/test-host`). Pure, so `scripts/preview-slot.test.mjs` runs it under plain Node.
//
// - The probe page. `https://example.com/p5-probe` is served by the test host's browser (./test-host-sites.mjs) from
//   `PAGES`, the stand-in for a fixture route on the slot: the same page the tier-1 world's fake browser serves (a
//   title, two sentences, one link), so a task reads a page the suite owns and nothing leaves the slot.
//   `example.invalid` is no site the test host serves, so both engines answer 404 and the read is `BROWSE_UNREACHABLE`,
//   as in the tier-1 world.
// - The prompts. A chat's `AI` binding is wrapped by `recordingAi`, which keeps the system prompt of every chat model
//   request (the verifier's left out, as the tier-1 world leaves it out) before it is sent, unchanged, so a grader reads
//   what the model was told.
// - A sub-agent's reads. A child on a deploy reads Hacker News only (`SUBAGENT_READS`); on a slot it also reads the
//   probe page through `browse_open`, the address its brief carries in its url table, as the tier-1 world's child does.

export const P5_PROBE = 'https://example.com/p5-probe';
/** The tier-1 world's page (`PAGE` in test/evals/p5-activity/harness.ts), by its address. */
export const PAGES = {
  [P5_PROBE]: '# The p5 probe page\n\nThe probe has one line of text. It has one link.\n\n[Elsewhere](https://example.com/p5-elsewhere)',
};

/** The page served at `url` (a trailing slash aside), or undefined. */
export const pageAt = (url, pages = PAGES) => pages[String(url).replace(/\/$/, '')];

/** The system prompt of a model request body (Workers AI's, or the gateway's universal `query`), or null. */
export function systemOf(body) {
  const messages = body?.messages ?? body?.query?.messages;
  const first = Array.isArray(messages) ? messages.find((m) => m?.role === 'system') : undefined;
  if (!first) return null;
  return typeof first.content === 'string' ? first.content : Array.isArray(first.content) ? first.content.map((c) => c?.text ?? '').join('') : null;
}

/**
 * `ai` with every chat model request's system prompt passed to `record` first; `skip(prompt)` leaves one out (the
 * verifier's). An embedding (no messages) is not a chat request. What is sent and answered is unchanged.
 */
export function recordingAi(ai, record, skip = () => false) {
  const keep = async (body) => {
    const prompt = systemOf(body);
    if (prompt !== null && !skip(prompt)) await record(prompt);
  };
  return new Proxy(ai, {
    get(target, prop) {
      if (prop === 'run') return async (model, body, opts) => (await keep(body), target.run(model, body, opts));
      if (prop === 'gateway') {
        return (id) => {
          const g = target.gateway(id);
          return new Proxy(g, { get: (t, p) => (p === 'run' ? async (req, opts) => (await keep(req), t.run(req, opts)) : Reflect.get(t, p)) });
        };
      }
      const v = Reflect.get(target, prop);
      return typeof v === 'function' ? v.bind(target) : v;
    },
  });
}

/** Every http(s) address in `text`, its trailing punctuation dropped. */
export const addressesIn = (text) => [...String(text).matchAll(/https?:\/\/[^\s<>"'`)\]]+/g)].map((m) => m[0].replace(/[.,;:!?]+$/, ''));

/** A browse memory that lives as long as one run: what a child's reads remember stays with the child. */
export function runMemory() {
  const seen = new Map();
  return { get: async (domain) => seen.get(domain) ?? null, record: async (r) => void seen.set(r.domain, { ...r, at: Date.now() }) };
}
