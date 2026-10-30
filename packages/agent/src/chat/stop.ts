// What a stopped turn says (M24.2): Stop ends the turn at its next step boundary, and the history entry
// says it was stopped, never done. Effects the turn had already committed to the outbox are not
// reverted; they are listed in words. Effects the last step proposed are not committed once the stop
// is seen, and the transcript says so for the agent's next turn. Messages the person queued during
// the turn are not taken up, and the entry says that too.
import type { Effect } from "./tools.ts";

export const STOPPED_TEXT = "Stopped. Your agent did not finish this.";
export const STOP_CODE = "TURN_STOPPED";
/** The chat-meta key a requested stop is kept under, so an instance that resumes the turn honours it. */
export const stopKey = (turnId: string) => `stop:${turnId}`;

/** The chat-meta key of a task stopped after its turn ended, its delegation still out (F31's drawer Stop): the thread draws that turn as stopped (F33, B-P3-06). */
export const haltKey = (turnId: string) => `halt:${turnId}`;

const label = (tool: string) => tool.replaceAll("_", " ");
/** A message's words cut to 80 characters, for a line that names it. */
export const clip = (text: string) => (text.length > 80 ? `${text.slice(0, 79)}…` : text);

/** One committed effect in words: what already happened, or was already handed on, before the stop. */
export function effectWords(effect: Effect): string {
  const e = effect as Effect & { tool?: string; text?: string; card?: { title?: string }; emoji?: string };
  switch (e.kind) {
    case "deliver":
      return `sent you: "${clip(String(e.text ?? ""))}"`;
    case "link":
      return `showed a link: ${e.card?.title ?? ""}`;
    case "delegate":
      return "started sub-agents";
    case "react":
      return `reacted ${e.emoji} to your message`;
    case "card":
      return `asked for your decision on ${label(String(e.tool))}`;
    case "refusal":
      return `${label(String(e.tool))} was refused`;
    default:
      return `${label(String(e.tool ?? e.kind))} was handed on to run`;
  }
}

/** The entry's text; `aborted` is how many messages the person queued that the turn never took up. */
export function stoppedText(aborted: number, effects: string[]): string {
  const queued = aborted ? ` ${aborted === 1 ? "The message" : `The ${aborted} messages`} you sent while it worked ${aborted === 1 ? "was" : "were"} not taken up; send again what you still want.` : "";
  const done = effects.length ? " Already done before the stop:" : "";
  return `${STOPPED_TEXT}${queued}${done}`;
}

/** The note the agent reads in its next turn: the person stopped here, and what the last step proposed did not run. */
export function stopNote(dropped: Effect[]): string {
  const calls = dropped.filter((e) => e.kind !== "deliver").map((e) => effectWords(e));
  const said = dropped.filter((e) => e.kind === "deliver").length;
  const parts = [...calls, ...(said ? [`${said} message(s) to the person`] : [])];
  return `(From the harness.) The person stopped this turn here.${parts.length ? ` What its last step proposed was not done: ${parts.join("; ")}.` : ""}`;
}

/** The note the agent reads next after a Stop of a task whose turn had ended (F33, B-P3-06): the delegations it ended, which never hand off and are never resumed. */
export function haltNote(groups: readonly string[]): string {
  const named = groups.length ? ` (delegation ${groups.join(", ")})` : "";
  return `(From the harness.) The person stopped this task while its sub-agents were still out. What did not run: the sub-agents it started${named} were ended before they reported, and their handoff will not arrive. An ended sub-agent is never resumed; that work is a new delegation, started only if the person asks.`;
}
