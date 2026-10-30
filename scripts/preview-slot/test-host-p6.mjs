// The P6 tier-2 tasks' world on a preview slot (F28): what ./test-host.mjs's `Person` and `Chat` add so a memory grader
// reads Sam's memory and a chat's stored rows on a real slot, and so each trial starts from an empty memory. Deployed
// only to a slot, through ./app.mjs, and served only to the lease's holder (./ops.mjs, `/__preview/test-host`).
//
// - `reset` empties the person's memory: the daily lines, claims, chunk index, entities and forget plans, the vector
//   queue, and every home file under `memory/` with `MEMORY.md` (seeded again on the next turn). The chunk ids keep
//   counting (`AUTOINCREMENT`), so a vector left in the index from an earlier trial names no chunk and is dropped.
// - `seed` writes what a task's setup names before its turns, through the Person's own seams: a daily line as the
//   chat's `memory_write` writes it; a claim on each unclaimed line as the hourly upkeep mints one (the tier-1 runs'
//   scripted upkeep, `test/evals/p6-memory/runs.ts`); a forget of the claims holding a phrase, planned with the jobs
//   and skills the task names as producers (as tier 1 passes them) and confirmed by the person.
// - `state` answers the memory a grader reads, with each chat's stored rows (`Chat.testHostRows`); `get`, `explain`
//   and `search` are the chat's own memory calls as the person.
import { citation, dailyPath, homeKey } from '../../packages/agent/src/memory/home.ts';
import { UPKEEP_RUN_PREFIX } from '../../packages/agent/src/memory/store.ts';

const TABLES = ['daily_lines', 'claims', 'chunks', 'chunks_fts', 'entities', 'forget_plans', 'vector_queue'];

/** Every key under `prefix` in the bucket. */
async function keys(bucket, prefix) {
  const out = [];
  let cursor;
  do {
    const page = await bucket.list({ prefix, ...(cursor ? { cursor } : {}) });
    out.push(...page.objects.map((o) => o.key));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return out;
}

const refused = (code) => ({ ok: false, code });

/** One P6 call on the person's `Person` (`p`: its `name`, `env`, `personMemory` and `memory`). */
export async function p6Person(p, call) {
  const mem = p.personMemory;
  const owner = p.name;
  switch (call.do) {
    case 'reset': {
      for (const t of TABLES) mem.sql.exec(`DELETE FROM "${t}"`);
      const gone = [...(await keys(p.env.AGENT_BUCKET, homeKey(owner, 'memory/'))), homeKey(owner, 'MEMORY.md')];
      for (const k of gone) await p.env.AGENT_BUCKET.delete(k);
      return { ok: true };
    }
    case 'write':
      return p.memoryWrite({ target: 'daily', text: String(call.text ?? '') }, { requester: owner, setting: { scope: 'personal' }, source: String(call.source ?? ''), dedupe: String(call.dedupe ?? '') });
    case 'claims': {
      const lines = mem.rows("SELECT date, line, text FROM daily_lines WHERE NOT EXISTS (SELECT 1 FROM claims WHERE source_path = 'memory/' || date || '.md' AND source_line = line) ORDER BY date, line");
      const minted = [];
      for (const l of lines) {
        const r = mem.mintClaim({ run: `${UPKEEP_RUN_PREFIX}seed`, kind: call.kind ?? 'fact', text: l.text, path: dailyPath(l.date), line: l.line, speaker: 'user' });
        if (!r.ok) return r;
        minted.push(r.id);
      }
      return { ok: true, minted };
    }
    case 'forget': {
      const ids = mem.rows("SELECT id, quote FROM claims WHERE status = 'active'").filter((c) => String(c.quote).includes(String(call.match ?? '\u0000'))).map((c) => c.id);
      const producers = { jobs: async () => call.producers?.jobs ?? [], skills: async () => call.producers?.skills ?? [] };
      const plan = await p.memory.forgetPlan({ claimIds: ids }, owner, producers);
      if (!plan.ok) return plan;
      const done = await p.forgetConfirm(plan.planId, owner);
      return done.ok ? { ok: true, planId: plan.planId } : done;
    }
    case 'state': {
      const paths = (await keys(p.env.AGENT_BUCKET, homeKey(owner, ''))).map((k) => k.slice(homeKey(owner, '').length));
      const files = {};
      for (const path of paths) files[path] = (await mem.home.read(path))?.text ?? '';
      return {
        ok: true,
        lines: mem.rows('SELECT date, line, text, source, writer FROM daily_lines ORDER BY date, line').map((r) => ({ citation: citation(dailyPath(r.date), r.line), text: r.text, source: r.source, writer: r.writer })),
        claims: mem.rows('SELECT * FROM claims ORDER BY created_at, id').map((r) => ({ id: r.id, kind: r.kind, status: r.status, quote: r.quote, citation: citation(r.source_path, r.source_line), supersedes: r.supersedes })),
        chunks: mem.rows('SELECT path, line_start, text FROM chunks ORDER BY id').map((r) => ({ citation: citation(r.path, r.line_start), text: r.text })),
        files,
      };
    }
    case 'get':
      return p.memory.memoryGet({ path: String(call.path ?? ''), ...(call.from ? { from: Number(call.from) } : {}), ...(call.limit ? { limit: Number(call.limit) } : {}) }, owner);
    case 'explain':
      return p.memory.memoryExplain({ claimId: String(call.claimId ?? '') }, owner);
    case 'search':
      return p.memory.memorySearch({ queries: (call.queries ?? []).map(String), maxResults: 25 }, owner);
    default:
      return refused('P6_OP_UNKNOWN');
  }
}

/** A chat's stored rows as a grader reads them: role, the tool a result answers and whether it failed, text, calls. */
export function chatRows(sql) {
  return sql
    .exec('SELECT seq, role, body FROM messages ORDER BY seq')
    .toArray()
    .map((r) => {
      const m = JSON.parse(String(r.body));
      const parts = typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : (m.content ?? []);
      return {
        seq: Number(r.seq),
        role: m.role,
        ...(m.role === 'toolResult' ? { tool: m.toolName ?? '', isError: m.isError === true } : {}),
        text: parts.map((x) => (x.type === 'text' ? (x.text ?? '') : '')).join(''),
        calls: parts.filter((x) => x.type === 'toolCall').map((x) => x.name ?? ''),
      };
    });
}
