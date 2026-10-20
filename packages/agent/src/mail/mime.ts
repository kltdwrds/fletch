// A small reader for inbound mail (M6.1): the headers a chat shows (From, Subject, Message-ID, Date)
// and the first text part, decoded. Everything it returns is external content and is fenced wherever
// it is shown; it reads, it never interprets. Unknown shapes come back with a reason, never as empty.

export interface ParsedMail {
  from: string;
  subject: string;
  messageId: string | null;
  date: string | null;
  text: string;
  /** Set when no text part could be read; the chat says so instead of showing nothing. */
  unreadable?: string;
  /** The files the mail carried, decoded (M24.3); the person's `Person` checks and keeps each one. */
  attachments?: MailAttachment[];
  /** Files the reader could not take out of the mail, each with a code and the words the chat says. */
  dropped?: DroppedPart[];
}

export interface MailAttachment {
  name: string;
  /** The type the mail declared; the person's store decides the stored type from the name. */
  mime: string;
  bytes: Uint8Array;
}

export interface DroppedPart {
  name: string;
  code: string;
  words: string;
}

/** How many multipart levels the reader walks for attachments; anything deeper is said, never silently skipped. */
export const MAX_PART_DEPTH = 4;

export const MAX_TEXT_CHARS = 20_000;

function splitHead(raw: string): { head: string; body: string } {
  const m = /\r?\n\r?\n/.exec(raw);
  return m ? { head: raw.slice(0, m.index), body: raw.slice(m.index + m[0].length) } : { head: raw, body: "" };
}

/** Header fields, unfolded, names lower-cased; the first occurrence of each wins. */
export function headers(head: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of head.replace(/\r?\n[ \t]+/g, " ").split(/\r?\n/)) {
    const at = line.indexOf(":");
    if (at <= 0) continue;
    const name = line.slice(0, at).trim().toLowerCase();
    if (!out.has(name)) out.set(name, line.slice(at + 1).trim());
  }
  return out;
}

function decoder(charset: string | undefined): TextDecoder {
  try {
    return new TextDecoder((charset ?? "utf-8").toLowerCase());
  } catch {
    return new TextDecoder("utf-8");
  }
}

function fromBase64(text: string): Uint8Array {
  try {
    return Uint8Array.from(atob(text.replace(/[^A-Za-z0-9+/=]/g, "")), (c) => c.charCodeAt(0));
  } catch {
    return new Uint8Array(0);
  }
}

function fromQuotedPrintable(text: string, underscoreSpace = false): Uint8Array {
  const src = (underscoreSpace ? text.replace(/_/g, " ") : text).replace(/=\r?\n/g, "");
  const bytes: number[] = [];
  for (let i = 0; i < src.length; i++) {
    const c = src[i] as string;
    if (c === "=" && /^[0-9A-Fa-f]{2}$/.test(src.slice(i + 1, i + 3))) {
      bytes.push(Number.parseInt(src.slice(i + 1, i + 3), 16));
      i += 2;
    } else for (const b of new TextEncoder().encode(c)) bytes.push(b);
  }
  return new Uint8Array(bytes);
}

/** RFC 2047 encoded words in a header value (`=?utf-8?B?...?=`, `=?utf-8?Q?...?=`). */
export function decodeWords(value: string): string {
  return value.replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=(\s+(?==\?))?/g, (_m, charset: string, enc: string, data: string) =>
    decoder(charset).decode(enc.toUpperCase() === "B" ? fromBase64(data) : fromQuotedPrintable(data, true)),
  );
}

function param(value: string | undefined, name: string): string | undefined {
  const m = new RegExp(`;\\s*${name}\\s*=\\s*("([^"]*)"|[^;\\s]+)`, "i").exec(value ?? "");
  return m ? (m[2] ?? m[1]) : undefined;
}

function decodeBody(body: string, h: Map<string, string>): string {
  const cte = (h.get("content-transfer-encoding") ?? "").toLowerCase();
  const charset = param(h.get("content-type"), "charset");
  if (cte === "base64") return decoder(charset).decode(fromBase64(body));
  if (cte === "quoted-printable") return decoder(charset).decode(fromQuotedPrintable(body));
  return body;
}

const stripHtml = (html: string) => html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, "").replace(/<br\s*\/?>|<\/p>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");

/** The first text/plain part (or text/html, tags dropped) at most two multipart levels down. */
function textOf(head: Map<string, string>, body: string, depth: number): { text: string; html: boolean } | null {
  const type = (head.get("content-type") ?? "text/plain").toLowerCase();
  if (type.startsWith("multipart/")) {
    const boundary = param(head.get("content-type"), "boundary");
    if (!boundary || depth > 2) return null;
    const parts = body.split(`--${boundary}`).slice(1).filter((p) => !p.startsWith("--"));
    let html: { text: string; html: boolean } | null = null;
    for (const part of parts) {
      const { head: ph, body: pb } = splitHead(part.replace(/^\r?\n/, ""));
      const got = textOf(headers(ph), pb, depth + 1);
      if (got && !got.html) return got;
      html ??= got;
    }
    return html;
  }
  if (type.startsWith("text/plain")) return { text: decodeBody(body, head), html: false };
  if (type.startsWith("text/html")) return { text: stripHtml(decodeBody(body, head)), html: true };
  return null;
}

/** RFC 2231 `filename*=utf-8''name` (the first segment of a continued one), else the plain parameter. */
function fileParam(value: string | undefined, name: string): string | undefined {
  const ext = new RegExp(`;\\s*${name}\\*(?:0\\*?)?\\s*=\\s*([^;]+)`, "i").exec(value ?? "")?.[1]?.trim();
  if (ext) {
    const m = /^([^']*)'[^']*'(.*)$/.exec(ext.replace(/^"|"$/g, ""));
    try {
      return m ? decodeURIComponent(m[2] as string) : ext.replace(/^"|"$/g, "");
    } catch {
      return m?.[2];
    }
  }
  const plain = param(value, name);
  return plain === undefined ? undefined : decodeWords(plain);
}

/** One leaf part's bytes, or why they could not be taken out. */
function partBytes(body: string, h: Map<string, string>): { ok: true; bytes: Uint8Array } | { ok: false; code: string } {
  const cte = (h.get("content-transfer-encoding") ?? "7bit").trim().toLowerCase();
  if (cte === "base64") {
    const clean = body.replace(/\s+/g, "");
    if (/[^A-Za-z0-9+/=]/.test(clean)) return { ok: false, code: "MAIL_ATTACHMENT_UNPARSEABLE" };
    if (clean.length % 4 !== 0) return { ok: false, code: "MAIL_ATTACHMENT_TRUNCATED" };
    const bytes = fromBase64(clean);
    return clean.length && !bytes.byteLength ? { ok: false, code: "MAIL_ATTACHMENT_UNPARSEABLE" } : { ok: true, bytes };
  }
  if (cte === "quoted-printable") return { ok: true, bytes: fromQuotedPrintable(body.replace(/\r?\n$/, "")) };
  if (cte === "7bit" || cte === "8bit" || cte === "binary") return { ok: true, bytes: new TextEncoder().encode(body.replace(/\r?\n$/, "")) };
  return { ok: false, code: "MAIL_ATTACHMENT_UNPARSEABLE" };
}

const DROPPED_WORDS: Record<string, (name: string) => string> = {
  MAIL_ATTACHMENT_TRUNCATED: (n) => `${n} arrived cut off, so it was not kept.`,
  MAIL_ATTACHMENT_UNPARSEABLE: (n) => `${n} could not be read out of the mail, so it was not kept.`,
  MAIL_ATTACHMENT_TOO_DEEP: () => `Parts nested more than ${MAX_PART_DEPTH} levels deep were not read, so any file in them was not kept.`,
};
const drop = (name: string, code: string): DroppedPart => ({ name, code, words: (DROPPED_WORDS[code] ?? DROPPED_WORDS.MAIL_ATTACHMENT_UNPARSEABLE)(name) });

/** Every attachment in the mail, at any depth up to the limit; a part cut off or unreadable is dropped with its code. */
function attachmentsOf(head: Map<string, string>, body: string, depth: number, cut: boolean, out: { attachments: MailAttachment[]; dropped: DroppedPart[] }): void {
  const ct = head.get("content-type") ?? "text/plain";
  const type = ct.toLowerCase();
  if (type.startsWith("multipart/")) {
    const boundary = param(ct, "boundary");
    if (depth >= MAX_PART_DEPTH) return void out.dropped.push(drop("(nested parts)", "MAIL_ATTACHMENT_TOO_DEEP"));
    if (!boundary) return void out.dropped.push(drop("(a multipart section)", "MAIL_ATTACHMENT_UNPARSEABLE"));
    // A section without its closing delimiter was cut off: its last part is not whole.
    const closed = body.includes(`--${boundary}--`);
    const pieces = body.split(`--${boundary}`).slice(1);
    pieces.forEach((piece, i) => {
      if (piece.startsWith("--")) return;
      const { head: ph, body: pb } = splitHead(piece.replace(/^\r?\n/, ""));
      attachmentsOf(headers(ph), pb, depth + 1, cut || (!closed && i === pieces.length - 1), out);
    });
    return;
  }
  const disposition = head.get("content-disposition");
  const filename = fileParam(disposition, "filename") ?? fileParam(ct, "name");
  const isFile = /^\s*attachment/i.test(disposition ?? "") || !!filename || !(type.startsWith("text/plain") || type.startsWith("text/html"));
  if (!isFile) return;
  const name = filename?.trim() || `attachment-${out.attachments.length + out.dropped.length + 1}`;
  if (cut) return void out.dropped.push(drop(name, "MAIL_ATTACHMENT_TRUNCATED"));
  const got = partBytes(body, head);
  if (!got.ok) return void out.dropped.push(drop(name, got.code));
  out.attachments.push({ name, mime: type.split(";")[0]?.trim() || "application/octet-stream", bytes: got.bytes });
}

export function parseMime(raw: Uint8Array): ParsedMail {
  const { head, body } = splitHead(new TextDecoder("utf-8").decode(raw));
  const h = headers(head);
  const got = textOf(h, body, 0);
  const files = { attachments: [] as MailAttachment[], dropped: [] as DroppedPart[] };
  attachmentsOf(h, body, 0, false, files);
  const text = (got?.text ?? "").replace(/\r\n/g, "\n").trim();
  return {
    from: decodeWords(h.get("from") ?? ""),
    subject: decodeWords(h.get("subject") ?? ""),
    messageId: h.get("message-id") ?? null,
    date: h.get("date") ?? null,
    text: text.length > MAX_TEXT_CHARS ? `${text.slice(0, MAX_TEXT_CHARS)}\n[truncated]` : text,
    ...(got ? {} : { unreadable: "no text part this reader understands" }),
    ...files,
  };
}
