// The P3 tier-2 tasks' world on a preview slot (F34): what ./test-host.mjs's `Chat` and browser add so a delegation
// grader reads a real slot with the real model. Deployed only to a slot, through ./app.mjs, and served only to the
// lease's holder (./ops.mjs, `/__preview/test-host`). Pure, so a hermetic test runs it under plain Node.
//
// - The probe pages. `https://example.com/p3-probe` (a title and three links, the tier-1 world's `PAGE` in
//   test/evals/p3-delegation/harness.ts) and `https://example.com/p3-probe-2` are served by the test host's browser
//   (./test-host-sites.mjs) by their whole address, the stand-in for the slot's `/fixtures/p3-probe` routes the
//   contract names: a sub-agent's reads go through the slot's browser, never the network. The second is served slowly
//   (`SLOW`), so Sam's steer or Stop arrives while a child reads it (T-P3-15, T-P3-17). `example.invalid` stays no site
//   the test host serves, so its read is `BROWSE_UNREACHABLE`, as in the tier-1 world.
// - The requests. Each chat model request's messages (its system prompt left out) as one text, kept beside the prompt
//   (./test-host-p5.mjs `recordingAi`), so a grader reads whether a closed child's report ever reached the model.
// - The rows. The chat's `subagents` rows with their group's handoff time, and its `mailbox` rows, as the tier-1 world
//   reads them from the same tables.

export const P3_PROBE = 'https://example.com/p3-probe';
export const P3_PROBE_2 = 'https://example.com/p3-probe-2';
export const P3_TITLE = 'Example Domain';

export const P3_PAGES = {
  [P3_PROBE]: `# ${P3_TITLE}\n\nThis page is for the p3 probe. It has three links.\n\n[One](https://example.com/p3-one) [Two](https://example.com/p3-two) [Three](https://example.com/p3-three)`,
  [P3_PROBE_2]: '# The second p3 probe page\n\nThis page is served slowly. It has one link.\n\n[Back](https://example.com/p3-probe)',
};

/** How long the test host's browser takes to answer a slow page, by its address. */
export const SLOW = { [P3_PROBE_2]: 45_000 };

const textOf = (content) => (typeof content === 'string' ? content : Array.isArray(content) ? content.map((c) => c?.text ?? '').join('') : '');

/** The messages of a model request body (Workers AI's, or the gateway's universal `query`) other than its system prompt, as one text; null for an embedding. */
export function requestText(body) {
  const messages = body?.messages ?? body?.query?.messages;
  if (!Array.isArray(messages)) return null;
  return messages
    .filter((m) => m?.role !== 'system')
    .map((m) => textOf(m?.content))
    .join('\n');
}

/** How many characters one stored value holds; a longer request is kept in several. */
export const CHUNK = 100_000;

/** `text` cut into values of at most CHUNK characters (one empty value for an empty text). */
export const chunks = (text) => (text.length ? Array.from({ length: Math.ceil(text.length / CHUNK) }, (_, i) => text.slice(i * CHUNK, (i + 1) * CHUNK)) : ['']);

/** The kept requests from storage entries keyed `<prefix><n>:<k>`, each request's values joined in order. */
export function joinChunks(entries) {
  const out = new Map();
  for (const [key, value] of [...entries].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    const n = key.split(':').at(-2);
    out.set(n, (out.get(n) ?? '') + value);
  }
  return [...out.values()];
}

/** A chat's sub-agent rows (with their group's handoff time) and mailbox rows, from its SQLite. */
export function p3Rows(sql) {
  const has = (t) => sql.exec("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?", t).toArray().length > 0;
  const children = has('subagents')
    ? sql
        .exec('SELECT s.*, g.handed_off_at FROM subagents s LEFT JOIN subagent_groups g ON g.grp = s.grp ORDER BY s.created_at, s.id')
        .toArray()
        .map((r) => ({
          id: String(r.id),
          grp: String(r.grp),
          turnId: String(r.turn_id),
          parent: String(r.parent),
          role: String(r.role),
          depth: Number(r.depth),
          brief: String(r.brief),
          status: String(r.status),
          code: r.code === null ? null : String(r.code),
          tokens: Number(r.tokens),
          verdict: r.verdict === null ? null : String(r.verdict),
          verdictReason: r.verdict_reason === null ? null : String(r.verdict_reason),
          refusals: JSON.parse(String(r.refusals ?? '[]')),
          handedOffAt: r.handed_off_at === null || r.handed_off_at === undefined ? null : Number(r.handed_off_at),
        }))
    : [];
  const mailbox = has('mailbox')
    ? sql
        .exec('SELECT ordinal, message_id, kind, scope, state, turn_id FROM mailbox ORDER BY ordinal')
        .toArray()
        .map((r) => ({ ordinal: Number(r.ordinal), messageId: String(r.message_id), kind: String(r.kind), scope: String(r.scope), state: String(r.state), turnId: r.turn_id === null ? null : String(r.turn_id) }))
    : [];
  return { children, mailbox };
}
