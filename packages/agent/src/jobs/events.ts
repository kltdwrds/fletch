// Event gates (M6.1, AD-3, AD-4): an event an owner's `Ingress` source accepted becomes exactly one
// gate evaluation in each `Job` subscribed to it. The evaluation is keyed on the event id in this
// object's SQLite, so a redelivery after a lost answer, a lease that expired mid-delivery or a
// duplicate from the sender evaluates nothing twice. Deterministic code decides; no model is called.
import type { Gate, Observation } from "./gates.ts";

/** What the `Ingress` hands a subscribed job; the payload is data and is fenced wherever it is shown. */
export interface JobEvent {
  eventId: string;
  /** The `Ingress` source id. */
  source: string;
  /** The source's owner: an event reaches only its owner's jobs. */
  owner: string;
  payload: string;
}

export type EventVerdict =
  | { open: true; observed: Observation }
  | { open: false; why: "not_an_event_gate" | "other_source" | "no_match" | "not_json" | "job_not_active" };

export interface EventEvaluation {
  eventId: string;
  source: string;
  open: boolean;
  why: string;
  observed: Observation;
  runId: string | null;
  at: number;
}

export const SCHEMA = `CREATE TABLE IF NOT EXISTS event_evals (
  event_id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  open INTEGER NOT NULL,
  why TEXT NOT NULL,
  observed TEXT NOT NULL,
  run_id TEXT,
  at INTEGER NOT NULL
);`;

const EXCERPT = 600;

/** The value at a JSON pointer (RFC 6901); `undefined` when absent. */
function valueAt(doc: unknown, pointer: string): unknown {
  let cur = doc;
  for (const raw of pointer.split("/").slice(1)) {
    const key = raw.replace(/~1/g, "/").replace(/~0/g, "~");
    cur = cur !== null && typeof cur === "object" ? (cur as Record<string, unknown>)[key] : undefined;
  }
  return cur;
}

/** Decides whether an event opens this job's gate. Pure: the same event always decides the same way. */
export function evaluateEvent(gate: Gate | null, e: JobEvent): EventVerdict {
  if (gate?.kind !== "event") return { open: false, why: "not_an_event_gate" };
  if (gate.source !== e.source) return { open: false, why: "other_source" };
  if (gate.pointer !== undefined) {
    let doc: unknown;
    try {
      doc = JSON.parse(e.payload);
    } catch {
      return { open: false, why: "not_json" };
    }
    const v = valueAt(doc, gate.pointer);
    if (v === undefined || (gate.equals !== undefined && v !== gate.equals)) return { open: false, why: "no_match" };
  }
  return { open: true, observed: { source: e.source, event: e.eventId, excerpt: e.payload.slice(0, EXCERPT) } };
}

type Raw = Record<string, SqlStorageValue>;

/** The job's evaluations, one row per event id. */
export class EventLog {
  private readonly storage: Pick<DurableObjectStorage, "sql">;

  constructor(storage: Pick<DurableObjectStorage, "sql">) {
    this.storage = storage;
  }

  private get sql(): Pick<SqlStorage, "exec"> {
    return this.storage.sql;
  }

  /** Records the evaluation once; false when this event was evaluated before. */
  record(e: JobEvent, verdict: EventVerdict, at: number): boolean {
    const before = this.sql.exec<Raw>("SELECT event_id FROM event_evals WHERE event_id = ?", e.eventId).toArray().length;
    if (before) return false;
    this.sql.exec(
      "INSERT INTO event_evals (event_id, source, open, why, observed, at) VALUES (?, ?, ?, ?, ?, ?)",
      e.eventId, e.source, verdict.open ? 1 : 0, verdict.open ? "open" : verdict.why, JSON.stringify(verdict.open ? verdict.observed : {}), at,
    );
    return true;
  }

  /** Open evaluations still waiting for their run, oldest first. */
  pending(): EventEvaluation[] {
    return this.list().filter((r) => r.open && r.runId === null);
  }

  setRun(eventId: string, runId: string): void {
    this.sql.exec("UPDATE event_evals SET run_id = ? WHERE event_id = ?", runId, eventId);
  }

  get(eventId: string): EventEvaluation | null {
    return this.list().find((r) => r.eventId === eventId) ?? null;
  }

  list(): EventEvaluation[] {
    return this.sql.exec<Raw>("SELECT * FROM event_evals ORDER BY at, event_id").toArray().map((r) => ({
      eventId: String(r.event_id), source: String(r.source), open: Number(r.open) === 1, why: String(r.why),
      observed: JSON.parse(String(r.observed)) as Observation, runId: (r.run_id as string | null) ?? null, at: Number(r.at),
    }));
  }
}
