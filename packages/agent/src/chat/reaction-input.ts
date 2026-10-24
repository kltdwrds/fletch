// A reaction on the agent's pending question is the person's answer (F10): stored and drawn as any reaction, and
// also a `reaction` mailbox row carrying a harness signal, which starts a turn or is steered into the running one
// at its step boundary. The question is the `ASKING` contract's (`instructions.ts`): the agent's last drawn words
// carry a `?` and its turn ended `done` with no code. A card last, or an `AWAITING_DECISION` turn, is a grant
// pause, never answered by a reaction. Any other reaction is ambient and starts nothing.
import { fence } from "../context/fence.ts";
import type { HistoryEntry } from "./history.ts";
import type { MailKind } from "./mailbox.ts";
import type { TurnRow } from "./store.ts";

type AgentEntry = Extract<HistoryEntry, { kind: "agent" }>;

/** The agent's last drawn message when it asked something; null when anything the person or the turn drew came after. */
export function askedLast(entries: HistoryEntry[]): AgentEntry | null {
  const last = entries.findLast((e) => e.kind === "you" || e.kind === "agent" || e.kind === "card" || e.kind === "failed" || e.kind === "stopped");
  return last?.kind === "agent" && /\?/.test(last.text) ? last : null;
}

/**
 * The question a reaction on `mid` answers, or null. With no turn running, the latest turn ended `done` with no
 * code. A running turn is one a reaction started on that same question (its words are not drawn yet), so a second
 * reaction is steered into it; any other running turn (a typed message, a handoff) is not waiting on the question.
 */
export function pendingQuestion(entries: HistoryEntry[], turns: TurnRow[], mid: string, startedBy: (turnId: string) => MailKind | undefined): AgentEntry | null {
  const asked = askedLast(entries);
  if (asked?.mid !== mid) return null;
  const last = turns.at(-1);
  const ended = last?.status === "running" && startedBy(last.id) === "reaction" ? turns.at(-2) : last;
  return ended?.status === "done" && ended.code === null ? asked : null;
}

/** What the model reads: the harness says what happened; the emoji (the person's input) and the quote (model output) are fenced. */
export function reactionSignal(name: string, person: string, emoji: string, asked: AgentEntry): string {
  return [
    `(From the harness.) ${name} reacted to your last message (${asked.mid}) instead of typing; the reaction and the message are below. ` +
      "A 👍 on a question or a go-ahead means yes; read any other reaction against what you asked. " +
      "Carry on as the answer means; do not describe the reaction back.",
    fence(`reaction:${person}`, emoji),
    fence("quote:agent", asked.text),
  ].join("\n");
}

/** The mailbox row: one per (message, person, emoji), so the same emoji set again is the first row and a replacement a new one. */
export function reactionRow(person: string, name: string, emoji: string, asked: AgentEntry, at: number) {
  return { messageId: `reaction:${asked.mid}:${person}:${emoji}`, kind: "reaction" as const, scope: `reaction:${person}`, person, text: reactionSignal(name, person, emoji, asked), at };
}
