// The turn goes on after a decision (M20.1, QYVR-173). A turn that paused on approval cards ended
// `AWAITING_DECISION`; before this part nothing ran it again, so the agent sat silent until the person
// nudged it. Once the last card it paused on is decided, the chat runs one continuation turn on its own:
// its input is labelled by code (the decision itself is already in the transcript as the approval's
// note), it is never drawn as the person's words, and the page shows it working like any turn.
// Only the person's own task continues this way; a colleague's request is answered by code (B2).
import type { CardStore } from "./cards.ts";
import type { ChatStore } from "./store.ts";

/** Chat-meta key naming the paused turn whose decisions are all made and which has not continued yet. */
export const RESUME_KEY = "resumeAfterDecision";

/** The continuation turn's input: from code, not the person, and it carries no instruction of its own. */
export const RESUME_TEXT =
  "(From the harness, not typed by the person.) The decision this task was waiting for has been made; the note above says what it was and what ran. Continue the task from where it paused, and tell the person what happened.";

/**
 * The paused turn a decided card should continue, or null: the card's turn paused on cards, is still the
 * chat's latest turn, has no card left waiting or being decided, and is the owner's own task.
 */
export function turnToContinue(store: ChatStore, cards: CardStore, cardId: string, ownTask: (turnId: string) => boolean): string | null {
  const card = cards.get(cardId);
  if (!card) return null;
  const last = store.turns().at(-1);
  if (!last || last.id !== card.turnId || last.status !== "done" || last.code !== "AWAITING_DECISION") return null;
  if (cards.openFor(last.id) > 0 || !ownTask(last.id)) return null;
  return last.id;
}

/** Marks the continuation the decisions just made leave due; a repeated decision marks nothing. */
export function markContinuation(store: ChatStore, cards: CardStore, results: Array<{ id: string; ok: boolean; again?: true }>, ownTask: (turnId: string) => boolean): void {
  for (const r of results) {
    const paused = r.ok && !r.again ? turnToContinue(store, cards, r.id, ownTask) : null;
    if (paused) store.transaction(() => store.setMeta(RESUME_KEY, paused));
  }
}

/**
 * Starts the due continuation as a running turn with its code-labelled input, once no turn runs; null
 * when none is due, or when the person started a turn since, which already saw the decision's note.
 */
export function startContinuation(store: ChatStore, owner: string, at: number): string | null {
  const paused = store.meta(RESUME_KEY);
  if (!paused || store.runningTurn()) return null;
  const turnId = crypto.randomUUID();
  let started = false;
  store.transaction(() => {
    store.setMeta(RESUME_KEY, "");
    if (store.turns().at(-1)?.id !== paused) return;
    store.startTurn(turnId, owner, at);
    store.appendMessage(turnId, { role: "user", content: RESUME_TEXT, timestamp: at });
    started = true;
  });
  return started ? turnId : null;
}

/** Work a call leaves running past its answer, handed to the host to keep alive and awaitable by tests. */
export class Background {
  private readonly running = new Set<Promise<unknown>>();
  private readonly keep: (p: Promise<unknown>) => void;

  constructor(keep: (p: Promise<unknown>) => void) {
    this.keep = keep;
  }

  add(p: Promise<unknown>): void {
    const tracked: Promise<unknown> = p.catch(() => {}).finally(() => this.running.delete(tracked));
    this.running.add(tracked);
    this.keep(tracked);
  }

  /** Resolves once everything added, and everything it added in turn, has ended. */
  async settled(): Promise<void> {
    while (this.running.size) await Promise.all([...this.running]);
  }
}
