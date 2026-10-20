// The engine's steering helpers (M24.2, moved beside `engine.ts` to keep it under the file cap): what the
// history draws from the mailbox and the stopped turns, the turn ends the Ledger counts, and `db_query`
// routed to the object that owns each view.
import type { LedgerSink, TurnEndRow } from "../ledger/types.ts";
import { queryChatView } from "../views/chat-views.ts";
import type { ViewResult } from "../views/select.ts";
import { VIEW_OWNER } from "../views/tool.ts";
import type { PlacedEntry } from "./history.ts";
import { clientIdOf, type Mailbox } from "./mailbox.ts";
import { effectWords, STOP_CODE, stopNote, stoppedText } from "./stop.ts";
import type { ChatStore } from "./store.ts";
import type { Effect } from "./tools.ts";

/**
 * Ends a turn stopped, inside the caller's transaction: the note the agent reads next (what `dropped`
 * proposed did not run), the queued rows aborted, the turn's row `stopped`.
 */
export function endStopped(store: ChatStore, mailbox: Mailbox, turnId: string, dropped: Effect[], at: number): void {
  store.appendMessage(`stop:${turnId}`, { role: "user", content: stopNote(dropped), timestamp: at });
  mailbox.abortQueued(turnId, at);
  store.endTurn(turnId, "stopped", STOP_CODE, at);
}

/** A stopped turn's words: stopped, never done, with what it had committed already. */
export function stoppedEntry(store: ChatStore, mailbox: Mailbox, turnId: string): { text: string; effects: string[] } {
  const effects = store.committed(turnId).map((r) => effectWords(JSON.parse(r.payload) as Effect));
  return { text: stoppedText(mailbox.abortedBy(turnId), effects), effects };
}

/** The person's mailbox messages the transcript does not draw, and the stopped turns. */
export function placedEntries(store: ChatStore, mailbox: Mailbox): PlacedEntry[] {
  const mail = mailbox.drawn().map((r): PlacedEntry => ({ kind: "you", text: r.text, at: r.acceptedAt, ...((id) => (id ? { id } : {}))(clientIdOf(r)), mid: `q${r.ordinal}`, seq: r.seq }));
  const stopped = store.turns().filter((t) => t.status === "stopped").map((t): PlacedEntry => ({ kind: "stopped", ...stoppedEntry(store, mailbox, t.id), at: t.ended_at ?? t.started_at, turn: t.id, seq: null }));
  return [...mail, ...stopped];
}

/**
 * A turn's end the dashboard counts: a stop, or the step cap. A row the Ledger could not take is owed
 * and sent again at the next turn end, so the count is late rather than short.
 */
export async function recordTurnEnd(store: ChatStore, sink: LedgerSink, row: TurnEndRow): Promise<void> {
  if (!sink.turnEnded) return;
  const owed = [...(JSON.parse(store.meta("ledgerOwed") || "[]") as TurnEndRow[]), row];
  const left: TurnEndRow[] = [];
  for (const r of owed) await sink.turnEnded(r).catch(() => left.push(r));
  store.transaction(() => store.setMeta("ledgerOwed", JSON.stringify(left)));
}

/** `db_query`: each view answered by the object that owns its rows, for the chat's owner alone. */
export async function queryOwnedView(d: { owner: string | null; sql: SqlStorage; ledger: () => LedgerSink }, person: string, input: { view: string; sql: string }): Promise<ViewResult> {
  const owned = VIEW_OWNER[input.view];
  if (!owned) return { ok: false, code: "DB_QUERY_UNKNOWN_VIEW", reason: `there is no view named ${JSON.stringify(input.view)}` };
  if (d.owner !== person) return { ok: false, code: "DB_QUERY_UNKNOWN_VIEW", reason: "this chat's views answer its owner alone" };
  const call = { ...input, version: owned.version };
  if (owned.owner === "chat") return queryChatView(d.sql, call);
  return (d.ledger() as LedgerSink & { queryView(p: string, i: typeof call): Promise<ViewResult> }).queryView(person, call);
}
