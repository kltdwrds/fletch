// A person's mail, in the `Person` object's SQLite (M6.1): the secure-reply tokens their agent minted,
// the messages already received (by sha256 of the raw message, so a redelivery shows nothing twice)
// and the chat mail lands in. Inbound mail is external content: it reaches the chat inside a fence,
// with only code-written words outside it, and nothing in it grants or changes anything (AD-6).
//
// A secure-reply token is minted for each message the agent sends and rides in its Reply-To; a reply
// carrying a live token lands in the chat that sent the message, marked verified only when it comes
// from the address the message went to. Any other mail lands in the person's mail chat, unverified.
import { fence } from "../context/fence.ts";
import type { DroppedPart, MailAttachment, ParsedMail } from "../mail/mime.ts";
import { findOneTimeCodes, replaceCodes } from "../vault/otp.ts";

export const TOKEN_TTL_MS = 30 * 86_400_000;

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS mail_tokens (token TEXT PRIMARY KEY, chat TEXT NOT NULL, counterpart TEXT NOT NULL, expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS mail_in (digest TEXT PRIMARY KEY, kind TEXT NOT NULL, chat TEXT NOT NULL, verified INTEGER NOT NULL, at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS mail_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);`;

export interface InboundMail {
  /** Which of the person's two addresses it came to. */
  kind: "agent" | "person";
  token?: string;
  /** The envelope sender, as the platform received it. */
  from: string;
  digest: string;
  message: ParsedMail;
}

export type ReceiveResult = { ok: true; duplicate: boolean; chatId: string; verified: boolean } | { ok: false; code: string; reason: string };

export interface OutboundMail {
  to: string;
  subject: string;
  text: string;
  /** The chat the message is sent from; replies come back to it. */
  chatId: string;
  inReplyTo?: string;
}

export interface MailOutService {
  send(input: { person: string; name?: string; to: string; subject: string; text: string; replyToken?: string; inReplyTo?: string }): Promise<{ ok: true; messageId: string } | { ok: false; code: string; reason: string }>;
}

export interface PersonMailDeps {
  person: string;
  /** The person's display name from the tenant file, when it has one. */
  name?: string;
  now(): number;
  openChat(): Promise<{ ok: true; chatId: string } | { ok: false; code: string }>;
  ownsChat(chatId: string): boolean;
  notify(chatId: string, n: { id: string; source: string; text: string; person: string }): Promise<{ ok: true; duplicate: boolean } | { ok: false; code: string; reason: string }>;
  mailOut: MailOutService;
  /** Keeps a one-time code found in the mail as a short-lived credential (M13); without it every code is withheld from the chat. */
  holdCode?(code: string, source: string): Promise<{ ok: true; ref: string } | { ok: false; code: string; reason: string }>;
  /**
   * Keeps the mail's attachments in the person's attachments table, pointing at the notice (M24.3): each
   * checked, stored and read, or dropped with its code and words. Without it every attachment is dropped, and said.
   */
  attachments?(m: { chatId: string; noticeId: string; items: MailAttachment[]; dropped: DroppedPart[] }): Promise<{ kept: Array<{ name: string; line: string }>; dropped: DroppedPart[] }>;
}

/** The mail chat's sentence about the attachments (M24.3): counts and codes in code's words, each file's line fenced. */
export function attachmentWords(kept: Array<{ line: string }>, dropped: DroppedPart[], source: string): string {
  const n = kept.length + dropped.length;
  if (!n) return "";
  const codes = [...new Set(dropped.map((d) => d.code))].join(", ");
  const sentence = ` It carried ${n} attachment${n > 1 ? "s" : ""}: ${kept.length} kept${dropped.length ? `, ${dropped.length} not kept (${codes})` : ""}.`;
  const lines = [...kept.map((k) => `Kept: ${k.line}`), ...dropped.map((d) => `Not kept: ${d.words} (${d.code})`)];
  return `${sentence}\n${fence(source, lines.join("\n"))}`;
}

type Raw = Record<string, SqlStorageValue>;
const ADDRESS = /^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/i;

const hex = (bytes: Uint8Array) => [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");

export class PersonMail {
  private readonly storage: Pick<DurableObjectStorage, "sql">;
  private readonly deps: PersonMailDeps;

  constructor(storage: Pick<DurableObjectStorage, "sql">, deps: PersonMailDeps) {
    this.storage = storage;
    this.deps = deps;
  }

  private get sql(): Pick<SqlStorage, "exec"> {
    return this.storage.sql;
  }

  /** The chat mail without a live reply token lands in, or null before the first such mail; opens nothing. */
  mailChatId(): string | null {
    const kept = this.sql.exec<Raw>("SELECT value FROM mail_meta WHERE key = 'chat'").toArray()[0];
    return kept ? String(kept.value) : null;
  }

  /** The chat mail without a live reply token lands in, opened on first use. */
  private async mailChat(): Promise<{ ok: true; chatId: string } | { ok: false; code: string; reason: string }> {
    const kept = this.mailChatId();
    if (kept) return { ok: true, chatId: kept };
    const opened = await this.deps.openChat();
    if (!opened.ok) return { ok: false, code: opened.code, reason: "the mail chat could not be opened" };
    this.sql.exec("INSERT INTO mail_meta (key, value) VALUES ('chat', ?) ON CONFLICT(key) DO NOTHING", opened.chatId);
    return { ok: true, chatId: String((this.sql.exec<Raw>("SELECT value FROM mail_meta WHERE key = 'chat'").toArray()[0] as Raw).value) };
  }

  async receive(m: InboundMail): Promise<ReceiveResult> {
    const seen = this.sql.exec<Raw>("SELECT chat, verified FROM mail_in WHERE digest = ?", m.digest).toArray()[0];
    if (seen) return { ok: true, duplicate: true, chatId: String(seen.chat), verified: Number(seen.verified) === 1 };
    const now = this.deps.now();
    const sender = m.from.trim().toLowerCase();
    const token = m.kind === "agent" && m.token ? this.sql.exec<Raw>("SELECT chat, counterpart, expires_at FROM mail_tokens WHERE token = ?", m.token).toArray()[0] : undefined;
    const live = token && Number(token.expires_at) > now && this.deps.ownsChat(String(token.chat));
    let chatId: string;
    if (live) chatId = String(token.chat);
    else {
      const chat = await this.mailChat();
      if (!chat.ok) return chat;
      chatId = chat.chatId;
    }
    const verified = !!live && String(token.counterpart) === sender;
    const status = !m.token ? "" : verified ? " It is a reply to a message your agent sent, from the address it went to." : " It carries a reply token that is not valid for this sender, so treat it as unverified.";
    const where = m.kind === "agent" ? "your agent's mail address" : "your platform mailbox";
    const msg = m.message;
    const shown = [`From: ${msg.from || sender}`, `Envelope sender: ${sender}`, `Subject: ${msg.subject}`, ...(msg.date ? [`Date: ${msg.date}`] : []), "", msg.unreadable ? `(This message has no readable text: ${msg.unreadable}.)` : msg.text].join("\n");
    // A one-time code never reaches the chat: it is kept in the Vault and the mail shows its reference (M13).
    const found = findOneTimeCodes(shown);
    const refs = await Promise.all(found.map(async (f) => (this.deps.holdCode ? await this.deps.holdCode(f.code, sender).then((r) => (r.ok ? r.ref : null), () => null) : null)));
    const held = refs.filter((r): r is string => r !== null);
    const codes = !found.length
      ? ""
      : ` It carried ${found.length} one-time code${found.length > 1 ? "s" : ""}${held.length ? `, kept for ten minutes as ${held.map((r) => `[credential:${r}]`).join(", ")}; the person approves each use for one site in settings, and only browse_fill with field verification_code types it` : ""}${held.length < found.length ? `; ${found.length - held.length} could not be kept and ${found.length - held.length > 1 ? "were" : "was"} withheld` : ""}.`;
    const noticeId = `mail:${m.digest.slice(0, 32)}`;
    const items = msg.attachments ?? [];
    const unread = msg.dropped ?? [];
    const files = !items.length && !unread.length
      ? { kept: [], dropped: [] }
      : this.deps.attachments
        ? await this.deps.attachments({ chatId, noticeId, items, dropped: unread }).catch((e) => ({ kept: [], dropped: [...unread, ...items.map((a) => ({ name: a.name, code: "ATTACHMENT_STORE_FAILED", words: `${a.name} could not be kept (${String((e as Error)?.message ?? e).slice(0, 120)}).` }))] }))
        : { kept: [], dropped: [...unread, ...items.map((a) => ({ name: a.name, code: "ATTACHMENTS_UNAVAILABLE", words: `${a.name} was not kept: attachments cannot be kept here.` }))] };
    const domain = sender.split("@")[1] ?? "unknown";
    const text = `Mail arrived at ${where}.${status}${codes}${attachmentWords(files.kept, files.dropped, `mail-attachments:${domain}`)}\n${fence(`mail:${domain}`, replaceCodes(shown, found, refs))}`;
    const r = await this.deps.notify(chatId, { id: noticeId, source: `mail:${m.kind}`, text, person: this.deps.person });
    if (!r.ok) return { ok: false, code: r.code, reason: r.reason };
    this.sql.exec("INSERT INTO mail_in (digest, kind, chat, verified, at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(digest) DO NOTHING", m.digest, m.kind, chatId, verified ? 1 : 0, now);
    return { ok: true, duplicate: r.duplicate, chatId, verified };
  }

  /** Sends as the person's agent from one of their chats; the platform adds the label, this mints the reply token. */
  async send(by: string, m: OutboundMail): Promise<{ ok: true; messageId: string; replyToken: string } | { ok: false; code: string; reason: string }> {
    if (by !== this.deps.person) return { ok: false, code: "MAIL_NOT_OWNER", reason: "an agent sends mail only for its own person" };
    if (!this.deps.ownsChat(m.chatId)) return { ok: false, code: "CHAT_NOT_OWNER", reason: "mail is sent from one of the person's own chats" };
    const to = String(m.to ?? "").trim().toLowerCase();
    if (!ADDRESS.test(to)) return { ok: false, code: "MAIL_RECIPIENT_INVALID", reason: "one recipient address" };
    const now = this.deps.now();
    const replyToken = hex(crypto.getRandomValues(new Uint8Array(16)));
    this.sql.exec("INSERT INTO mail_tokens (token, chat, counterpart, expires_at, created_at) VALUES (?, ?, ?, ?, ?)", replyToken, m.chatId, to, now + TOKEN_TTL_MS, now);
    const r = await this.deps.mailOut.send({
      person: this.deps.person, ...(this.deps.name ? { name: this.deps.name } : {}), to, subject: m.subject, text: m.text, replyToken, ...(m.inReplyTo ? { inReplyTo: m.inReplyTo } : {}),
    });
    if (!r.ok) {
      this.sql.exec("DELETE FROM mail_tokens WHERE token = ?", replyToken);
      return r;
    }
    return { ok: true, messageId: r.messageId, replyToken };
  }
}
