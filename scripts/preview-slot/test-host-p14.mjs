// The P14 tier-2 tasks' world on a preview slot (F41): what ./test-host.mjs's `Chat`, `Person`, `Ledger` and `Vault`
// add so an identity grader reads a real slot with the real model. Deployed only to a slot, through ./app.mjs, and
// served only to the lease's holder (./ops.mjs, `/__preview/test-host`). Pure, so a hermetic test runs it; delta 6
// allows it no op beyond a standing-file reset and a passkey seed.
//
// - `reset` (the standing-file reset): each of the person's standing files but MEMORY.md that is not the seed's text
//   by the seed's writer is written back as `defaultStanding` gives it, by `qyvr:seed`, as the first read seeds it.
// - `seed` (the passkey seed): when the owner holds fewer than two passkeys, one more is added to the Company's login
//   store through its own `add` op: an inert fixture credential (its public key is fixed bytes, so nothing can sign in
//   with it), so Settings > Security lists two and T-P14-11's "two passkeys for Sam" holds.
// - `read`: the standing files with their writers and the seed's text, the daily lines and MEMORY.md, every table's row count in the
//   chat, the person, the Ledger and the Vault, the Ledger's chat model calls for the person, the person's mail
//   journal rows, and the chat's model requests: every system message of each, and the tool lines of the first with
//   each line's `identityReach`, the production guard, run here.
import { onboardingNamespace } from '../../packages/agent/src/company/onboarding-tools.ts';
import { defaultStanding, HomeBucket, STANDING_FILES } from '../../packages/agent/src/memory/home.ts';
import { identityReach } from '../../packages/agent/src/tools/registry.ts';

export const SEED_WRITER = 'qyvr:seed';
/** The fixture credential's id (a passkey id is base64url; this one names itself). */
export const P14_PASSKEY = 'p14-fixture-passkey';

const textOf = (content) => (typeof content === 'string' ? content : Array.isArray(content) ? content.map((c) => c?.text ?? '').join('') : '');

/** Every system message of a model request body (Workers AI's, or the gateway's universal `query`), as one text; null for an embedding. */
export function systemsText(body) {
  const messages = body?.messages ?? body?.query?.messages;
  if (!Array.isArray(messages)) return null;
  return messages
    .filter((m) => m?.role === 'system')
    .map((m) => textOf(m?.content))
    .join('\n');
}

/** Every table's row count in a Durable Object's SQLite, the runtime's own tables aside. */
export function counts(sql) {
  const out = {};
  for (const r of sql.exec("SELECT name FROM sqlite_master WHERE type = 'table'").toArray()) {
    const t = String(r.name);
    if (t.startsWith('_cf_') || t.startsWith('sqlite_')) continue;
    out[t] = Number(sql.exec(`SELECT COUNT(*) AS n FROM "${t}"`).toArray()[0]?.n ?? 0);
  }
  return out;
}

const STANDING = STANDING_FILES.filter((n) => n !== 'MEMORY.md');

/** The person's standing files beside MEMORY.md written back to the seed where they are not it (the standing-file reset). */
export async function p14ResetStanding(bucket, person, now) {
  const home = new HomeBucket(bucket, person);
  const seed = defaultStanding(person);
  const reset = [];
  for (const name of STANDING) {
    const f = await home.read(name);
    if (f && f.text === seed[name] && f.writer === SEED_WRITER) continue;
    await home.write(name, seed[name], SEED_WRITER, now);
    reset.push(name);
  }
  return reset;
}

/** The person's memory as a P14 grader reads it: the standing files with their writers, the seed's, the daily lines, MEMORY.md. */
export async function p14Memory(mem, person) {
  const standing = [];
  for (const name of STANDING) {
    const f = await mem.home.read(name);
    standing.push({ name, text: f?.text ?? '', writer: f?.writer ?? '' });
  }
  const memory = await mem.home.read('MEMORY.md');
  const daily = mem.rows("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'daily_lines'").length ? mem.rows('SELECT date, line, text FROM daily_lines ORDER BY date, line').map((r) => `${r.date}#${r.line} ${r.text}`) : [];
  return { standing, seeded: defaultStanding(person), daily, memory: memory?.text ?? '', memoryWriter: memory?.writer ?? '' };
}

/** The passkey seed: the fixture credential added for `owner` when the store holds fewer than two. */
export async function p14SeedPasskey(call, owner) {
  const list = await call({ op: 'list' });
  if (list.length >= 2) return { added: false, count: list.length };
  await call({ op: 'add', id: P14_PASSKEY, email: owner, publicKey: new Uint8Array(65).fill(14), counter: 0, transports: ['internal'] });
  return { added: true, count: (await call({ op: 'list' })).length };
}

/** The tool lines a request's system messages list (`- name (kind): description`), with the onboarding namespace's, each with its guard. */
export function p14Tools(system) {
  const listed = [...String(system ?? '').matchAll(/^- ([a-z][a-z0-9_]+) \([^)]*\): (.*)$/gm)].map((m) => ({ name: m[1], description: m[2] })).filter((t) => !t.description.startsWith('Fixture:'));
  const onboarding = onboardingNamespace({}, () => '').tools.map((t) => ({ name: t.name, description: t.description }));
  return [...listed, ...onboarding].map((t) => ({ ...t, guard: identityReach(t) }));
}

/** A person's mail journal rows (`mail.*`), as `{ id, outcome, counterpart }`. */
export const p14Mail = (rows) => rows.filter((r) => String(r.actionKind).startsWith('mail.')).map((r) => ({ id: r.id, outcome: r.outcome, counterpart: r.counterpart }));
