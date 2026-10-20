// What a chat answers on the socket a frame came in on (M18.1), for the `Chat` object's `onMessage`:
// a `sync` is answered with the history, decided against the owner as on connect; a `send` runs the
// turn, whose frames go to the owner's sockets, and a refusal goes back to this socket with the page's
// id for the send, so the page says that message was not sent. The person is the connection's, never
// the frame's.
import type { SendResult, StopResult } from "./frames.ts";
import type { ReactResult } from "./message-actions.ts";
import type { SendInput } from "./inputs.ts";
import type { HistorySnapshot } from "./history.ts";
import { connectFrame, parseClientFrame, type ProtocolFrame } from "./protocol.ts";

export interface SocketChat {
  owner(): string | null;
  history(): HistorySnapshot;
  send(input: SendInput): Promise<SendResult>;
  stop(person: string): Promise<StopResult>;
  react(person: string, mid: string, emoji: string): ReactResult;
}

/**
 * The person's own uploads a send names (M24.3), bound to the message by their `Person`, which refuses any
 * that are not theirs; the lines are what the model reads of each, appended to the message it sees.
 */
export type AttachHook = (person: string, ids: string[], messageId: string) => Promise<{ ok: true; lines: string[] } | { ok: false; code: string }>;

/** @param writing called once the person is known to be writing (their `Person`'s pacing, M14.1) */
export async function answerFrame(person: string, raw: string | ArrayBuffer, chat: SocketChat, writing: () => void = () => {}, attach?: AttachHook): Promise<ProtocolFrame | null> {
  const parsed = parseClientFrame(raw);
  if (!parsed.ok) return { type: "error", code: parsed.code, reason: parsed.reason };
  const frame = parsed.frame;
  if (frame.type === "sync") {
    const again = connectFrame(person, chat.owner(), () => chat.history());
    return again.ok ? again.frame : { type: "refused", code: again.code };
  }
  if (frame.type === "stop") {
    const stopped = await chat.stop(person);
    return stopped.ok ? null : { type: "refused", code: stopped.code };
  }
  // A reaction goes to the owner's sockets as the chat's `reaction` frame; only a refusal answers here.
  if (frame.type === "react") {
    const r = chat.react(person, frame.mid, frame.emoji);
    return r.ok ? null : { type: "refused", code: r.code };
  }
  writing();
  let text = frame.text;
  if (frame.attachments) {
    if (!frame.id) return { type: "error", code: "FRAME_UNPARSEABLE", reason: "a send with attachments carries its id" };
    const bound = attach ? await attach(person, frame.attachments, frame.id) : { ok: false as const, code: "ATTACHMENTS_UNAVAILABLE" };
    if (!bound.ok) return { type: "refused", code: bound.code, id: frame.id };
    text = [frame.text.trim(), ...bound.lines].filter(Boolean).join("\n\n");
  }
  const result = await chat.send({ person, text, ...(frame.timeZone ? { timeZone: frame.timeZone } : {}), ...(frame.id ? { clientId: frame.id } : {}), ...(frame.quote ? { quote: frame.quote } : {}) });
  if (result.status === "duplicate") return { type: "duplicate", id: result.id, ordinal: result.ordinal, state: result.state };
  return result.status === "refused" ? { type: "refused", code: result.code, ...(frame.id ? { id: frame.id } : {}) } : null;
}
