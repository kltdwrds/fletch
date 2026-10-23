// Message-content search (F2): one chat searched for its owner alone. What is searched is what the thread draws,
// the person's own messages and the agent's words (`you` and `agent`, as `history()` returns them), so a hit
// opens to a line on screen: a thinking block, a tool result, an injected input, a notice or a compacted message
// is never drawn and never found. Matching is a plain case-insensitive substring of the drawn text, derived at
// query time with no stored index (Q4).
import type { HistorySnapshot } from "./history.ts";

/** The longest query a search takes; `/app/search` cuts to it, a `Chat` refuses longer. */
export const SEARCH_QUERY_MAX = 80;
/** The longest line a hit carries, ellipses included. */
export const SEARCH_LINE_MAX = 120;

/** One message that matched: its id in the thread, its time, a line around the first match and the match's offsets in that line. */
export interface MessageHit {
  mid: string;
  at: number;
  line: string;
  match: { start: number; end: number };
}

/** `lastAt` is the chat's own time (M29.3), which a row matched by its title alone carries. */
export type ChatSearch = { ok: true; hits: MessageHit[]; lastAt: number | null } | { ok: false; code: "CHAT_NOT_OWNER" | "CHAT_SEARCH_QUERY_INVALID"; reason?: string };

/** The engine as a search reads it: who owns the chat, what it draws, and when it last had something to show. */
export interface SearchableChat {
  owner(): string | null;
  history(): HistorySnapshot;
  lastAt(person: string): { ok: true; at: number | null } | { ok: false; code: string };
}

const flat = (s: string) => s.replace(/\s+/g, " ").trim();
const escaped = (s: string) => s.replace(/[\\^$.*+?()[\]{}|/]/g, "\\$&");
const low = (c: number) => c >= 0xdc00 && c <= 0xdfff;
const high = (c: number) => c >= 0xd800 && c <= 0xdbff;

/** At most `SEARCH_LINE_MAX` characters of `text` around `[start, end)`, an ellipsis where it was cut, with the match's offsets in the line. */
export function lineAround(text: string, start: number, end: number): { line: string; match: { start: number; end: number } } {
  if (text.length <= SEARCH_LINE_MAX) return { line: text, match: { start, end } };
  const room = SEARCH_LINE_MAX - 2;
  let from = Math.max(0, start - Math.floor((room - (end - start)) / 2));
  let to = Math.min(text.length, from + room);
  from = Math.max(0, to - room);
  // Never half of a surrogate pair at either cut.
  if (from > 0 && low(text.charCodeAt(from))) from++;
  if (to < text.length && high(text.charCodeAt(to - 1))) to--;
  const lead = from > 0 ? "…" : "";
  const line = `${lead}${text.slice(from, to)}${to < text.length ? "…" : ""}`;
  const at = Math.max(start, from);
  return { line, match: { start: at - from + lead.length, end: Math.min(end, to) - from + lead.length } };
}

/** The drawn messages that contain `query`, newest first; a tie on the clock goes to the later message. */
export function searchEntries(entries: HistorySnapshot["entries"], query: string): MessageHit[] {
  const needle = new RegExp(escaped(flat(query)), "iu");
  const hits: Array<MessageHit & { order: number }> = [];
  entries.forEach((e, order) => {
    if (e.kind !== "you" && e.kind !== "agent") return;
    const text = flat(e.text);
    const m = needle.exec(text);
    if (m) hits.push({ mid: e.mid, at: e.at, ...lineAround(text, m.index, m.index + m[0].length), order });
  });
  return hits.sort((a, b) => b.at - a.at || b.order - a.order).map(({ order: _order, ...h }) => h);
}

/** A `Chat`'s answer to `search`: its owner alone, any other person refused with `CHAT_NOT_OWNER`. */
export function searchChat(chat: SearchableChat, person: string, query: unknown): ChatSearch {
  if (chat.owner() !== person) return { ok: false, code: "CHAT_NOT_OWNER", reason: "a chat is searched for its owner alone" };
  const q = typeof query === "string" ? flat(query) : "";
  if (!q || q.length > SEARCH_QUERY_MAX) return { ok: false, code: "CHAT_SEARCH_QUERY_INVALID", reason: `a query of 1 to ${SEARCH_QUERY_MAX} characters` };
  const last = chat.lastAt(person);
  return { ok: true, hits: searchEntries(chat.history().entries, q), lastAt: last.ok ? last.at : null };
}
