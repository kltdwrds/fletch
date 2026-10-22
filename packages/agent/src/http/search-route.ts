// `/app/search` (M23.5, F2): one answer for the dialog and the drawer. The person's `Person` says which chats are
// theirs; with a query each live chat searches its own thread for its owner, all in parallel as `/app/chats` reads
// their times, and the answer is one row per chat: the newest message that matched as its line, with how many
// others did, or the title alone, or a memory line learned there. A chat that could not be searched is named with
// its code beside the rows that were found, as the memory half is (D-0001): a read that failed is never answered as
// nothing found. With no query the recents are the live chats where the person last was.
import type { ChatSearch } from "../chat/search.ts";
import { SEARCH_QUERY_MAX } from "../chat/search.ts";
import type { ChatEntry } from "../person/chats.ts";
import { SEARCH_TEXT } from "./app/permission-words.ts";

type Refusal = { ok: false; code: string; reason?: string };

/** The reads the route makes, as `AppDirectory` carries them. */
export interface SearchReads {
  chats(person: string, call: { op: "view" }): Promise<{ ok: true; chats?: ChatEntry[] } | Refusal>;
  /** One of the person's chats searched by that `Chat`, which answers its owner alone. */
  chatSearch(person: string, chatId: string, query: string): Promise<ChatSearch>;
  memorySearch(person: string, input: { queries: string[]; maxResults?: number }): Promise<{ ok: true; hits: Array<{ citation: string; text: string }>; more: number } | Refusal>;
  memoryLineSource(person: string, input: { citation: string }): Promise<{ ok: true; source: string | null } | Refusal>;
}

/** The most rows a query answers, newest first. */
export const SEARCH_ROWS = 20;
/** The most recents an empty query answers. */
export const SEARCH_RECENTS = 8;

export interface SearchRow {
  chatId: string;
  title: string;
  main: boolean;
  at: number;
  /** The newest matched message's line, its id and the match's offsets in the line; absent on a title match. */
  line?: string;
  mid?: string;
  match?: { start: number; end: number };
  /** How many other messages in the chat matched. */
  more: number;
}

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });
const failed = (r: unknown) => (r as { ok?: boolean } | null)?.ok === false;
async function part<T>(read: () => Promise<T>): Promise<T | Refusal> {
  try {
    return await read();
  } catch (e) {
    return { ok: false, code: "APP_READ_FAILED", reason: String(e).slice(0, 200) };
  }
}

export async function searchRoute(url: URL, person: string, dir: SearchReads): Promise<Response> {
  const q = (url.searchParams.get("q") ?? "").trim().slice(0, SEARCH_QUERY_MAX);
  const listed = await part(() => dir.chats(person, { op: "view" }));
  if (failed(listed) || !("chats" in listed)) return json({ ok: false, code: (listed as Refusal).code ?? "APP_READ_FAILED" }, 500);
  const live = (listed.chats ?? []).filter((c) => !c.archived);
  const base = (c: ChatEntry, at: number) => ({ chatId: c.id, title: c.title, main: c.kind === "main", at });
  if (!q) {
    // Recent is where the person was: the last connection, or the opening of a chat never connected to.
    const where = (c: ChatEntry) => c.connectedAt ?? c.openedAt;
    return json({ ok: true, q, recents: [...live].sort((a, b) => where(b) - where(a)).slice(0, SEARCH_RECENTS).map((c) => base(c, where(c))) });
  }

  const [searched, memoryRead] = await Promise.all([Promise.all(live.map((c) => part(() => dir.chatSearch(person, c.id, q)))), part(() => dir.memorySearch(person, { queries: [q], maxResults: 8 }))]);
  const needle = q.toLowerCase();
  const rows = new Map<string, SearchRow>();
  const unsearched: Array<{ chatId: string; title: string; code: string }> = [];
  const timeOf = new Map<string, number>();
  live.forEach((c, i) => {
    const r = searched[i] as ChatSearch | Refusal;
    if (failed(r) || !r.ok) unsearched.push({ chatId: c.id, title: c.title, code: (r as Refusal).code ?? "APP_READ_FAILED" });
    const found = r.ok ? r : null;
    timeOf.set(c.id, found?.lastAt ?? c.openedAt);
    const newest = found?.hits[0];
    if (newest) rows.set(c.id, { ...base(c, newest.at), line: newest.line, mid: newest.mid, match: newest.match, more: (found?.hits.length ?? 1) - 1 });
    else if (c.title.toLowerCase().includes(needle)) rows.set(c.id, { ...base(c, timeOf.get(c.id) as number), more: 0 });
  });

  // The memory half as it stands (M23.5): a memory line opens the chat it was learned in, when that chat is the person's own.
  let memory: { ok: boolean; code?: string; unplaced?: number };
  if (failed(memoryRead)) memory = { ok: false, code: (memoryRead as Refusal).code };
  else {
    let unplaced = 0;
    const hits = (memoryRead as { hits: Array<{ citation: string; text: string }> }).hits;
    const sources = await Promise.all(hits.map((h) => part(() => dir.memoryLineSource(person, { citation: h.citation }))));
    hits.forEach((h, i) => {
      const s = sources[i];
      const chatId = s && !failed(s) ? /^chat:(.+)$/.exec((s as { source: string | null }).source ?? "")?.[1] : undefined;
      const chat = chatId ? live.find((c) => c.id === chatId) : undefined;
      if (!chat) unplaced++;
      else if (!rows.has(chat.id)) rows.set(chat.id, { ...base(chat, timeOf.get(chat.id) ?? chat.openedAt), line: h.text.slice(0, 120), more: 0 });
    });
    memory = { ok: true, unplaced };
  }
  const results = [...rows.values()].sort((a, b) => b.at - a.at).slice(0, SEARCH_ROWS);
  return json({ ok: true, q, results, unsearched, memory, words: SEARCH_TEXT.none });
}
