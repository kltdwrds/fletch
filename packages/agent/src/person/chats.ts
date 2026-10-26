// A person's chats, in the `Person` object's SQLite: the owning store of which chats are whose. A
// chat is opened here and claimed for this person in the `Chat` object before its id is handed out,
// so every chat id a person can name is one their `Person` recorded.
//
// From M14.2 (muse spec section 14.1): one main chat per person, opened at enrolment or first visit,
// which archive and delete refuse; side chats the person opens, with a title and archive state; and
// request and mail chats, marked by kind, which carry a colleague's request or the person's mail and
// are never where a proactive item lands. An item addressed to an archived or absent chat, and a
// proactive item addressed to a request or mail chat, lands in the main chat.
import type { ClaimResult } from "../chat/engine.ts";

export const SCHEMA = "CREATE TABLE IF NOT EXISTS chats (id TEXT PRIMARY KEY, opened_at INTEGER NOT NULL);";
export const COLUMNS: Array<[string, string]> = [["kind", "TEXT NOT NULL DEFAULT 'side'"], ["title", "TEXT NOT NULL DEFAULT ''"], ["archived_at", "INTEGER"], ["connected_at", "INTEGER"]];

export type ChatKind = "main" | "side" | "request" | "mail";
export type OpenResult = { ok: true; chatId: string } | { ok: false; code: string };
export type ChatChange = { ok: true } | { ok: false; code: "CHAT_MAIN_REFUSED" | "CHAT_NOT_FOUND" | "CHAT_TITLE_INVALID" };

export interface ChatEntry {
  id: string;
  kind: ChatKind;
  title: string;
  openedAt: number;
  /** When a page last connected to it (M17.1); null when none has. Search's recents follow it (F2). */
  connectedAt: number | null;
  archived: boolean;
}

const TITLE_MAX = 80;
const DEFAULT_TITLE: Record<ChatKind, string> = { main: "Main chat", side: "New chat", request: "Requests from colleagues", mail: "Mail" };

export class PersonChats {
  private readonly storage: Pick<DurableObjectStorage, "sql">;
  private readonly person: string;
  private readonly claimChat: (chatId: string, person: string) => Promise<ClaimResult>;
  /** Tells the `Chat` it was reopened, so its conversation epoch advances (M24.2). */
  private readonly reopenChat: (chatId: string, person: string) => Promise<unknown>;

  constructor(storage: Pick<DurableObjectStorage, "sql">, person: string, claimChat: (chatId: string, person: string) => Promise<ClaimResult>, reopenChat: (chatId: string, person: string) => Promise<unknown> = async () => {}) {
    this.storage = storage;
    this.person = person;
    this.claimChat = claimChat;
    this.reopenChat = reopenChat;
  }

  /** An archived chat brought back: the `Chat` starts a new conversation epoch. */
  async reopened(chatId: string): Promise<void> {
    await this.reopenChat(chatId, this.person);
  }

  private get sql(): SqlStorage {
    return this.storage.sql;
  }

  /** Opens a chat of `kind`; the main chat only through `main`, so there is one. */
  async open(now: number, kind: Exclude<ChatKind, "main"> = "side", title?: string): Promise<OpenResult> {
    return this.create(now, kind, title);
  }

  private async create(now: number, kind: ChatKind, title?: string): Promise<OpenResult> {
    const t = (title ?? DEFAULT_TITLE[kind]).trim().slice(0, TITLE_MAX) || DEFAULT_TITLE[kind];
    const chatId = crypto.randomUUID();
    const claimed = await this.claimChat(chatId, this.person);
    if (!claimed.ok) return { ok: false, code: claimed.code };
    this.sql.exec("INSERT INTO chats (id, opened_at, kind, title) VALUES (?, ?, ?, ?)", chatId, now, kind, t);
    return { ok: true, chatId };
  }

  /** The person's main chat, opened on first need: at enrolment or the first visit. */
  async main(now: number): Promise<OpenResult> {
    const id = this.sql.exec<{ id: string }>("SELECT id FROM chats WHERE kind = 'main' ORDER BY opened_at LIMIT 1").toArray()[0]?.id;
    return id ? { ok: true, chatId: id } : this.create(now, "main");
  }

  owns(chatId: string): boolean {
    return this.sql.exec("SELECT id FROM chats WHERE id = ?", chatId).toArray().length === 1;
  }

  /**
   * A page connected to one of the person's chats (M17.1, QYVR-151): recorded here, so a fresh open of
   * the app returns to the chat the person last had open, as a reload does. False for a chat not theirs.
   */
  connected(chatId: string, now: number): boolean {
    if (!this.owns(chatId)) return false;
    this.sql.exec("UPDATE chats SET connected_at = ? WHERE id = ?", now, chatId);
    return true;
  }

  /** The chat a fresh open draws: the live main or side chat last connected to; the main chat otherwise. */
  async last(now: number): Promise<OpenResult> {
    const id = this.sql
      .exec<{ id: string }>("SELECT id FROM chats WHERE connected_at IS NOT NULL AND archived_at IS NULL AND kind IN ('main', 'side') ORDER BY connected_at DESC, rowid DESC LIMIT 1")
      .toArray()[0]?.id;
    return id ? { ok: true, chatId: id } : this.main(now);
  }

  /** The main chat first, then in the order opened; insertion order breaks a tie on the clock. */
  list(): string[] {
    return this.sql.exec<{ id: string }>("SELECT id FROM chats ORDER BY kind = 'main' DESC, opened_at, rowid").toArray().map((r) => r.id);
  }

  entries(): ChatEntry[] {
    return this.sql
      .exec<{ id: string; kind: string; title: string; opened_at: number; connected_at: number | null; archived_at: number | null }>("SELECT id, kind, title, opened_at, connected_at, archived_at FROM chats ORDER BY kind = 'main' DESC, opened_at, rowid")
      .toArray()
      .map((r) => ({ id: r.id, kind: r.kind as ChatKind, title: r.title, openedAt: r.opened_at, connectedAt: r.connected_at, archived: r.archived_at !== null }));
  }

  private entry(chatId: string): ChatEntry | undefined {
    return this.entries().find((e) => e.id === chatId);
  }

  archive(chatId: string, now: number, archived = true): ChatChange {
    const e = this.entry(chatId);
    if (!e) return { ok: false, code: "CHAT_NOT_FOUND" };
    if (e.kind === "main") return { ok: false, code: "CHAT_MAIN_REFUSED" };
    this.sql.exec("UPDATE chats SET archived_at = ? WHERE id = ?", archived ? now : null, chatId);
    return { ok: true };
  }

  /** Forgets the chat here, so no route reaches it again; the main chat is never deleted. */
  remove(chatId: string): ChatChange {
    const e = this.entry(chatId);
    if (!e) return { ok: false, code: "CHAT_NOT_FOUND" };
    if (e.kind === "main") return { ok: false, code: "CHAT_MAIN_REFUSED" };
    this.sql.exec("DELETE FROM chats WHERE id = ?", chatId);
    return { ok: true };
  }

  rename(chatId: string, title: unknown): ChatChange {
    if (!this.entry(chatId)) return { ok: false, code: "CHAT_NOT_FOUND" };
    if (typeof title !== "string" || !title.trim() || title.length > TITLE_MAX) return { ok: false, code: "CHAT_TITLE_INVALID" };
    this.sql.exec("UPDATE chats SET title = ? WHERE id = ?", title.trim(), chatId);
    return { ok: true };
  }

  /**
   * Where an item lands: the chat it names while that chat is live and may take it (a proactive item
   * only in the main chat or a side chat), and otherwise the main chat.
   */
  async target(chatId: string | null, item: "requested" | "proactive", now: number): Promise<OpenResult> {
    const e = chatId ? this.entry(chatId) : undefined;
    if (e && !e.archived && (item === "requested" || e.kind === "main" || e.kind === "side")) return { ok: true, chatId: e.id };
    return this.main(now);
  }
}

/** The app's chat list calls (M14.2), for the person alone; the `Person` serves them through one method. */
export type ChatsCall =
  | { op: "view" }
  /** The person's chats as they stand, opening none (F12: a read that lists, beside the page's own boot). */
  | { op: "list" }
  | { op: "main" }
  | { op: "open"; title?: unknown }
  | { op: "archive"; id: string; archived?: boolean }
  | { op: "delete"; id: string }
  | { op: "rename"; id: string; title: unknown };

export async function runChatsCall(chats: PersonChats, person: string, requester: string, call: ChatsCall, now: number) {
  if (requester !== person) return { ok: false as const, code: "CHATS_NOT_OWNER" };
  switch (call?.op) {
    case "view": {
      const main = await chats.main(now);
      if (!main.ok) return main;
      const last = await chats.last(now);
      return { ok: true as const, main: main.chatId, last: last.ok ? last.chatId : main.chatId, chats: chats.entries() };
    }
    case "list":
      return { ok: true as const, chats: chats.entries() };
    case "main":
      return chats.main(now);
    case "open":
      return chats.open(now, "side", typeof call.title === "string" ? call.title : undefined);
    case "archive": {
      const changed = chats.archive(call.id, now, call.archived !== false);
      if (changed.ok && call.archived === false) await chats.reopened(call.id);
      return changed;
    }
    case "delete":
      return chats.remove(call.id);
    case "rename":
      return chats.rename(call.id, call.title);
    default:
      return { ok: false as const, code: "CHATS_CALL_INVALID" };
  }
}
