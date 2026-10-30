// A preview slot's test host (F26): the P15 tier-2 tasks' world on a real slot with the real model. Deployed only
// to a slot, through ./app.mjs; `pnpm self-host` deploys packages/agent/src/index.ts, which never imports this file.
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
// - `Chat` keeps each chat model request's other messages too, and the `p3` op reads them with the chat's sub-agent and
//   mailbox rows; the browser serves P3's two probe pages, the second slowly (F34, ./test-host-p3.mjs).
// - `Vault` answers the Example API (`api.example.com/p9-probe`) in-process and keeps every request its network was sent,
//   `Chat` offers the P9 fixture connector over it, and the `p9` op resets and reads a person's credential rows with a
//   chat's cards and messages (F37, ./test-host-p9.mjs).
// - `shop.example.invalid` is no site the browser serves and is reopened by `reset`; the `p12` op deletes a person's
//   grant rows, and reads a chat's cards with their words, the person's grants, journal rows and jobs (F39,
//   ./test-host-p12.mjs).
// - `Chat` keeps every system message of each chat model request too (the envelope's `model:` line is the second),
//   and the `p14` op resets a person's standing files to the seed, seeds a second passkey, and reads the standing
//   files, memory, table counts, chat model calls, mail journal rows and a chat's requests with their tool lines (F41,
//   ./test-host-p14.mjs).
import { getAgentByName } from 'agents';
import { egressFor } from '../../packages/agent/src/connectors/egress.ts';
import { Chat as AgentChat, Job as AgentJob, Ledger as AgentLedger, Person as AgentPerson, SubAgent as AgentSubAgent, Vault as AgentVault } from '../../packages/agent/src/index.ts';
import { jobToolSpecs } from '../../packages/agent/src/jobs/job-tools.ts';
import { personFiles, personMemory } from '../../packages/agent/src/memory/rpc.ts';
import { jobName } from '../../packages/agent/src/objects/job.ts';
import { VERIFIER_INSTRUCTIONS } from '../../packages/agent/src/subagents/verifier.ts';
import { fixtureNamespace } from '../../test/evals/p9-connectors/fixture-connector.ts';
import { shareNamespace } from '../../test/support/p15-fixtures.ts';
import { childBrowse } from './test-host-child.mjs';
import { chunks, joinChunks, p3Rows, requestText } from './test-host-p3.mjs';
import { recordingAi } from './test-host-p5.mjs';
import { chatRows, p6Person } from './test-host-p6.mjs';
import { clockedStorage, p7Op, probeGet, skewToNext } from './test-host-p7.mjs';
import { P12_DEAD, p12Cards, p12Grants, p12Journal, p12Reset } from './test-host-p12.mjs';
import { counts, p14Memory, p14Read, p14ResetStanding, p14SeedPasskey, systemsText } from './test-host-p14.mjs';
import { p9ChatRows, p9Network, p9Reset, p9VaultRows } from './test-host-p9.mjs';
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
const REQUESTS = 'test-host:request:';
const SYSTEMS = 'test-host:system:';

export class Chat extends AgentChat {
  #chain = Promise.resolve();

  constructor(ctx, env) {
    super(ctx, env);
    // F32: each chat model request's system prompt kept, one key each (a prompt is too long to share a value), the
    // verifier's left out; the request itself is sent unchanged.
    this.env = { ...env, AI: recordingAi(env.AI, (p, body) => this.#keepPrompt(p, body), (p) => p.startsWith(VERIFIER_INSTRUCTIONS)) };
  }

  #keepPrompt(prompt, body) {
    this.#chain = this.#chain.then(async () => {
      const n = String((await this.ctx.storage.list({ prefix: PROMPTS })).size + 1).padStart(6, '0');
      await this.ctx.storage.put(`${PROMPTS}${n}`, prompt);
      // F34: the request's other messages, in values of at most CHUNK characters.
      const text = requestText(body) ?? '';
      for (const [k, part] of chunks(text).entries()) await this.ctx.storage.put(`${REQUESTS}${n}:${String(k).padStart(3, '0')}`, part);
      // F41: every system message, the envelope's among them.
      for (const [k, part] of chunks(systemsText(body) ?? '').entries()) await this.ctx.storage.put(`${SYSTEMS}${n}:${String(k).padStart(3, '0')}`, part);
    });
    return this.#chain;
  }

  /** Each chat model request's messages other than its system prompt, as one text, in order; the sub-agent and mailbox rows (F34). */
  async testHostP3() {
    await this.#chain;
    return { requests: joinChunks(await this.ctx.storage.list({ prefix: REQUESTS })), ...p3Rows(this.ctx.storage.sql) };
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
    // F37: the P9 fixture connector, over the Vault's egress as the slot's owner.
    const vault = this.env.VAULT.get(this.env.VAULT.idFromName(this.env.TENANT_ID));
    return [shareNamespace((r) => void this.#append('egress', r)), fixtureNamespace(() => egressFor(vault, this.env.OWNER_EMAIL))];
  }

  /** The chat's cards and stored messages, and each model request's messages (F37, ./test-host-p9.mjs). */
  async testHostP9() {
    await this.#chain;
    return { ...p9ChatRows(this.ctx.storage.sql), requests: joinChunks(await this.ctx.storage.list({ prefix: REQUESTS })) };
  }

  /** Each chat model request's system messages, in order, and every table's row count (F41, ./test-host-p14.mjs). */
  async testHostP14() {
    await this.#chain;
    return { systems: joinChunks(await this.ctx.storage.list({ prefix: SYSTEMS })), counts: counts(this.ctx.storage.sql) };
  }

  /** The chat's cards with the words `renderCard` gives them (F39, ./test-host-p12.mjs). */
  async testHostP12() {
    return p12Cards(this.ctx.storage, (e) => e);
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

  /** The standing-file reset before a P14 trial, or the person's memory and table counts (F41, ./test-host-p14.mjs). */
  async testHostP14(call) {
    if (call === 'reset') return { reset: await p14ResetStanding(this.env.AGENT_BUCKET, this.name, Date.now()) };
    return { ...(await p14Memory(this.personMemory, this.name)), counts: counts(this.ctx.storage.sql) };
  }

  /** Every grant row of this person deleted, before a P12 trial (F39). */
  async testHostP12Reset() {
    p12Reset(this.ctx.storage.sql);
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

  /** The person's chat model calls (id, model) and every table's row count (F41). */
  async testHostP14(person) {
    return { calls: this.ctx.storage.sql.exec("SELECT id, model FROM model_calls WHERE person = ? AND route = 'chat' ORDER BY id", person).toArray(), counts: counts(this.ctx.storage.sql) };
  }

  /** Every model call's person, run and route (F30: a job's model calls are its route's). */
  async testHostCalls() {
    return this.ctx.storage.sql.exec('SELECT person, run_id, route FROM model_calls ORDER BY id').toArray();
  }
}

const SENT = 'test-host:sent';

export class Vault extends AgentVault {
  #chain = Promise.resolve();

  /** F37: the Example API answered in-process, every request kept in order; no other host is reached. */
  network() {
    return p9Network((e) => {
      this.#chain = this.#chain.then(async () => this.ctx.storage.put(SENT, [...((await this.ctx.storage.get(SENT)) ?? []), e]));
      return this.#chain;
    });
  }

  async testHostAudit() {
    return this.core.audit();
  }

  /** Every table's row count (F41). */
  async testHostCounts() {
    return counts(this.ctx.storage.sql);
  }

  async testHostDump() {
    return tables(this.ctx.storage.sql);
  }

  /** A person's credentials, registry, audit, events and grants, and every request the network was sent (F37). */
  async testHostP9(person) {
    await this.#chain;
    const secrets = this.core
      .list(person)
      .filter((c) => !c.company)
      .map((c) => ({ ref: c.ref, label: c.label, kind: c.kind, permission: c.permission, status: c.status, hosts: c.hosts.map((h) => h.host), createdAt: c.createdAt, expiresAt: c.expiresAt }));
    const grants = this.core.grants(person).map((g) => ({ ref: g.ref, hosts: g.hosts, fill: g.fill, oneShot: g.oneShot, usedAt: g.usedAt, revokedAt: g.revokedAt }));
    return { secrets, grants, ...p9VaultRows(this.ctx.storage.sql, person), sent: (await this.ctx.storage.get(SENT)) ?? [] };
  }

  /** Every credential row of the person deleted and the network's record emptied, before a P9 trial (F37). */
  async testHostP9Reset(person) {
    await this.#chain;
    p9Reset(this.ctx.storage.sql, person);
    await this.ctx.storage.delete(SENT);
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
/** The dead shop (F39): reopened too, so each P12 trial's one read of it is its own. */
const P12_DOMAINS = [P12_DEAD];
const EMAIL = /^[^\s@]+@[^\s@]+$/;
const CHAT_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** The answer to a test-host op from the lease's holder: `{ status, body }`. */
export async function testHost(body, env) {
  if (typeof body.person !== 'string' || !EMAIL.test(body.person)) return { status: 400, body: { error: { code: 'invalid', message: 'name the person' } } };
  const person = await getAgentByName(env.PERSON, body.person);
  if (body.op === 'reset') {
    for (const domain of [...Object.keys(SITES), ...P5_DOMAINS, ...P12_DOMAINS]) await person.browseRecord({ domain, engine: null, state: 'ok', code: null });
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
  if (body.op === 'p3') {
    // F34: the P3 world (./test-host-p3.mjs): a chat's model requests, sub-agent rows and mailbox rows.
    if (typeof body.chat !== 'string' || !CHAT_ID.test(body.chat)) return { status: 400, body: { error: { code: 'invalid', message: 'name the chat' } } };
    return { status: 200, body: await (await getAgentByName(env.CHAT, body.chat)).testHostP3() };
  }
  if (body.op === 'p9') {
    // F37: the P9 world (./test-host-p9.mjs): the person's credential rows reset, or read with a chat's rows and stores.
    const vault = env.VAULT.get(env.VAULT.idFromName(env.TENANT_ID));
    if (body.call === 'reset') {
      await vault.testHostP9Reset(body.person);
      return { status: 200, body: { reset: true } };
    }
    if (typeof body.chat !== 'string' || !CHAT_ID.test(body.chat)) return { status: 400, body: { error: { code: 'invalid', message: 'name the chat' } } };
    const chat = await getAgentByName(env.CHAT, body.chat);
    const ledger = env.LEDGER.get(env.LEDGER.idFromName(env.TENANT_ID));
    const files = (await personFiles(env, body.person).fileList({}, body.person))?.files ?? [];
    const rowsText = JSON.stringify([['chat', await chat.testHostDump()], ['person', await person.testHostDump()], ['ledger', await ledger.testHostDump()], ['vault', await vault.testHostDump()]]);
    return { status: 200, body: { vault: await vault.testHostP9(body.person), chat: await chat.testHostP9(), files: files.map((f) => f.path), rowsText } };
  }
  if (body.op === 'p12') {
    // F39: the P12 world (./test-host-p12.mjs): the person's grant rows reset, or read with a chat's cards, the
    // person's journal rows and jobs.
    if (body.call === 'reset') {
      await person.testHostP12Reset();
      return { status: 200, body: { reset: true } };
    }
    if (typeof body.chat !== 'string' || !CHAT_ID.test(body.chat)) return { status: 400, body: { error: { code: 'invalid', message: 'name the chat' } } };
    const ledger = env.LEDGER.get(env.LEDGER.idFromName(env.TENANT_ID));
    const jobs = [];
    for (const id of (await person.jobIds(body.person)) ?? []) {
      const seen = await env.JOB.get(env.JOB.idFromName(jobName(body.person, id))).inspect(body.person);
      jobs.push({ id, title: seen.ok && seen.job ? seen.job.def.title : id });
    }
    const cards = await (await getAgentByName(env.CHAT, body.chat)).testHostP12();
    return { status: 200, body: { cards, grants: p12Grants(await person.listGrants(body.person)), journal: p12Journal(await ledger.journalRows({ principal: body.person })), jobs } };
  }
  if (body.op === 'p14') {
    // F41: the P14 world (./test-host-p14.mjs): the standing-file reset, the passkey seed, or a read with a chat's rows.
    if (body.call === 'reset') return { status: 200, body: await person.testHostP14('reset') };
    if (body.call === 'seed') {
      const company = env.COMPANY.get(env.COMPANY.idFromName(env.TENANT_ID));
      return { status: 200, body: await p14SeedPasskey((c) => company.loginCall(c), body.person) };
    }
    if (typeof body.chat !== 'string' || !CHAT_ID.test(body.chat)) return { status: 400, body: { error: { code: 'invalid', message: 'name the chat' } } };
    const chat = await (await getAgentByName(env.CHAT, body.chat)).testHostP14();
    const ledger = env.LEDGER.get(env.LEDGER.idFromName(env.TENANT_ID));
    const vault = env.VAULT.get(env.VAULT.idFromName(env.TENANT_ID));
    const mem = await person.testHostP14('read');
    const led = await ledger.testHostP14(body.person);
    return { status: 200, body: p14Read({ mem, chat, ledger: led, vault: await vault.testHostCounts(), journal: await ledger.journalRows({ principal: body.person }) }) };
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
