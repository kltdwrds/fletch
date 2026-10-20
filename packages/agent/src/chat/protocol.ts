// The chat socket's client frames. A frame is data: it can ask for a turn, never change who the
// sender is (that comes from the connection) or what the agent may do.
//
// From M18.1 a `send` may carry the page's own id for it, echoed on `turn_started` and on a refusal,
// and `sync` asks for the history again: the page sends it once on the person's action (the tab coming
// back, focus, the network back) to prove its socket answers, never on a timer (Q33).
import type { HistorySnapshot } from "./history.ts";

export type ClientFrame =
  | { type: "send"; text: string; timeZone?: string; id?: string; attachments?: string[]; quote?: string }
  | { type: "sync" }
  | { type: "stop" }
  /** The person's reaction to a message (M29.4); the chat decides whether it is theirs to make and which it is. */
  | { type: "react"; mid: string; emoji: string };

export type ParsedFrame = { ok: true; frame: ClientFrame } | { ok: false; code: "FRAME_UNPARSEABLE"; reason: string };

/** Frames the socket gets besides the engine's: a refusal or a frame it could not read. */
export type ProtocolFrame =
  | { type: "refused"; code: string; id?: string }
  | { type: "duplicate"; id: string; ordinal: number; state: string }
  | { type: "error"; code: "FRAME_UNPARSEABLE"; reason: string }
  | ({ type: "history" } & HistorySnapshot);

const MAX_TEXT = 16_000;
/** A page's id for a send: short, and only characters a `crypto.randomUUID()` uses. */
const SEND_ID = /^[A-Za-z0-9-]{1,64}$/;
/** A message's id in a chat's history (`history.ts`): a letter, then digits and dots. */
const MESSAGE_ID = /^[maq][0-9.]{1,40}$/;

export function parseClientFrame(raw: string | ArrayBuffer): ParsedFrame {
  if (typeof raw !== "string") return { ok: false, code: "FRAME_UNPARSEABLE", reason: "binary frames are not accepted" };
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (err) {
    return { ok: false, code: "FRAME_UNPARSEABLE", reason: `not JSON: ${(err as Error).message}` };
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ok: false, code: "FRAME_UNPARSEABLE", reason: "not a JSON object" };
  const v = value as Record<string, unknown>;
  if (v.type === "sync") return { ok: true, frame: { type: "sync" } };
  // A Stop names no turn: it stops whatever this chat is running (M24.2), as decided by the chat.
  if (v.type === "stop") return { ok: true, frame: { type: "stop" } };
  if (v.type === "react") {
    if (typeof v.mid !== "string" || !MESSAGE_ID.test(v.mid)) return { ok: false, code: "FRAME_UNPARSEABLE", reason: "mid must be a message id from the history" };
    if (typeof v.emoji !== "string" || !v.emoji || v.emoji.length > 16) return { ok: false, code: "FRAME_UNPARSEABLE", reason: "emoji must be a short string" };
    return { ok: true, frame: { type: "react", mid: v.mid, emoji: v.emoji } };
  }
  if (v.type !== "send") return { ok: false, code: "FRAME_UNPARSEABLE", reason: `unknown frame type ${JSON.stringify(v.type)}` };
  if (typeof v.text !== "string") return { ok: false, code: "FRAME_UNPARSEABLE", reason: "text must be a string" };
  if (v.text.length > MAX_TEXT) return { ok: false, code: "FRAME_UNPARSEABLE", reason: `text is longer than ${MAX_TEXT} characters` };
  if (v.timeZone !== undefined && (typeof v.timeZone !== "string" || !validZone(v.timeZone))) {
    return { ok: false, code: "FRAME_UNPARSEABLE", reason: "timeZone is not an IANA zone" };
  }
  if (v.id !== undefined && (typeof v.id !== "string" || !SEND_ID.test(v.id))) return { ok: false, code: "FRAME_UNPARSEABLE", reason: "id must be 1 to 64 letters, digits or dashes" };
  // The ids of the person's own uploads this message carries (M24.3); their `Person` decides each one.
  const att = v.attachments;
  if (att !== undefined && (!Array.isArray(att) || !att.length || att.length > 10 || !att.every((a) => typeof a === "string" && SEND_ID.test(a)))) return { ok: false, code: "FRAME_UNPARSEABLE", reason: "attachments are 1 to 10 upload ids" };
  // A reply names the message it quotes by its id (M29.4), and carries its own id so history can draw the quote with it.
  if (v.quote !== undefined && (typeof v.quote !== "string" || !MESSAGE_ID.test(v.quote))) return { ok: false, code: "FRAME_UNPARSEABLE", reason: "quote must be a message id from the history" };
  if (v.quote !== undefined && !v.id) return { ok: false, code: "FRAME_UNPARSEABLE", reason: "a send with a quote carries its id" };
  return { ok: true, frame: { type: "send", text: v.text, ...(v.timeZone ? { timeZone: v.timeZone as string } : {}), ...(v.id ? { id: v.id as string } : {}), ...(att ? { attachments: att as string[] } : {}), ...(v.quote ? { quote: v.quote as string } : {}) } };
}

function validZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

export type AdmitCode = "NO_SESSION" | "CHAT_UNCLAIMED" | "CHAT_NOT_OWNER";

/** Whether a connection from `person` may join a chat owned by `owner`; null admits. */
export function admit(person: string | null, owner: string | null): AdmitCode | null {
  if (!person) return "NO_SESSION";
  if (!owner) return "CHAT_UNCLAIMED";
  return owner === person ? null : "CHAT_NOT_OWNER";
}

/** The connections frames may go to: the owner's, and nobody else's. */
export function ownerOnly<C extends { state: unknown }>(connections: Iterable<C>, owner: string | null): C[] {
  if (!owner) return [];
  return [...connections].filter((c) => (c.state as { person?: unknown } | null)?.person === owner);
}

/**
 * What a new connection is sent first (M15.5), and what a `sync` is answered with (M18.1): its owner's
 * earlier turns, read only after the person is admitted, so a refused one learns a code and nothing
 * of the transcript.
 */
export function connectFrame(person: string | null, owner: string | null, read: () => HistorySnapshot): { ok: true; frame: ProtocolFrame } | { ok: false; code: AdmitCode } {
  const code = admit(person, owner);
  return code ? { ok: false, code } : { ok: true, frame: { type: "history", ...read() } };
}
