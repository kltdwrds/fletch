// What the chat page draws when it opens or reconnects a chat (M15.5): the person's own earlier turns,
// read from the chat's own transcript. The socket's `onConnect` sends none of it, so a page that
// switched to another chat and back showed a blank screen. Only what the person typed, what the agent
// said to them (its text and each `send_to_user` that reached the outbox) and the job notices are
// drawn; tool calls and results, the harness's injected inputs and the standing files are not. The
// decision of who may read it is the connect step's (`connectFrame`), made against the chat's owner.
//
// From M17.1 (QYVR-156) a failed turn is an entry of its own, read from the turn's row with its code
// and reason and drawn in words after the turn's last message, so a re-sync never drops a failure.
//
// From M18.2 (QYVR-163) the agent's reasoning is an entry of its own, `thinking`, read from the
// assistant message's thinking blocks and drawn by the page labelled and apart from the reply, as the
// live `reasoning` frame is. It is never part of an `agent` entry's text: `textOf` reads text blocks
// alone.
//
// From M18.1 (QYVR-151) a person's entry carries the page's id for the send that wrote it, so a page
// that never heard back about a send can tell from a re-sync whether it was stored; the approval and
// link cards a turn showed are entries of their own, so a reload of a turn that ended on a card draws
// the card; and the history says which turn is still running, so the page shows it working and never
// shows a finished turn as pending.
import type { Message } from "@earendil-works/pi-ai";
import type { LinkCard } from "../workspace/surfaces.ts";
import type { CardView } from "./cards.ts";
import { failureText } from "./failure-words.ts";
import type { QuoteWho } from "./message-actions.ts";

export type HistoryEntry =
  /**
   * `mid` is the message's id in this chat (M29.4), which a reaction and a reply's quote name: `m<seq>` for a transcript
   * message, `m<seq>.<k>` for its k-th delivered `send_to_user`, `a<i>` for a tool's words, `q<ordinal>` for a mailbox
   * message. `reaction` is the owner's own; `quote` is what the message replied to, drawn above it.
   */
  | { kind: "you"; text: string; at: number; id?: string; mid: string; reaction?: string; quote?: { mid: string; who: QuoteWho; text: string } }
  | { kind: "agent"; text: string; at: number; mid: string; reaction?: string }
  | { kind: "note" | "thinking"; text: string; at: number }
  | { kind: "failed"; text: string; at: number; turn: string; code: string; reason: string }
  /** A turn the person stopped (M24.2): said stopped, never done, with what it had already done in words. */
  | { kind: "stopped"; text: string; at: number; turn: string; effects: string[] }
  | { kind: "card"; text: string; at: number; card: CardView }
  | { kind: "link"; text: string; at: number; card: LinkCard };

/** What a page is sent on open, reconnect and check: the entries, and the turn still running, if any. */
export interface HistorySnapshot {
  entries: HistoryEntry[];
  running: { turn: string; since: number } | null;
}

/** The marker value of a person's turn sent without a page id (and of every turn before M18.1). */
export const TYPED_WITHOUT_ID = "1";

/** A turn that ended failed, as its row records it. */
export interface FailedTurn {
  turnId: string;
  code: string;
  reason: string;
  at: number;
}

/**
 * An entry the chat places itself (M24.2): the person's messages from the mailbox (queued, steered into
 * a running turn, or aborted by a Stop) and stopped turns. `seq` is the transcript message it sorts
 * after; null sorts it after everything of its time.
 */
export type PlacedEntry = (Extract<HistoryEntry, { kind: "you" }> | Extract<HistoryEntry, { kind: "stopped" }>) & { seq: number | null };

/** The most recent entries sent on a connect; older ones stay in the transcript. */
export const HISTORY_LIMIT = 200;

export interface TranscriptRow {
  seq: number;
  turnId: string;
  message: Message;
}

type Part = { type?: string; text?: unknown; thinking?: unknown; name?: unknown; id?: unknown; arguments?: { text?: unknown } };

const textOf = (content: unknown): string => {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return (content as Part[])
    .filter((p) => p.type === "text" && typeof p.text === "string")
    .map((p) => p.text as string)
    .join("");
};

/**
 * @param typed the turns that began with the person's own message, each with the page's id for its send
 * @param delivered the ids of outbox effects, so a `send_to_user` that never reached the barrier is not shown
 * @param cards the approval and link cards the chat showed, each at the time it was shown
 */
export function visibleHistory(
  rows: TranscriptRow[],
  typed: ReadonlyMap<string, string>,
  delivered: ReadonlySet<string>,
  notices: Array<{ text: string; at: number }>,
  failed: FailedTurn[] = [],
  cards: Array<Extract<HistoryEntry, { kind: "card" | "link" }>> = [],
  announced: Array<{ callId: string; turnId: string; text: string }> = [],
  placed: PlacedEntry[] = [],
): HistoryEntry[] {
  const entries: Array<HistoryEntry & { order: number }> = [];
  const lastSeq = new Map<string, number>();
  for (const { seq, turnId, message } of rows) {
    lastSeq.set(turnId, seq);
    const at = typeof (message as { timestamp?: unknown }).timestamp === "number" ? (message as { timestamp: number }).timestamp : 0;
    if (message.role === "user") {
      const text = textOf(message.content);
      const id = typed.get(turnId);
      if (id !== undefined && text) entries.push({ kind: "you", text, at, ...(id !== TYPED_WITHOUT_ID ? { id } : {}), mid: `m${seq}`, order: seq });
    } else if (message.role === "assistant") {
      const parts = message.content as unknown as Part[];
      // Reasoning first: it came before the words it led to, and the sort keeps equal keys in order.
      for (const p of Array.isArray(parts) ? parts : []) {
        if (p.type === "thinking" && typeof p.thinking === "string" && p.thinking.trim()) entries.push({ kind: "thinking", text: p.thinking, at, order: seq });
      }
      const said = textOf(parts);
      if (said) entries.push({ kind: "agent", text: said, at, mid: `m${seq}`, order: seq });
      let k = 0;
      for (const p of Array.isArray(parts) ? parts : []) {
        if (p.type === "toolCall" && p.name === "send_to_user" && typeof p.id === "string" && delivered.has(p.id) && typeof p.arguments?.text === "string") {
          entries.push({ kind: "agent", text: p.arguments.text, at, mid: `m${seq}.${++k}`, order: seq });
        }
      }
    }
  }
  // Words a tool wrote in code for the person (M19.2, M21.1) were delivered beside the tool call that
  // produced them, so they are drawn once, right after the message holding that call.
  for (const [i, a] of announced.entries()) {
    const at = rows.find((r) => r.turnId === a.turnId && r.message.role === "assistant" && Array.isArray(r.message.content) && (r.message.content as unknown as Part[]).some((p) => p.type === "toolCall" && p.id === a.callId));
    const seq = at?.seq ?? lastSeq.get(a.turnId) ?? Number.MAX_SAFE_INTEGER - 3;
    const stamp = at ? (at.message as { timestamp?: unknown }).timestamp : undefined;
    const when = typeof stamp === "number" ? stamp : 0;
    entries.push({ kind: "agent", text: a.text, at: when, mid: `a${i}`, order: seq + 0.25 });
  }
  // Notices carry their own clock; they sort among the messages by it, after a message at the same time.
  for (const n of notices) entries.push({ kind: "note", text: n.text, at: n.at, order: Number.MAX_SAFE_INTEGER });
  // A failure sorts by when the turn ended, after its own last message at the same time.
  for (const f of failed) {
    entries.push({ kind: "failed", text: failureText(f.code), at: f.at, turn: f.turnId, code: f.code, reason: f.reason, order: (lastSeq.get(f.turnId) ?? Number.MAX_SAFE_INTEGER - 1) + 0.5 });
  }
  // A mailbox message sorts at the block that carried it; a stopped turn after its own last message (M24.2).
  for (const { seq, ...p } of placed) {
    const order = p.kind === "stopped" ? (lastSeq.get(p.turn) ?? Number.MAX_SAFE_INTEGER - 1) + 0.5 : (seq ?? Number.MAX_SAFE_INTEGER - 2) - 0.5;
    entries.push({ ...p, order });
  }
  // A card sorts by when it was shown, after a message at the same time and before a notice.
  for (const c of cards) entries.push({ ...c, order: Number.MAX_SAFE_INTEGER - 2 });
  entries.sort((a, b) => a.at - b.at || a.order - b.order);
  return entries.slice(-HISTORY_LIMIT).map(({ order: _order, ...e }) => e as HistoryEntry);
}
