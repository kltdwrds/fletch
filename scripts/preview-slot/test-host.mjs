// A preview slot's test host (F26): the P15 tier-2 tasks' world on a real slot with the real model. Deployed only
// to a slot, through ./app.mjs; create-fletch deploys packages/agent/src/index.ts, which never imports this file.
//
// - `Chat` browses the fixture sites (./test-host-sites.mjs) instead of a `BROWSER` binding the slot does not have, and
//   offers the share fixture the tier-1 tasks use (`share_post`, test/support/p15-fixtures.ts), whose every run is
//   one entry in the chat's egress log and reaches no network. Both through the agent's own seams
//   (`browserBinding`, `moreNamespaces`), so the gate, the cards, the grants and the browse lane are the shipped ones.
// - `Person`, `Ledger` and `Vault` add a read of their own tables, for a grader's leak scan, and the Vault its audit.
// - `testHost(body, env)` answers `/__preview/test-host`, which ./ops.mjs serves only to the lease's holder: `reset`
//   reopens the fixture sites in a person's browse memory before a trial; `state` reads a chat's log and the stores;
//   `p6` is the memory world's call (F28, ./test-host-p6.mjs) with the named chats' stored rows.
import { getAgentByName } from 'agents';
import { Chat as AgentChat, Ledger as AgentLedger, Person as AgentPerson, Vault as AgentVault } from '../../packages/agent/src/index.ts';
import { shareNamespace } from '../../test/support/p15-fixtures.ts';
import { chatRows, p6Person } from './test-host-p6.mjs';
import { SITES, testHostBinding } from './test-host-sites.mjs';

const LOG = 'test-host:log';
const empty = () => ({ reads: [], egress: [] });

/** Every table of a Durable Object's SQLite as JSON, the runtime's own `_cf_` tables aside. */
function tables(sql) {
  const names = sql
    .exec("SELECT name FROM sqlite_master WHERE type = 'table'")
    .toArray()
    .map((r) => String(r.name))
    .filter((n) => !n.startsWith('_cf_') && !n.startsWith('sqlite_'));
  const text = (v) => (v instanceof ArrayBuffer ? new TextDecoder().decode(v) : v);
  return JSON.stringify(names.flatMap((t) => sql.exec(`SELECT * FROM "${t}"`).toArray().map((row) => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, text(v)])))));
}

export class Chat extends AgentChat {
  #chain = Promise.resolve();

  /** Appends to the chat's log, one write after another. */
  #append(kind, entry) {
    this.#chain = this.#chain.then(async () => {
      const log = (await this.ctx.storage.get(LOG)) ?? empty();
      log[kind].push({ ...entry, at: Date.now() });
      await this.ctx.storage.put(LOG, log);
    });
    return this.#chain;
  }

  browserBinding() {
    return testHostBinding((e) => this.#append('reads', e));
  }

  moreNamespaces() {
    return [shareNamespace((r) => void this.#append('egress', r))];
  }

  async testHostLog() {
    await this.#chain;
    return (await this.ctx.storage.get(LOG)) ?? empty();
  }

  async testHostDump() {
    return tables(this.ctx.storage.sql);
  }

  /** The chat's stored rows (F28, ./test-host-p6.mjs). */
  async testHostRows() {
    return chatRows(this.ctx.storage.sql);
  }
}

export class Person extends AgentPerson {
  async testHostDump() {
    return tables(this.ctx.storage.sql);
  }

  /** One P6 call on this person's memory (F28, ./test-host-p6.mjs). */
  async testHostP6(call) {
    return p6Person(this, call);
  }
}

export class Ledger extends AgentLedger {
  async testHostDump() {
    return tables(this.ctx.storage.sql);
  }
}

export class Vault extends AgentVault {
  async testHostAudit() {
    return this.core.audit();
  }
}

/** The text of every object in the slot's bucket under `prefix`. */
async function bucketText(bucket, prefix) {
  const out = [];
  let cursor;
  do {
    const page = await bucket.list({ prefix, ...(cursor ? { cursor } : {}) });
    for (const o of page.objects) out.push(`${o.key}: ${(await (await bucket.get(o.key))?.text()) ?? ''}`);
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return out.join('\n');
}

const EMAIL = /^[^\s@]+@[^\s@]+$/;
const CHAT_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** The answer to a test-host op from the lease's holder: `{ status, body }`. */
export async function testHost(body, env) {
  if (typeof body.person !== 'string' || !EMAIL.test(body.person)) return { status: 400, body: { error: { code: 'invalid', message: 'name the person' } } };
  const person = await getAgentByName(env.PERSON, body.person);
  if (body.op === 'reset') {
    for (const domain of Object.keys(SITES)) await person.browseRecord({ domain, engine: null, state: 'ok', code: null });
    return { status: 200, body: { reset: Object.keys(SITES) } };
  }
  if (body.op === 'state') {
    if (typeof body.chatId !== 'string' || !CHAT_ID.test(body.chatId)) return { status: 400, body: { error: { code: 'invalid', message: 'name the chat' } } };
    const chat = await getAgentByName(env.CHAT, body.chatId);
    const vault = env.VAULT.get(env.VAULT.idFromName(env.TENANT_ID));
    const ledger = env.LEDGER.get(env.LEDGER.idFromName(env.TENANT_ID));
    const audit = await vault.testHostAudit();
    return {
      status: 200,
      body: {
        log: await chat.testHostLog(),
        audit,
        grants: await vault.grants(body.person),
        sinks: {
          transcripts: await chat.testHostDump(),
          journal: await ledger.testHostDump(),
          "Sam's stores": `${await person.testHostDump()}\n${await bucketText(env.AGENT_BUCKET, `person/${encodeURIComponent(body.person)}/`)}`,
          'vault audit': JSON.stringify(audit),
        },
      },
    };
  }
  if (body.op === 'p6') {
    // F28: the P6 world (./test-host-p6.mjs): a memory reset, seed or read as the person, and the named chats' rows.
    const chats = Array.isArray(body.chats) ? body.chats : [];
    if (chats.some((c) => typeof c !== 'string' || !CHAT_ID.test(c))) return { status: 400, body: { error: { code: 'invalid', message: 'name the chats' } } };
    const answer = await person.testHostP6(body.call ?? {});
    const rows = {};
    for (const c of chats) rows[c] = await (await getAgentByName(env.CHAT, c)).testHostRows();
    return { status: 200, body: { answer, rows } };
  }
  return { status: 404, body: { error: { code: 'not_found', message: 'no such test-host op' } } };
}
