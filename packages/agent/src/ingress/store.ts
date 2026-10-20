// The `Ingress` object's SQLite (M6.1): its one source, the events it accepted with their leases,
// what each delivery to a job answered, the refusals it logged and the socket's state. An event is
// claimed with a lease before it is delivered and marked done after, so a sender's retry while a
// delivery is in flight waits, a retry after a crash re-delivers, and a retry after success is a no-op.

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS source (
  k INTEGER PRIMARY KEY CHECK (k = 1),
  id TEXT NOT NULL,
  owner TEXT NOT NULL,
  kind TEXT NOT NULL,
  secret TEXT,
  url TEXT,
  jobs TEXT NOT NULL,
  dry_run INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS events (
  event_id TEXT PRIMARY KEY,
  via TEXT NOT NULL,
  payload TEXT NOT NULL,
  state TEXT NOT NULL,
  lease_until INTEGER,
  attempts INTEGER NOT NULL DEFAULT 1,
  received_at INTEGER NOT NULL,
  done_at INTEGER
);
CREATE TABLE IF NOT EXISTS deliveries (
  event_id TEXT NOT NULL,
  job TEXT NOT NULL,
  outcome TEXT NOT NULL,
  at INTEGER NOT NULL,
  PRIMARY KEY (event_id, job)
);
CREATE TABLE IF NOT EXISTS rejects (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL,
  reason TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS socket (
  k INTEGER PRIMARY KEY CHECK (k = 1),
  wanted INTEGER NOT NULL DEFAULT 0,
  state TEXT NOT NULL DEFAULT 'idle',
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt INTEGER,
  connects INTEGER NOT NULL DEFAULT 0,
  drops INTEGER NOT NULL DEFAULT 0,
  last_code TEXT,
  updated_at INTEGER NOT NULL
);`;

export type SourceKind = "webhook" | "socket";

export interface SourceRow {
  id: string;
  owner: string;
  kind: SourceKind;
  /** The webhook secret; never leaves the object except once, to the owner, at creation. */
  secret: string | null;
  url: string | null;
  jobs: string[];
  dryRun: boolean;
  createdAt: number;
}

export type EventState = "leased" | "done";
export interface EventRow {
  eventId: string;
  via: SourceKind;
  state: EventState;
  leaseUntil: number | null;
  attempts: number;
  receivedAt: number;
}

export interface DeliveryRow {
  eventId: string;
  job: string;
  outcome: Record<string, unknown>;
}

export interface SocketRow {
  wanted: boolean;
  state: "idle" | "connecting" | "connected" | "waiting";
  attempts: number;
  nextAttempt: number | null;
  connects: number;
  drops: number;
  lastCode: string | null;
}

export type Claim = "fresh" | "reclaimed" | "in_flight" | "done";

type Raw = Record<string, SqlStorageValue>;

export class IngressStore {
  private readonly storage: Pick<DurableObjectStorage, "sql" | "transactionSync">;

  constructor(storage: Pick<DurableObjectStorage, "sql" | "transactionSync">) {
    this.storage = storage;
  }

  private get sql(): Pick<SqlStorage, "exec"> {
    return this.storage.sql;
  }

  transaction<T>(fn: () => T): T {
    void this.sql;
    return this.storage.transactionSync(fn);
  }

  source(): SourceRow | null {
    const r = this.sql.exec<Raw>("SELECT * FROM source WHERE k = 1").toArray()[0];
    if (!r) return null;
    return {
      id: String(r.id), owner: String(r.owner), kind: r.kind as SourceKind, secret: (r.secret as string | null) ?? null,
      url: (r.url as string | null) ?? null, jobs: JSON.parse(String(r.jobs)) as string[], dryRun: Number(r.dry_run) === 1, createdAt: Number(r.created_at),
    };
  }

  putSource(s: SourceRow): void {
    this.sql.exec(
      "INSERT INTO source (k, id, owner, kind, secret, url, jobs, dry_run, created_at) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?)",
      s.id, s.owner, s.kind, s.secret, s.url, JSON.stringify(s.jobs), s.dryRun ? 1 : 0, s.createdAt,
    );
  }

  setDryRun(dryRun: boolean): void {
    this.sql.exec("UPDATE source SET dry_run = ? WHERE k = 1", dryRun ? 1 : 0);
  }

  /** Claims an event for delivery under a lease; decides in one read-then-write inside the caller's transaction. */
  claim(eventId: string, via: SourceKind, payload: string, now: number, leaseMs: number): Claim {
    const r = this.sql.exec<Raw>("SELECT state, lease_until FROM events WHERE event_id = ?", eventId).toArray()[0];
    if (!r) {
      this.sql.exec("INSERT INTO events (event_id, via, payload, state, lease_until, received_at) VALUES (?, ?, ?, 'leased', ?, ?)", eventId, via, payload, now + leaseMs, now);
      return "fresh";
    }
    if (r.state === "done") return "done";
    if (Number(r.lease_until) > now) return "in_flight";
    this.sql.exec("UPDATE events SET lease_until = ?, attempts = attempts + 1 WHERE event_id = ?", now + leaseMs, eventId);
    return "reclaimed";
  }

  /** Events whose delivery lease ended without finishing: their instance died mid-delivery. */
  expired(now: number): Array<{ eventId: string; via: SourceKind; payload: string }> {
    return this.sql.exec<Raw>("SELECT event_id, via, payload FROM events WHERE state = 'leased' AND lease_until <= ? ORDER BY received_at", now).toArray()
      .map((r) => ({ eventId: String(r.event_id), via: r.via as SourceKind, payload: String(r.payload) }));
  }

  finish(eventId: string, now: number): void {
    this.sql.exec("UPDATE events SET state = 'done', lease_until = NULL, done_at = ? WHERE event_id = ?", now, eventId);
  }

  recordDelivery(eventId: string, job: string, outcome: Record<string, unknown>, now: number): void {
    this.sql.exec(
      "INSERT INTO deliveries (event_id, job, outcome, at) VALUES (?, ?, ?, ?) ON CONFLICT(event_id, job) DO UPDATE SET outcome = excluded.outcome, at = excluded.at",
      eventId, job, JSON.stringify(outcome), now,
    );
  }

  reject(code: string, reason: string, now: number): void {
    this.sql.exec("INSERT INTO rejects (code, reason, at) VALUES (?, ?, ?)", code, reason.slice(0, 200), now);
  }

  events(): EventRow[] {
    return this.sql.exec<Raw>("SELECT * FROM events ORDER BY received_at, event_id").toArray().map((r) => ({
      eventId: String(r.event_id), via: r.via as SourceKind, state: r.state as EventState, leaseUntil: r.lease_until === null ? null : Number(r.lease_until),
      attempts: Number(r.attempts), receivedAt: Number(r.received_at),
    }));
  }

  /** The earliest lease still held, for the alarm that expires it. */
  nextLeaseEnd(): number | null {
    const r = this.sql.exec<Raw>("SELECT MIN(lease_until) AS t FROM events WHERE state = 'leased'").toArray()[0];
    return r?.t === null || r?.t === undefined ? null : Number(r.t);
  }

  deliveries(): DeliveryRow[] {
    return this.sql.exec<Raw>("SELECT * FROM deliveries ORDER BY at, event_id, job").toArray().map((r) => ({
      eventId: String(r.event_id), job: String(r.job), outcome: JSON.parse(String(r.outcome)) as Record<string, unknown>,
    }));
  }

  rejects(): Array<{ code: string; reason: string; at: number }> {
    return this.sql.exec<Raw>("SELECT code, reason, at FROM rejects ORDER BY seq").toArray().map((r) => ({ code: String(r.code), reason: String(r.reason), at: Number(r.at) }));
  }

  socket(): SocketRow {
    const r = this.sql.exec<Raw>("SELECT * FROM socket WHERE k = 1").toArray()[0];
    if (!r) return { wanted: false, state: "idle", attempts: 0, nextAttempt: null, connects: 0, drops: 0, lastCode: null };
    return {
      wanted: Number(r.wanted) === 1, state: r.state as SocketRow["state"], attempts: Number(r.attempts), nextAttempt: r.next_attempt === null ? null : Number(r.next_attempt),
      connects: Number(r.connects), drops: Number(r.drops), lastCode: (r.last_code as string | null) ?? null,
    };
  }

  /** Updates named socket columns; keys are this module's own column names, never input. */
  updateSocket(fields: Partial<Record<"wanted" | "state" | "attempts" | "next_attempt" | "connects" | "drops" | "last_code", string | number | null>>, now: number): void {
    this.sql.exec("INSERT INTO socket (k, updated_at) VALUES (1, ?) ON CONFLICT(k) DO NOTHING", now);
    const keys = Object.keys(fields);
    if (!keys.length) return;
    this.sql.exec(`UPDATE socket SET ${keys.map((k) => `${k} = ?`).join(", ")}, updated_at = ? WHERE k = 1`, ...keys.map((k) => fields[k as keyof typeof fields] ?? null), now);
  }
}
