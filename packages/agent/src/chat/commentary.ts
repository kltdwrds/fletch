// F45 (B-P2-03, P2 delta 2): the lead-in is commentary. Text beside a tool call, in a step that neither pauses on a card
// (B-P15-06: words beside a card call are that reply) nor ends the turn (`endsTurnIfSaid`: words beside a launch are the
// launch reply), is commentary: the turn loop streams no `delta` for it, and the stored row keeps the text with a mark,
// so the model is sent the same transcript while history, the `named` frame, `replyChars` and Activity's summary leave
// it out. A step with no tool call is always a reply.
import type { AssistantMessage, Message } from "@earendil-works/pi-ai";

/** The mark a stored assistant row carries when its words were commentary; `toWire` reads text blocks alone, so the model never sees it. */
type Marked = { commentary?: true };

/** Whether this step's words are commentary: they sit beside a tool call, and the step neither pauses nor ends the turn. */
export function isCommentaryStep(message: AssistantMessage, step: { paused: boolean; ends: boolean }): boolean {
  return message.content.some((c) => c.type === "toolCall") && !step.paused && !step.ends;
}

/** Whether a message holds words: a text block that is not blank. */
export const saysWords = (message: AssistantMessage): boolean => message.content.some((c) => c.type === "text" && c.text.trim() !== "");

/** Marks a step's message as commentary, in place: the row the barrier stores and the context the next request reads. */
export function markCommentary(message: AssistantMessage): void {
  (message as AssistantMessage & Marked).commentary = true;
}

/** Whether a stored row's words were commentary, never a reply. */
export const isCommentary = (message: Message): boolean => (message as Message & Marked).commentary === true;
