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
//   `p6` is the memory world's call (F28, ./test-host-p6.mjs) with the named chats' stored rows; `p7` the scheduling
//   world's (F30, ./test-host-p7.mjs).
// - `Job` reads the probe page from a fixture and keeps a clock the `p7` op's `tick` moves (./test-host-p7.mjs).
// - `Chat` keeps the system prompt of each chat model request, which the `p5` op reads, and `SubAgent` reads the probe
//   page as well as its allowlist (F32, ./test-host-p5.mjs).
import { getAgentByName } from 'agents';
import { egressFor } from '../../packages/agent/src/connectors/egress.ts';
import { Chat as AgentChat, Job as AgentJob, Ledger as AgentLedger, Person as AgentPerson, SubAgent as AgentSubAgent, Vault as AgentVault } from '../../packages/agent/src/index.ts';
import { jobToolSpecs } from '../../packages/agent/src/jobs/job-tools.ts';
import { personMemory } from '../../packages/agent/src/memory/rpc.ts';
import { VERIFIER_INSTRUCTIONS } from '../../packages/agent/src/subagents/verifier.ts';
import { jobName } from '../../packages/agent/src/objects/job.ts';
import { shareNamespace } from '../../test/support/p15-fixtures.ts';
import { childBrowse } from './test-host-child.mjs';
import { recordingAi } from './test-host-p5.mjs';
import { chatRows, p6Person } from './test-host-p6.mjs';
import { clockedStorage, p7Op, probeGet, skewToNext } from './test-host-p7.mjs';
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

const PROMPTS = 'test-host:prompt:';

export class Chat extends AgentChat {
  #chain = Promise.resolve();

  constructor(ctx, env) {
    super(ctx, env);
    // F32: each chat model request's system prompt kept, one key each (a prompt is too long to share a value), the
    // verifier's left out; the request itself is sent unchanged.
    this.env = { ...env, AI: recordingAi(env.AI, (p) => this.#keepPrompt(p), (p) => p.startsWith(VERIFIER_INSTRUCTIONS)) };
  }

  #keepPrompt(prompt) {
    this.#chain = this.#chain.then(async () => {
      const n = (await this.ctx.storage.list({ prefix: PROMPTS })).size + 1;
      await this.ctx.storage.put(`${PROMPTS}${String(n).padStart(6, '0')}`, prompt);
    });
    return this.#chain;
  }

  /** The system prompt of every chat model request, in order (F32). */
  async testHostPrompts() {
    await this.#chain;
    return [...(await this.ctx.storage.list({ prefix: PROMPTS })).values()];
  }

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

  /** The notices drawn in this chat, with their source (`job:<id>`) (F30). */
  async testHostNotices() {
    return this.ctx.storage.sql.exec('SELECT source, text, at FROM notices ORDER BY at, id').toArray();
  }
}

const SKEW = 'test-host:skew';
const EGRESS = 'test-host:egress';

export class Job extends AgentJob {
  #skew = 0;
  #chain = Promise.resolve();

  constructor(ctx, env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.#skew = (await ctx.storage.get(SKEW)) ?? 0;
    });
  }

  jobHost() {
    return { storage: clockedStorage(this.ctx.storage, () => this.#skew) };
  }

  deps() {
    const get = probeGet((e) => {
      this.#chain = this.#chain.then(async () => this.ctx.storage.put(EGRESS, [...((await this.ctx.storage.get(EGRESS)) ?? []), e]));
      return this.#chain;
    });
    const vault = this.env.VAULT.get(this.env.VAULT.idFromName(this.env.TENANT_ID));
    return {
      ...super.deps(),
      now: () => Date.now() + this.#skew,
      get: () => get,
      tools: (owner, jobId) => jobToolSpecs({ owner, jobId, get, memory: personMemory(this.env, owner), egress: egressFor(vault, owner), bucket: this.env.AGENT_BUCKET }),
    };
  }

  /** Moves the clock to the job's next alarm and fires it now, as the runtime fires any alarm (F30). */
  async testHostTick() {
    const alarm = await this.ctx.storage.getAlarm();
    const skew = skewToNext(this.#skew, alarm, Date.now());
    if (skew === null) return { ok: false, code: 'P7_NO_ALARM', reason: 'the job has no alarm armed' };
    this.#skew = skew;
    await this.ctx.storage.put(SKEW, skew);
    await this.ctx.storage.setAlarm(Date.now());
    return { ok: true };
  }

  /** The job's clock: its armed alarm and now, both in its own time, and every request its network was sent. */
  async testHostClock() {
    await this.#chain;
    const alarm = await this.ctx.storage.getAlarm();
    return { alarmAt: alarm === null ? null : alarm + this.#skew, now: Date.now() + this.#skew, egress: (await this.ctx.storage.get(EGRESS)) ?? [] };
  }
}

export class SubAgent extends AgentSubAgent {
  /** The allowlist and, on a slot, the probe page's `browse_open` over the fixture sites, the brief's addresses held (F32). */
  reads(person, input) {
    return [...super.reads(person, input), childBrowse(person, input.brief, testHostBinding(async () => {}))];
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

  /** An empty job list and the home zone saved as `zone`, before a P7 trial (F30). */
  async testHostP7Reset(zone) {
    this.ctx.storage.sql.exec('DELETE FROM job_index');
    this.ctx.storage.sql.exec("INSERT OR REPLACE INTO job_settings (k, v) VALUES ('home_zone', ?)", zone);
  }
}

export class Ledger extends AgentLedger {
  async testHostDump() {
    return tables(this.ctx.storage.sql);
  }

  /** Every model call's person, run and route (F30: a job's model calls are its route's). */
  async testHostCalls() {
    return this.ctx.storage.sql.exec('SELECT person, run_id, route FROM model_calls ORDER BY id').toArray();
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

/** The P5 probe's domains (F32): reopened too, so no earlier trial's failed read is remembered as a block. */
const P5_DOMAINS = ['example.com', 'example.invalid'];
const EMAIL = /^[^\s@]+@[^\s@]+$/;
const CHAT_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** The answer to a test-host op from the lease's holder: `{ status, body }`. */
export async function testHost(body, env) {
  if (typeof body.person !== 'string' || !EMAIL.test(body.person)) return { status: 400, body: { error: { code: 'invalid', message: 'name the person' } } };
  const person = await getAgentByName(env.PERSON, body.person);
  if (body.op === 'reset') {
    for (const domain of [...Object.keys(SITES), ...P5_DOMAINS]) await person.browseRecord({ domain, engine: null, state: 'ok', code: null });
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
  if (body.op === 'p5') {
    // F32: the P5 world (./test-host-p5.mjs): the system prompts a chat's model requests carried.
    if (typeof body.chat !== 'string' || !CHAT_ID.test(body.chat)) return { status: 400, body: { error: { code: 'invalid', message: 'name the chat' } } };
    return { status: 200, body: { prompts: await (await getAgentByName(env.CHAT, body.chat)).testHostPrompts() } };
  }
  if (body.op === 'p7') {
    // F30: the P7 world (./test-host-p7.mjs): Sam's jobs reset, defined, ticked and read, with the chat's notices.
    if (body.chat !== undefined && (typeof body.chat !== 'string' || !CHAT_ID.test(body.chat))) return { status: 400, body: { error: { code: 'invalid', message: 'name the chat' } } };
    const call = { ...(body.call ?? {}), ...(body.chat ? { chat: body.chat } : {}) };
    const h = {
      person,
      job: (id) => env.JOB.get(env.JOB.idFromName(jobName(body.person, id))),
      chat: (id) => getAgentByName(env.CHAT, id),
      ledger: env.LEDGER.get(env.LEDGER.idFromName(env.TENANT_ID)),
    };
    return { status: 200, body: { answer: await p7Op(call, body.person, h) } };
  }
  return { status: 404, body: { error: { code: 'not_found', message: 'no such test-host op' } } };
}
