// The chat's mailbox (M24.2, the Muse parity spec's P2): every input that asks for a turn is a row
// here first. A `send` while a turn runs is no longer refused: it is stored `queued` with its
// accepted ordinal, the conversation epoch, its kind and routing scope, keyed on the page's own id for
// the send under a unique index, so a resend of the same frame is answered with the first row and
// never stored twice. Queued rows reach the running turn at its next step boundary as one fenced
// block (`steerMessage`) and go `completed`; a Stop leaves them `aborted`; a row queued when no turn
// runs starts one, as a send did before. A delegation's handoff is an `internal_handoff` row in the
// same order, and a reaction that answers the agent's pending question (F10) a `reaction` row. The epoch
// advances at a compaction checkpoint and when the chat is reopened.
import type { Message } from "@earendil-works/pi-ai";
import { fence } from "../context/fence.ts";

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS mailbox (
  ordinal INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id TEXT NOT NULL,
  epoch INTEGER NOT NULL,
  kind TEXT NOT NULL,
  scope TEXT NOT NULL,
  person TEXT NOT NULL,
  body TEXT NOT NULL,
  time_zone TEXT,
  state TEXT NOT NULL,
  turn_id TEXT,
  delivery TEXT,
  seq INTEGER,
  accepted_at INTEGER NOT NULL,
  settled_at INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS mailbox_message_id ON mailbox (message_id);`;

export type MailKind = "user" | "internal_handoff" | "reaction";
export type MailState = "queued" | "completed" | "aborted";

export interface MailRow {
  ordinal: number;
  messageId: string;
  epoch: number;
  kind: MailKind;
  /** Who the row answers to: `owner` for the person's own words, `delegation:<grp>` for a handoff, `reaction:<person>` for a reaction. */
  scope: string;
  person: string;
  text: string;
  timeZone: string | null;
  state: MailState;
  turnId: string | null;
  /** How it entered a turn: it started one, or it was steered into a running one at a step boundary. */
  delivery: "start" | "steer" | null;
  seq: number | null;
  acceptedAt: number;
  settledAt: number | null;
}

type Raw = { ordinal: number; message_id: string; epoch: number; kind: MailKind; scope: string; person: string; body: string; time_zone: string | null; state: MailState; turn_id: string | null; delivery: "start" | "steer" | null; seq: number | null; accepted_at: number; settled_at: number | null };

const row = (r: Raw): MailRow => ({ ordinal: r.ordinal, messageId: r.message_id, epoch: r.epoch, kind: r.kind, scope: r.scope, person: r.person, text: r.body, timeZone: r.time_zone, state: r.state, turnId: r.turn_id, delivery: r.delivery, seq: r.seq, acceptedAt: r.accepted_at, settledAt: r.settled_at });

/** A row's id when the send carried no page id: a colon no page id may hold (`protocol.ts`), so the two never meet. */
export const serverId = () => `server:${crypto.randomUUID()}`;
/** The page's own id for the send, or undefined when the chat made one up. */
export const clientIdOf = (row: MailRow): string | undefined => (row.messageId.startsWith("server:") ? undefined : row.messageId);

/** The chat-meta key of the conversation epoch. */
export const EPOCH_KEY = "epoch";

/** The policy line of a steered block: it is the person's addition, kept apart from the interrupted work. */
export const STEER_POLICY =
  "(From the harness, not a reply to your last step.) The input below arrived while you were working on this turn: the person added it during the turn. " +
  "Do not mix it with the interrupted work: finish or set aside that work as it stands, and answer this on its own. " +
  "If it needs nothing from you now, end this step with nothing to do.";

interface Meta {
  meta(key: string): string | undefined;
  setMeta(key: string, value: string): void;
}

export class Mailbox {
  private readonly sql: SqlStorage;
  private readonly store: Meta;

  constructor(sql: SqlStorage, store: Meta) {
    this.sql = sql;
    this.store = store;
  }

  epoch(): number {
    return Number(this.store.meta(EPOCH_KEY) ?? "0");
  }

  /** At a compaction checkpoint and at reopen; the caller's transaction holds it. */
  advanceEpoch(): number {
    const next = this.epoch() + 1;
    this.store.setMeta(EPOCH_KEY, String(next));
    return next;
  }

  byId(messageId: string): MailRow | undefined {
    const r = this.sql.exec<Raw>("SELECT * FROM mailbox WHERE message_id = ?", messageId).toArray()[0];
    return r ? row(r) : undefined;
  }

  /** Stores a row `queued`; the unique index answers a resent id with the first row and `duplicate`. */
  accept(a: { messageId: string; kind: MailKind; scope: string; person: string; text: string; timeZone?: string; at: number }): { row: MailRow; duplicate: boolean } {
    const inserted = this.sql
      .exec<{ ordinal: number }>(
        "INSERT INTO mailbox (message_id, epoch, kind, scope, person, body, time_zone, state, accepted_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', ?) ON CONFLICT(message_id) DO NOTHING RETURNING ordinal",
        a.messageId, this.epoch(), a.kind, a.scope, a.person, a.text, a.timeZone ?? null, a.at,
      )
      .toArray().length;
    return { row: this.byId(a.messageId) as MailRow, duplicate: inserted === 0 };
  }

  /** A row refused before any turn took it (its secret could not be held, memory unreadable): nothing kept. */
  forget(ordinal: number): void {
    this.sql.exec("DELETE FROM mailbox WHERE ordinal = ? AND state = 'queued' AND turn_id IS NULL", ordinal);
  }

  queued(): MailRow[] {
    return this.sql.exec<Raw>("SELECT * FROM mailbox WHERE state = 'queued' ORDER BY ordinal").toArray().map(row);
  }

  hasQueued(): boolean {
    return this.sql.exec("SELECT ordinal FROM mailbox WHERE state = 'queued' LIMIT 1").toArray().length > 0;
  }

  /** The row started `turnId`; `seq` is the transcript message that carried it. */
  started(ordinal: number, turnId: string, seq: number, at: number): void {
    this.sql.exec("UPDATE mailbox SET state = 'completed', turn_id = ?, delivery = 'start', seq = ?, settled_at = ? WHERE ordinal = ?", turnId, seq, at, ordinal);
  }

  /** The kind of the row that started `turnId`, if a mailbox row did. */
  startedBy(turnId: string): MailKind | undefined {
    return this.sql.exec<{ kind: MailKind }>("SELECT kind FROM mailbox WHERE turn_id = ? AND delivery = 'start'", turnId).toArray()[0]?.kind;
  }

  /** Every row a turn took, by start or by steer, oldest first: what began each turn and what reached it (F12). */
  taken(): MailRow[] {
    return this.sql.exec<Raw>("SELECT * FROM mailbox WHERE delivery IS NOT NULL ORDER BY ordinal").toArray().map(row);
  }

  /**
   * Takes every queued row into the running turn at its step boundary, inside the barrier's
   * transaction: one fenced block appended through `append`, each row `completed`. Null when none waits.
   */
  steer(turnId: string, at: number, append: (m: Message) => number): Message | null {
    const rows = this.queued();
    if (!rows.length) return null;
    const message: Message = { role: "user", content: steerMessage(rows), timestamp: at };
    const seq = append(message);
    for (const r of rows) this.sql.exec("UPDATE mailbox SET state = 'completed', turn_id = ?, delivery = 'steer', seq = ?, settled_at = ? WHERE ordinal = ?", turnId, seq, at, r.ordinal);
    return message;
  }

  /** A Stop: rows still waiting are never taken up by the stopped turn. Returns how many. */
  abortQueued(turnId: string, at: number): number {
    return this.sql.exec<{ ordinal: number }>("UPDATE mailbox SET state = 'aborted', turn_id = ?, settled_at = ? WHERE state = 'queued' RETURNING ordinal", turnId, at).toArray().length;
  }

  /** The person's own rows the page draws as theirs: queued, steered or aborted, never the ones that started a turn (the transcript draws those). */
  drawn(): MailRow[] {
    return this.sql.exec<Raw>("SELECT * FROM mailbox WHERE kind = 'user' AND (delivery IS NULL OR delivery = 'steer') ORDER BY ordinal").toArray().map(row);
  }

  abortedBy(turnId: string): number {
    return this.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM mailbox WHERE state = 'aborted' AND turn_id = ?", turnId).one().n;
  }
}

/**
 * The block a running turn receives at its step boundary: the policy line, then each row fenced with its source. A
 * reaction's row is the harness's own signal with its parts fenced already (F10); a second fence would defang them.
 */
export function steerMessage(rows: MailRow[]): string {
  const parts = rows.map((r) => (r.kind === "user" ? fence(`person:${r.person}`, r.text) : r.kind === "reaction" ? r.text : fence(r.scope, r.text)));
  return [STEER_POLICY, ...parts].join("\n");
}
