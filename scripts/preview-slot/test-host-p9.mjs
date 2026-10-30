// The P9 tier-2 tasks' world on a preview slot (F37): what ./test-host.mjs's `Vault` and `Chat` add so a credentials
// grader reads a real slot with the real model. Deployed only to a slot, through ./app.mjs, and served only to the
// lease's holder (./ops.mjs, `/__preview/test-host`), the probe route aside. Pure, so a hermetic test runs it.
//
// - The probe host. `https://<slot>/fixtures/p9-probe` answers as `https://api.example.com/p9-probe` does in the tier-1
//   world (test/evals/p9-connectors/fixture-connector.ts `probeAnswer`: a text, a count of 657, an item created). A
//   Worker cannot fetch its own workers.dev host, so the Vault's network answers `api.example.com` from the same
//   function in-process: the route is the stand-in a person can open, the network the one the agent's calls reach. Any
//   other host is answered 404 here with no request made, so nothing a trial sends leaves the slot; every request the
//   network was sent is kept, in order (`sent`). `api.example.org` is no host either: a request to it is a minefield.
// - The fixture connector. The tier-1 world's `fixture_count`, `fixture_read` and `fixture_create`, over the Vault's
//   egress with the slot owner's key (T-P9-15, T-P9-16).
// - The rows. A person's `credential_hosts`, `egress_audit` and `vault_events` rows as the tier-1 world reads them, a
//   chat's cards and stored messages, and a reset that deletes the person's credential rows before a trial.
import { probeAnswer } from '../../test/evals/p9-connectors/fixture-connector.ts';

export const P9_FIXTURE = '/fixtures/p9-probe';
export const P9_API = 'https://api.example.com/p9-probe';

/** The slot's own `/fixtures/p9-probe` route: the Example API's answer at the same path, or null for another path. */
export function p9Fixture(request) {
  const url = new URL(request.url);
  if (url.pathname !== P9_FIXTURE && !url.pathname.startsWith(`${P9_FIXTURE}/`)) return null;
  if (request.method !== 'GET') return new Response('the probe route answers GET only; the agent reaches the Example API through its egress', { status: 405 });
  return probeAnswer(`${P9_API}${url.pathname.slice(P9_FIXTURE.length)}`, 'GET');
}

/** The Vault's network on a slot: `record({ url, method, redirect })` is awaited first; the Example API answers, any other host is a 404 with nothing sent. */
export function p9Network(record) {
  return async (url, init = {}) => {
    const method = String(init.method ?? 'GET');
    await record({ url: String(url), method, redirect: String(init.redirect ?? 'follow') });
    const answer = probeAnswer(String(url), method, init.body === undefined ? undefined : String(init.body));
    return answer ?? new Response(`${new URL(String(url)).hostname} is not a host the preview slot's test host serves`, { status: 404 });
  };
}

/** The tables a person's credentials live in, with the column that names the person. */
export const P9_TABLES = [
  ['secrets', 'owner'],
  ['credential_hosts', 'owner'],
  ['credential_grants', 'owner'],
  ['vault_events', 'owner'],
  ['egress_audit', 'person'],
  ['browser_states', 'owner'],
];

const has = (sql, t) => sql.exec("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?", t).toArray().length > 0;

/** Deletes every credential row of `person` before a trial, so each starts with none (T-P9-13's setup). */
export function p9Reset(sql, person) {
  for (const [t, col] of P9_TABLES) if (has(sql, t)) sql.exec(`DELETE FROM "${t}" WHERE "${col}" = ?`, person);
}

/** A person's registry, audit and event rows, oldest first, as the tier-1 world reads them. */
export function p9VaultRows(sql, person) {
  const rows = (q) => (has(sql, q.table) ? sql.exec(q.sql, person).toArray() : []);
  return {
    hosts: rows({ table: 'credential_hosts', sql: 'SELECT ref, host, fills, writer, via, card FROM credential_hosts WHERE owner = ? ORDER BY ref, host' }).map((r) => ({ ref: String(r.ref), host: String(r.host), fills: Number(r.fills) === 1, writer: String(r.writer), via: String(r.via), card: r.card === null || r.card === undefined ? null : String(r.card) })),
    audit: rows({ table: 'egress_audit', sql: 'SELECT at, ref, host, method, path, purpose, outcome FROM egress_audit WHERE person = ? ORDER BY id' }).map((r) => ({ at: Number(r.at), ref: String(r.ref), host: String(r.host), method: String(r.method), path: String(r.path), purpose: String(r.purpose), outcome: String(r.outcome) })),
    events: rows({ table: 'vault_events', sql: 'SELECT ref, event, by FROM vault_events WHERE owner = ? ORDER BY id' }).map((r) => ({ ref: String(r.ref), event: String(r.event), by: String(r.by) })),
  };
}

/** A chat's cards and its stored messages (each row's JSON body), oldest first. */
export function p9ChatRows(sql) {
  const cards = has(sql, 'cards')
    ? sql
        .exec('SELECT id, tool, args, state, outcome FROM cards ORDER BY created_at, id')
        .toArray()
        .map((r) => ({ id: String(r.id), tool: String(r.tool), state: String(r.state), outcome: r.outcome === null ? null : String(r.outcome), args: JSON.parse(String(r.args)) }))
    : [];
  const messages = has(sql, 'messages') ? sql.exec('SELECT body FROM messages ORDER BY seq').toArray().map((r) => String(r.body)) : [];
  return { cards, messages };
}
