// M24.2: `db_query`, the agent's read of its own work. One SELECT over one named view, checked in code
// against an allow-list, run by the object that owns the view over a person-scoped expression on real
// SQLite: every refusal is planted (a write, PRAGMA, ATTACH, two statements, sub-selects, an unknown
// table, a comment, a quoted identifier), the 200-row cap says it cut, a store that drifted from its
// views is refused, and a slow owner is answered at the tool's five-second bound, fired by the test.
// The Ledger is one member's, with a former member's rows beside hers: Ada's queries never read Bo's rows, whatever they name, and
// her dashboard counts her own turns that ended at the step cap or were stopped, never his.
import { describe, expect, it } from "vitest";
import type { ModelCallRow, TurnEndRow } from "../../packages/agent/src/ledger/types.ts";
import { MAX_STEPS_PER_TURN } from "../../packages/agent/src/chat/turn.ts";
import { personDashboard, rangeOf, renderDashboard } from "../../packages/agent/src/obs/dashboard.ts";
import { Ledger } from "../../packages/agent/src/objects/ledger.ts";
import { CHAT_VIEW_SCHEMA_VERSION, CHAT_VIEWS, queryChatView } from "../../packages/agent/src/views/chat-views.ts";
import { LEDGER_VIEW_SCHEMA_VERSION, LEDGER_VIEWS } from "../../packages/agent/src/views/ledger-views.ts";
import { DB_QUERY_MAX_ROWS, type ViewResult, type ViewSql } from "../../packages/agent/src/views/select.ts";
import { DB_QUERY_TIMEOUT_MS, dbQueryNamespace, EMPTY_IS_NOT_EVIDENCE, VIEW_OWNER } from "../../packages/agent/src/views/tool.ts";
import { CHAT_MIGRATIONS } from "../../packages/agent/src/migrations/catalog.ts";
import { migrate } from "../../packages/agent/src/migrations/engine.ts";
import { ObjectHarness } from "../support/object-harness.ts";
import { ada } from "./support/authority-world.ts";

/** Another person's rows in the tenant's Ledger (a former member's): never a member, so no fixture identity. */
const other = { email: "former-member" };

const T0 = Date.UTC(2026, 9, 16, 9, 0, 0);

/** The chat store's tables as M24.2 leaves them, on real SQLite. */

/** Ada's chat's SQLite with two turns, an outbox row whose payload holds words, a thinking message and a mailbox row. */
function adaChat() {
  const h = new ObjectHarness("chat-ada", (ctx) => ctx as { storage: { sql: ViewSql } }, {});
  migrate(h.instance.storage as never, CHAT_MIGRATIONS);
  h.db.prepare("INSERT INTO turns (id, person, status, code, steps, started_at, ended_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run("t1", ada.email, "done", null, 2, T0, T0 + 5);
  h.db.prepare("INSERT INTO turns (id, person, status, code, steps, started_at, ended_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run("t2", ada.email, "failed", "TURN_STEP_LIMIT", 8, T0 + 10, T0 + 20);
  h.db.prepare("INSERT INTO outbox (id, turn_id, payload, delivered_at) VALUES (?, ?, ?, ?)").run("c1", "t1", JSON.stringify({ kind: "deliver", id: "c1", text: "the plum harvest is in" }), T0 + 4);
  h.db.prepare("INSERT INTO outbox (id, turn_id, payload, delivered_at) VALUES (?, ?, ?, ?)").run("c2", "t2", JSON.stringify({ kind: "action", id: "c2", tool: "mail_send", args: { body: "quarterly figures" } }), null);
  h.db.prepare("INSERT INTO messages (turn_id, role, body) VALUES (?, ?, ?)").run("t1", "assistant", JSON.stringify({ role: "assistant", content: [{ type: "thinking", thinking: "private chain of thought" }] }));
  h.db.prepare("INSERT INTO mailbox (message_id, epoch, kind, scope, person, body, state, accepted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run("m-1", 0, "user", "owner", ada.email, "also check the pears", "queued", T0 + 12);
  const sql = h.instance.storage.sql;
  return { h, q: (view: string, statement: string, version = CHAT_VIEW_SCHEMA_VERSION) => queryChatView(sql, { view, sql: statement, version }) };
}

const refused = (r: ViewResult) => (r.ok ? "ok" : r.code);

describe("[M24.2] db_query's statement check refuses everything but one SELECT over the named view", () => {
  it("a write, a PRAGMA and an ATTACH are refused DB_QUERY_NOT_SELECT, and the store is unchanged", () => {
    const { h, q } = adaChat();
    expect(refused(q("turns", "DELETE FROM turns"))).toBe("DB_QUERY_NOT_SELECT");
    expect(refused(q("turns", "UPDATE turns SET status = 'done'"))).toBe("DB_QUERY_NOT_SELECT");
    expect(refused(q("turns", "INSERT INTO turns (id) VALUES ('x')"))).toBe("DB_QUERY_NOT_SELECT");
    expect(refused(q("turns", "PRAGMA table_info(turns)"))).toBe("DB_QUERY_NOT_SELECT");
    expect(refused(q("turns", "ATTACH DATABASE 'x.db' AS other"))).toBe("DB_QUERY_NOT_SELECT");
    expect(refused(q("turns", "WITH x AS (SELECT 1) SELECT * FROM turns"))).toBe("DB_QUERY_NOT_SELECT");
    expect(h.rows("SELECT COUNT(*) AS n FROM turns")).toEqual([{ n: 2 }]);
  });

  it("two statements are refused DB_QUERY_MULTIPLE_STATEMENTS; one trailing semicolon is accepted", () => {
    const { h, q } = adaChat();
    expect(refused(q("turns", "SELECT id FROM turns; DELETE FROM turns"))).toBe("DB_QUERY_MULTIPLE_STATEMENTS");
    expect(refused(q("turns", "SELECT id FROM turns;;"))).toBe("DB_QUERY_MULTIPLE_STATEMENTS");
    expect(q("turns", "SELECT id FROM turns ORDER BY id;")).toMatchObject({ ok: true, rows: [{ id: "t1" }, { id: "t2" }] });
    expect(h.rows("SELECT COUNT(*) AS n FROM turns")).toEqual([{ n: 2 }]);
  });

  it("a sub-select over sqlite_master or over a hidden table is refused DB_QUERY_SUBSELECT", () => {
    const { q } = adaChat();
    expect(refused(q("turns", "SELECT id FROM turns WHERE id IN (SELECT name FROM sqlite_master)"))).toBe("DB_QUERY_SUBSELECT");
    expect(refused(q("turns", "SELECT (SELECT body FROM messages) FROM turns"))).toBe("DB_QUERY_SUBSELECT");
    expect(refused(q("turns", "SELECT id FROM turns WHERE id IN (SELECT turn_id FROM turns)"))).toBe("DB_QUERY_SUBSELECT");
  });

  it("an unknown table, a second table or a join is refused DB_QUERY_UNKNOWN_VIEW", () => {
    const { q } = adaChat();
    expect(refused(q("turns", "SELECT * FROM messages"))).toBe("DB_QUERY_UNKNOWN_VIEW");
    expect(refused(q("turns", "SELECT * FROM sqlite_master"))).toBe("DB_QUERY_UNKNOWN_VIEW");
    expect(refused(q("turns", "SELECT * FROM turns, messages"))).toBe("DB_QUERY_UNKNOWN_VIEW");
    expect(refused(q("turns", "SELECT * FROM turns JOIN messages"))).toBe("DB_QUERY_UNKNOWN_VIEW");
    expect(refused(q("turns", "SELECT * FROM turns t"))).toBe("DB_QUERY_UNKNOWN_VIEW");
    expect(refused(q("messages", "SELECT * FROM messages"))).toBe("DB_QUERY_UNKNOWN_VIEW");
    expect(refused(q("ledger_rows", "SELECT * FROM ledger_rows"))).toBe("DB_QUERY_UNKNOWN_VIEW");
  });

  it("a comment, a quoted identifier, an unlisted function or a hidden column is refused DB_QUERY_UNKNOWN_IDENTIFIER", () => {
    const { q } = adaChat();
    expect(refused(q("turns", "SELECT id FROM turns -- ; DROP TABLE turns"))).toBe("DB_QUERY_UNKNOWN_IDENTIFIER");
    expect(refused(q("turns", "SELECT id FROM turns /* x */"))).toBe("DB_QUERY_UNKNOWN_IDENTIFIER");
    expect(refused(q("turns", 'SELECT "person" FROM turns'))).toBe("DB_QUERY_UNKNOWN_IDENTIFIER");
    expect(refused(q("turns", "SELECT [person] FROM turns"))).toBe("DB_QUERY_UNKNOWN_IDENTIFIER");
    expect(refused(q("turns", "SELECT person FROM turns"))).toBe("DB_QUERY_UNKNOWN_IDENTIFIER");
    expect(refused(q("outbox", "SELECT payload FROM outbox"))).toBe("DB_QUERY_UNKNOWN_IDENTIFIER");
    expect(refused(q("outbox", "SELECT load_extension('x') FROM outbox"))).toBe("DB_QUERY_UNKNOWN_IDENTIFIER");
    expect(refused(q("turns", "SELECT id FROM turns WHERE id = ?"))).toBe("DB_QUERY_UNKNOWN_IDENTIFIER");
  });

  it("an accepted SELECT reads the view with filters, aggregates and aliases, and no view carries a body, an argument or thinking", () => {
    const { q } = adaChat();
    expect(q("turns", "SELECT status, COUNT(*) AS n FROM turns GROUP BY status ORDER BY status")).toEqual({ ok: true, view: "turns", rows: [{ status: "done", n: 1 }, { status: "failed", n: 1 }], truncated: false });
    expect(q("turns", "SELECT id, code FROM turns WHERE code = 'TURN_STEP_LIMIT'")).toMatchObject({ rows: [{ id: "t2", code: "TURN_STEP_LIMIT" }] });
    expect(q("delivery", "SELECT id, kind, state FROM delivery ORDER BY id")).toMatchObject({ rows: [{ id: "c1", kind: "deliver", state: "delivered" }, { id: "c2", kind: "action", state: "pending" }] });
    const everything = CHAT_VIEWS.map((v) => q(v.name, `SELECT * FROM ${v.name}`));
    expect(everything.every((r) => r.ok)).toBe(true);
    const text = JSON.stringify(everything);
    for (const words of ["plum harvest", "quarterly figures", "private chain of thought", "also check the pears"]) expect(text).not.toContain(words);
    expect(text).toContain("mail_send");
  });

  it(`answers at most ${DB_QUERY_MAX_ROWS} rows and says it cut the answer`, () => {
    const { h, q } = adaChat();
    const add = h.db.prepare("INSERT INTO turns (id, person, status, steps, started_at) VALUES (?, ?, 'done', 1, ?)");
    for (let i = 0; i < 250; i++) add.run(`bulk-${i}`, ada.email, T0 + 100 + i);
    const r = q("turns", "SELECT id FROM turns");
    expect(r).toMatchObject({ ok: true, truncated: true });
    expect(r.ok && r.rows.length).toBe(DB_QUERY_MAX_ROWS);
    expect(q("turns", "SELECT COUNT(*) AS n FROM turns")).toEqual({ ok: true, view: "turns", rows: [{ n: 252 }], truncated: false });
    expect(q("turns", "SELECT id FROM turns LIMIT 5")).toMatchObject({ truncated: false });
  });

  it("a store that drifted from its views, or a caller pinned to another version, is refused DB_VIEW_SCHEMA_MISMATCH", () => {
    const { h, q } = adaChat();
    expect(q("turns", "SELECT id FROM turns", CHAT_VIEW_SCHEMA_VERSION + 1)).toMatchObject({ ok: false, code: "DB_VIEW_SCHEMA_MISMATCH" });
    expect(q("compactions", "SELECT id FROM compactions")).toMatchObject({ ok: true });
    h.db.exec("ALTER TABLE compactions RENAME COLUMN reason TO why");
    const r = q("compactions", "SELECT id FROM compactions");
    expect(r).toMatchObject({ ok: false, code: "DB_VIEW_SCHEMA_MISMATCH" });
    expect(!r.ok && r.reason).toContain("compactions.reason");
    // The other views still answer: the mismatch is the drifted view's alone.
    expect(q("turns", "SELECT id FROM turns")).toMatchObject({ ok: true });
  });
});

/** The bound's timer, fired by the test. */
function timer() {
  const live: Array<{ fn: () => void; ms: number; cancelled: boolean }> = [];
  return {
    live: () => live.filter((t) => !t.cancelled),
    schedule: (fn: () => void, ms: number) => {
      const t = { fn, ms, cancelled: false };
      live.push(t);
      return () => {
        t.cancelled = true;
      };
    },
  };
}

const call = (ns: ReturnType<typeof dbQueryNamespace>, args: { view: string; sql: string }) => (ns.tools[0] as { execute: (id: string, a: unknown) => Promise<{ content: Array<{ text: string }> }> }).execute("call-1", args);

describe("[M24.2] the db_query tool", () => {
  it(`a slow owner is answered DB_QUERY_TIMEOUT once the ${DB_QUERY_TIMEOUT_MS} ms bound fires, and an answer in time cancels the bound`, async () => {
    const t = timer();
    const ns = dbQueryNamespace({ query: () => new Promise<ViewResult>(() => {}) }, t.schedule);
    const pending = call(ns, { view: "turns", sql: "SELECT id FROM turns" });
    await Promise.resolve();
    const bound = t.live().find((x) => x.ms === DB_QUERY_TIMEOUT_MS);
    expect(bound).toBeDefined();
    bound?.fn();
    await expect(pending).rejects.toThrow(/^DB_QUERY_TIMEOUT: /);

    const quick = dbQueryNamespace({ query: async () => ({ ok: true, view: "turns", rows: [{ id: "t1" }], truncated: false }) }, t.schedule);
    const answered = await call(quick, { view: "turns", sql: "SELECT id FROM turns" });
    expect(JSON.parse(answered.content[0]?.text ?? "")).toEqual({ view: "turns", rows: [{ id: "t1" }], truncated: false });
    expect(t.live()).toEqual([]);
  });

  it("carries the rule that an empty result is not evidence, says a refusal with its code, and names each view's owner", async () => {
    const t = timer();
    const { q } = adaChat();
    const ns = dbQueryNamespace({ query: async (i) => q(i.view, i.sql) }, t.schedule);
    expect(ns.tools[0]?.description).toContain(EMPTY_IS_NOT_EVIDENCE);
    const empty = await call(ns, { view: "turns", sql: "SELECT id FROM turns WHERE status = 'stopped'" });
    expect(empty.content[0]?.text).toContain(EMPTY_IS_NOT_EVIDENCE);
    await expect(call(ns, { view: "turns", sql: "DELETE FROM turns" })).rejects.toThrow(/^DB_QUERY_NOT_SELECT: /);
    expect(Object.fromEntries(Object.entries(VIEW_OWNER).map(([k, v]) => [k, v.owner]))).toEqual({
      turns: "chat", outbox: "chat", delivery: "chat", compactions: "chat", mailbox: "chat", ledger_rows: "ledger", runs: "ledger", turn_ends: "ledger",
    });
    expect(VIEW_OWNER.ledger_rows?.version).toBe(LEDGER_VIEW_SCHEMA_VERSION);
    expect(LEDGER_VIEWS.every((v) => v.base.includes("WHERE person = ?"))).toBe(true);
  });
});

/** The tenant's Ledger on real SQLite, with a call row, a job run and turn ends for each of Ada and Bo. */
async function wrenLedger() {
  const h = new ObjectHarness("ledger-wren", (ctx, env) => new Ledger(ctx as DurableObjectState, env as Env), { TENANT_ID: ada.company }, (l) => {
    l.now = () => T0;
  });
  const ledger = h.instance;
  const row = (person: string, runId: string): ModelCallRow => ({ tenant: ada.company, person, runId, route: "chat", model: "glm", attempt: 1, status: "ok", code: null, httpStatus: 200, inputTokens: 100, outputTokens: 10, reasoningTokens: 0, cachedTokens: 0, at: T0, startedAt: T0, firstTokenAt: T0, finishedAt: T0 });
  await ledger.record(row(ada.email, "ada-turn"));
  await ledger.record(row(other.email, "bo-turn"));
  for (const person of [ada.email, other.email]) {
    await ledger.recordRun({ runId: `${person}-run`, jobId: "digest", person, scheduledFor: T0, phase: "done", attempt: 1, step: 1, leaseUntil: null, timeoutAt: null, tokens: 0, costMicros: 0, signal: "notify", code: null, reason: null, nextProbe: null, startedAt: T0, updatedAt: T0 });
  }
  const end = (person: string, chatId: string, turnId: string, outcome: TurnEndRow["outcome"]): TurnEndRow => ({ person, chatId, turnId, outcome, steps: outcome === "step_limit" ? MAX_STEPS_PER_TURN : 3, at: T0 });
  await ledger.turnEnded(end(ada.email, "chat-ada", "a1", "step_limit"));
  await ledger.turnEnded(end(ada.email, "chat-ada", "a2", "step_limit"));
  await ledger.turnEnded(end(ada.email, "chat-ada", "a3", "stopped"));
  await ledger.turnEnded(end(other.email, "chat-bo", "b1", "step_limit"));
  await ledger.turnEnded(end(other.email, "chat-bo", "b2", "stopped"));
  return { h, ledger };
}

describe("[M24.2] the Ledger's views and turn ends, two members", () => {
  it("Ada's query never reads Bo's rows, even when it names him: ledger_rows, runs and turn_ends answer hers alone", async () => {
    const { ledger } = await wrenLedger();
    const ask = (view: string, sql: string) => ledger.queryView(ada.email, { view, sql, version: LEDGER_VIEW_SCHEMA_VERSION });
    expect(await ask("ledger_rows", `SELECT person, run_id FROM ledger_rows WHERE person = '${other.email}'`)).toEqual({ ok: true, view: "ledger_rows", rows: [], truncated: false });
    expect(await ask("ledger_rows", "SELECT person, run_id FROM ledger_rows")).toMatchObject({ rows: [{ person: ada.email, run_id: "ada-turn" }] });
    expect(await ask("runs", "SELECT person, run_id, phase, signal FROM runs")).toMatchObject({ rows: [{ person: ada.email, run_id: `${ada.email}-run`, phase: "done", signal: "notify" }] });
    const ends = await ask("turn_ends", "SELECT chat_id, turn_id, outcome FROM turn_ends ORDER BY turn_id");
    expect(ends).toMatchObject({ ok: true, rows: [{ turn_id: "a1" }, { turn_id: "a2" }, { turn_id: "a3" }] });
    expect(JSON.stringify(ends)).not.toContain("chat-bo");
    expect(await ask("turn_ends", `SELECT turn_id FROM turn_ends WHERE person = '${other.email}' OR 1 = 1`)).toMatchObject({ rows: [{ turn_id: "a1" }, { turn_id: "a2" }, { turn_id: "a3" }] });
    // The Ledger's other tables are no view: a hostile statement reaches none of them.
    expect(await ask("ledger_rows", "SELECT * FROM journal")).toMatchObject({ ok: false, code: "DB_QUERY_UNKNOWN_VIEW" });
    expect(await ask("turns", "SELECT * FROM turns")).toMatchObject({ ok: false, code: "DB_QUERY_UNKNOWN_VIEW" });
  });

  it("a turn end is kept once per chat and turn, and an unknown outcome is refused", async () => {
    const { h, ledger } = await wrenLedger();
    await ledger.turnEnded({ person: ada.email, chatId: "chat-ada", turnId: "a1", outcome: "stopped", steps: 1, at: T0 + 1 });
    expect(h.rows("SELECT outcome FROM turn_ends WHERE turn_id = 'a1'")).toEqual([{ outcome: "step_limit" }]);
    await expect(ledger.turnEnded({ person: ada.email, chatId: "chat-ada", turnId: "a9", outcome: "done" as never, steps: 1, at: T0 })).rejects.toThrow(/^TURN_END_INVALID/);
  });

  it("Ada's dashboard counts her two turns at the step cap and her one stopped turn, never Bo's", async () => {
    const { ledger } = await wrenLedger();
    const range = rangeOf(7, T0 + 1000);
    if (!("from" in range)) throw new Error("range");
    const counts = { person: ada.email, items: 0, delivered: 0, failed: 0, open: 0, retried: 0, accepted: 0, edited: 0, rejected: 0, stopped: 0 };
    const view = await personDashboard({ chats: async () => ({ ok: true, chats: [] }), compactions: async () => [], items: async () => ({ ok: true, items: [] }), counts: async () => counts, ledger }, ada.email, range);
    if (!view.ok) throw new Error(view.code);
    expect(view.rollup.turns).toEqual({ stepLimit: 2, stopped: 1 });
    expect(renderDashboard(view)).toContain(`<p id="turns">2 chat turns ended at the ${MAX_STEPS_PER_TURN}-step cap; 1 stopped by the person</p>`);
    const tenant = await ledger.dashboard(range, []);
    expect(tenant.turns).toEqual({ stepLimit: 3, stopped: 2 });
  });
});
