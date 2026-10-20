// What a chat answers and frames: a turn's result, a claim's, and every frame a chat socket receives.
import type { LinkCard } from "../workspace/surfaces.ts";
import type { CardView } from "./cards.ts";
import type { StreamFrame } from "./turn.ts";

export type SendResult =
  | { status: "done"; turnId: string; awaiting?: true }
  | { status: "failed"; turnId: string; code: string; detail: string }
  | { status: "stopped"; turnId: string }
  /** Stored in the mailbox while a turn runs (M24.2); the running turn takes it at its next step boundary. */
  | { status: "queued"; id: string; ordinal: number; turnId: string }
  /** The same send id again: answered with the first row, never stored twice. */
  | { status: "duplicate"; id: string; ordinal: number; state: string }
  | { status: "refused"; code: "CHAT_NOT_OWNER" | "EMPTY_MESSAGE" | "MEMORY_UNAVAILABLE" | "SECRET_NOT_HELD" | "QUOTE_NOT_FOUND" };

export type StopResult = { ok: true; turn: string } | { ok: false; code: "CHAT_NOT_OWNER" | "NO_TURN_RUNNING" };

export type ClaimResult = { ok: true } | { ok: false; code: "CHAT_NOT_OWNER" };

/** Frames a chat socket receives. */
export type ChatFrame =
  | StreamFrame
  | { type: "message"; turn: string; id: string; text: string }
  | { type: "action"; turn: string; id: string; tool: string; status: "done" | "failed"; code?: string; reason?: string }
  /**
   * The person's message is stored and its turn runs (M18.1): the page draws the message as sent only
   * now, and says the agent is working until `turn_done` or `turn_failed`. `id` is the page's own id
   * for the send, so the tab that sent it matches it; another tab of the owner draws `text`. A turn that
   * continues after a decision (M20.1) has no `text`: nothing the person typed starts it.
   */
  | { type: "turn_started"; turn: string; text?: string; id?: string }
  /** `chars` is the length of the reply text this turn streamed (deltas and messages, M19.1): a page that drew less asks for the history. */
  | { type: "turn_done"; turn: string; chars: number }
  /** `code` and `reason` for programs; `text` is what the person reads (M17.1). */
  | { type: "turn_failed"; turn: string; code: string; reason: string; text: string }
  /** The person's message is stored while a turn runs (M24.2); `id` is the page's id for the send. */
  | { type: "queued"; turn: string; id?: string; ordinal: number; text: string }
  /** A Stop was taken: the turn ends at its next step boundary. */
  | { type: "turn_stopping"; turn: string }
  /** The turn ended stopped; `effects` are words for what it had already done. */
  | { type: "turn_stopped"; turn: string; text: string; effects: string[] }
  | { type: "notice"; id: string; source: string; text: string }
  /** The owner's reaction on a message now (M29.4); null when they took it off. */
  | { type: "reaction"; mid: string; emoji: string | null }
  | { type: "card"; turn: string; card: CardView }
  | { type: "link"; turn: string; card: LinkCard }
  /** A turn ended: the ids of the messages it drew live, by side and words, so the page offers their actions (M29.4). */
  | { type: "named"; turn: string; messages: Array<{ mid: string; who: "you" | "agent"; text: string; at: number }> };
